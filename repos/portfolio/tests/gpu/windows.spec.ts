import { expect,test } from '@playwright/test'
import { hash11, windowHashes, windowLitAmount, windowClass, WINDOW_PALETTE,
  linearLuminance, windowLookFor } from '../../app/journey/window-look'
import { STOPS } from '../../app/journey/stops'
test.beforeEach(async({page})=>{
  await page.goto('/tests/gpu/harness.html')
  await page.waitForFunction(()=>Boolean(window.cityGpu))
})
const seeds=Array.from({length:40},(_,i)=>Math.fround((i+.5)/40))
for(const variant of ['full','lite'] as const) {
  test(`${variant}: forty large walls match per-building occupancy`,async({page})=>{
    test.setTimeout(180000)
    for(const seed of seeds) for(const ratio of [.05,.3,.65,.9]) {
      const r=await page.evaluate(({variant,seed,ratio})=>
        window.cityGpu.probeWindows({variant,seed,ratio,mode:1,flicker:0}),{variant,seed,ratio})
      expect(r.shaderError).toBeNull(); expect(r.glError).toBe(0)
      expect(r.samples).toHaveLength(4000)
      const actual=r.samples.filter(x=>x[0]!>.5).length/4000
      const k=1.25-.5*hash11(seed)
      expect(Math.abs(actual-Math.max(0,Math.min(1,(ratio-.03)/k)))) .toBeLessThan(.03)
    }
  })
}

test('production hashes agree with the float32 mirror and 100 safe decisions agree',async({page})=>{
  const seed=seeds[13]!,ratio=.65
  const raw=await page.evaluate(({seed,ratio})=>
    window.cityGpu.probeWindows({variant:'full',seed,ratio,mode:2}),{seed,ratio})
  const amounts=await page.evaluate(({seed,ratio})=>
    window.cityGpu.probeWindows({variant:'full',seed,ratio,mode:1}),{seed,ratio})
  expect(raw.shaderError).toBeNull();expect(raw.glError).toBe(0)
  expect(amounts.shaderError).toBeNull();expect(amounts.glError).toBe(0)
  let checked=0
  for(let i=0;i<4000 && checked<100;i++) {
    const h=windowHashes([i%80-40,Math.floor(i/80)],seed)
    const t=h.cell*(1.25-.5*h.building)
    if(h.cell<.02 || h.cell>.98 || h.tint<.02 || h.tint>.98 || Math.abs(t-(ratio-.03))<.02) continue
    const gpu=raw.samples[i]!
    expect(Math.abs(gpu[0]!-h.cell)).toBeLessThan(.002)
    expect(Math.abs(gpu[1]!-h.building)).toBeLessThan(.002)
    expect(Math.abs(gpu[2]!-h.tint)).toBeLessThan(.002)
    expect(amounts.samples[i]![0]!>.5).toBe(windowLitAmount(h.cell,h.building,ratio)>.5)
    checked++
  }
  expect(checked).toBe(100)
})
test('actual normal production emission has calibrated hues and full-window luminance',async({page})=>{
  const seed=seeds[22]!,ratio=.9
  const diagnostic=await page.evaluate(({seed,ratio})=>
    window.cityGpu.probeWindows({variant:'full',seed,ratio,mode:3}),{seed,ratio})
  const normal=await page.evaluate(({seed,ratio})=>
    window.cityGpu.probeWindows({variant:'full',seed,ratio,mode:0}),{seed,ratio})
  const counts=[0,0,0];let total=0
  const normalized=WINDOW_PALETTE.map(p=>p.linear.map(c=>c/linearLuminance(p.linear)))
  for(let i=0;i<4000;i++) {
    const a=normal.samples[i]!,b=diagnostic.samples[i]!
    for(let j=0;j<3;j++) expect(Math.abs(a[j]!-b[j]!)).toBeLessThan(.005)
    const lum=linearLuminance(a)
    if(lum<2.0) continue // fully lit or almost fully lit samples only
    const hue=a.map(c=>c/lum)
    const scores=normalized.map(c=>c.reduce((s,v,j)=>s+(v-hue[j]!)**2,0))
    const cls=scores.indexOf(Math.min(...scores));counts[cls]!++;total++
  }
  expect(total).toBeGreaterThan(2000)
  for(const [i,target] of [.7,.2,.1].entries())
    expect(Math.abs(counts[i]!/total-target)).toBeLessThan(.06)
  const project=windowLookFor(STOPS[1]!,0,'full').uEmissiveScale
  const fully=await page.evaluate(({seed,project})=>
    window.cityGpu.probeWindows({variant:'full',seed,ratio:.3,emissiveScale:project}),{seed,project})
  const fade=await page.evaluate(seed=>
    window.cityGpu.probeWindows({variant:'full',seed,ratio:.3,mode:1}),seed)
  let fullCount=0
  for(let i=0;i<4000;i++) if(fade.samples[i]![0]!>=.99999) {
    expect(linearLuminance(fully.samples[i]!)).toBeGreaterThanOrEqual(2);fullCount++
  }
  expect(fullCount).toBeGreaterThan(100)
  for(const r of [diagnostic,normal,fully,fade]) {expect(r.shaderError).toBeNull();expect(r.glError).toBe(0)}
})
test('eligible production windows move, while gate-zero and lite retain full static brightness',async({page})=>{
  const seed=seeds[22]!
  const hashes=Array.from({length:4000},(_,i)=>windowHashes([i%80-40,Math.floor(i/80)],seed))
  const index=hashes.findIndex(h=>h.tint>.92 && h.flicker<.38 && h.cell*(1.25-.5*h.building)+.06<.9)
  expect(index).toBeGreaterThanOrEqual(0)
  const series:number[]=[]
  let baseline=0
  for(let n=0;n<=10;n++) {
    const result=await page.evaluate(({seed,time})=>{
      const moving=window.cityGpu.probeWindows({variant:'full',seed,ratio:.9,time,flicker:1})
      const still=window.cityGpu.probeWindows({variant:'full',seed,ratio:.9,time,flicker:0})
      const lite=window.cityGpu.probeWindows({variant:'lite',seed,ratio:.9,time,flicker:1})
      const liteFade=window.cityGpu.probeWindows({variant:'lite',seed,ratio:.9,mode:1})
      return {moving,still,lite,liteFade}
    },{seed,time:n/10})
    const lum=linearLuminance(result.still.samples[index]!)
    if(n===0) baseline=lum
    expect(lum).toBeCloseTo(baseline,5)
    series.push(linearLuminance(result.moving.samples[index]!))
    // Only fully revealed windows reach the calibrated 2.3; cells mid-fade are dimmer by design.
    const fullyLit=result.lite.samples.filter((_,i)=>result.liteFade.samples[i]![0]!>=.99999)
    expect(fullyLit.length).toBeGreaterThan(100)
    const warm=WINDOW_PALETTE[0].linear.map(c=>c/linearLuminance(WINDOW_PALETTE[0].linear))
    // Fold the per-pixel checks into one worst-case value; thousands of expect() calls per frame are slow.
    let worst=0
    for(const rgb of fullyLit) {
      const lum=linearLuminance(rgb)
      worst=Math.max(worst,Math.abs(lum-2.3),...rgb.map((c,j)=>Math.abs(c/lum-warm[j]!)))
    }
    expect(worst).toBeLessThan(5e-5)
    for(const r of Object.values(result)) {expect(r.shaderError).toBeNull();expect(r.glError).toBe(0)}
  }
  expect((Math.max(...series)-Math.min(...series))/baseline).toBeGreaterThan(.05)
  expect(Math.max(...series)).toBeLessThanOrEqual(baseline+.005)
})
test('distance filtering attenuates production emission on both variants',async({page})=>{
  for(const variant of ['full','lite'] as const) {
    const result=await page.evaluate(variant=>{
      const near=window.cityGpu.probeWindows({variant,seed:.5625,ratio:.9,mode:3,pixelsPerCell:6,depth:4.5})
      const far=window.cityGpu.probeWindows({variant,seed:.5625,ratio:.9,mode:3,
        pixelsPerCell:variant==='full'?2:6,depth:variant==='lite'?14.5:4.5})
      return {near,far}
    },variant)
    const total=(samples:number[][])=>samples.reduce((s,rgb)=>s+linearLuminance(rgb),0)
    expect(total(result.far.samples)).toBeLessThan(total(result.near.samples)*.8)
    for(const r of Object.values(result)){expect(r.shaderError).toBeNull();expect(r.glError).toBe(0)}
  }
})
test('lite output is identical at different times across all cells',async({page})=>{
  const result=await page.evaluate(()=>({
    a:window.cityGpu.probeWindows({variant:'lite',seed:.5625,ratio:.9,time:0,flicker:1}),
    b:window.cityGpu.probeWindows({variant:'lite',seed:.5625,ratio:.9,time:1,flicker:1}),
  }))
  expect(result.a.samples).toEqual(result.b.samples)
  for(const r of Object.values(result)){expect(r.shaderError).toBeNull();expect(r.glError).toBe(0)}
})

for(const [tier,lowPower] of [['full',false],['lite',true],['reduced',false],['reduced',true]] as const) {
  test(`${tier}/${lowPower}: chapters render and restore at fixed state`,async({page})=>{
    await page.evaluate(({tier,lowPower})=>window.cityGpu.mountJourney({tier,lowPower,width:640,height:360}),{tier,lowPower})
    for(const chapter of [0,1,2,3]) {
      const d=await page.evaluate(chapter=>window.cityGpu.renderJourney({chapter,time:.4,frames:300}),chapter)
      expect(d.shaderError).toBeNull();expect(d.glError).toBe(0)
    }
    const before=await page.evaluate(()=>window.cityGpu.readFrame())
    const d=await page.evaluate(async()=>{
      await window.cityGpu.loseAndRestore()
      return window.cityGpu.renderJourney({chapter:3,time:.4,frames:2})
    })
    const after=await page.evaluate(()=>window.cityGpu.readFrame())
    expect(d.shaderError).toBeNull();expect(d.glError).toBe(0)
    expect(after).toEqual(before)
    if(tier==='reduced') {
      await page.evaluate(()=>window.cityGpu.renderJourney({chapter:3,time:9.9,frames:2}))
      expect(await page.evaluate(()=>window.cityGpu.readFrame())).toEqual(after)
    }
    await page.evaluate(()=>window.cityGpu.dispose())
  })
}
test('a production cell reveals continuously and never dims as its ratio rises',async({page})=>{
  const seed=.5625,cell=[0,0] as const,h=windowHashes(cell,seed)
  const t=h.cell*(1.25-.5*h.building),index=40 // row 0, column 40
  const ratios=[t,t+.015,t+.03,t+.045,t+.06]
  const values:number[]=[]
  for(const ratio of ratios) {
    const r=await page.evaluate(({seed,ratio})=>
      window.cityGpu.probeWindows({variant:'full',seed,ratio,mode:1}),{seed,ratio})
    expect(r.shaderError).toBeNull();expect(r.glError).toBe(0)
    values.push(r.samples[index]![0]!)
  }
  expect(values[0]).toBeLessThan(.01);expect(values[4]).toBeGreaterThan(.99)
  expect(values[2]).toBeCloseTo(.5,1)
  for(let i=1;i<values.length;i++) expect(values[i]!).toBeGreaterThan(values[i-1]!)
})

test('shared render-cost probe measures the actual window scene',async({page})=>{
  const result=await page.evaluate(async()=>{
    window.cityGpu.mountJourney({tier:'full',lowPower:false,width:640,height:360})
    const report=await window.cityGpu.measureJourney({chapter:2,durationMs:100})
    const diagnostic=window.cityGpu.diagnostics()
    window.cityGpu.dispose()
    return {report,diagnostic}
  })
  expect(result.report.samples).toBeGreaterThan(0)
  expect(Number.isFinite(result.report.meanMs)).toBe(true)
  expect(result.report.meanMs).toBeGreaterThan(0)
  expect(Number.isFinite(result.report.p95Ms)).toBe(true)
  expect(result.diagnostic.shaderError).toBeNull();expect(result.diagnostic.glError).toBe(0)
})
