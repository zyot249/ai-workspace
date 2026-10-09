import { expect, it } from 'vitest'
import { STOPS } from '../../app/journey/stops'
import {
  WINDOW, WINDOW_PALETTE, windowLitAmount, windowLookFor, windowHashes,
  windowClass, hash11, hash13, linearLuminance, gainFor, flickerMultiplier,
} from '../../app/journey/window-look'

const fraction = (xs: number[]) => xs.filter(x => x > 0.5).length / xs.length
const sd = (xs: number[]) => {
  const mean = xs.reduce((a,b) => a+b,0)/xs.length
  return Math.sqrt(xs.reduce((a,b) => a+(b-mean)**2,0)/xs.length)
}
it('has deterministic stratified occupancy, rather than noisy building samples', () => {
  const cases = [[.05,.005,.04],[.3,.257,.297],[.65,.614,.654],[.9,.85,.89]]
  for (const [ratio, lo, hi] of cases) {
    const amounts: number[] = []
    for (let b=0;b<200;b++) for (let c=0;c<100;c++) {
      // 20,000 cell/building strata; buildingHash produces uniform k.
      amounts.push(windowLitAmount((c+.5)/100,(b+.5)/200,ratio!))
    }
    expect(fraction(amounts)).toBeGreaterThanOrEqual(lo!)
    expect(fraction(amounts)).toBeLessThanOrEqual(hi!)
  }
})
it('has building spread before sampling noise, and three large-sample checks', () => {
  const expected = Array.from({length:2000},(_,i) =>
    Math.min(1, Math.max(0,(.65-.03)/(.75+.5*(i+.5)/2000))))
  expect(sd(expected)).toBeGreaterThanOrEqual(.08)
  expect(Math.min(...expected)).toBeLessThan(.55)
  expect(Math.max(...expected)).toBeGreaterThan(.78)
  for (const k of [.75,1,1.25]) {
    const bh = (1.25-k)/.5
    const actual = fraction(Array.from({length:4000},(_,i) =>
      windowLitAmount((i+.5)/4000,bh,.65)))
    expect(Math.abs(actual-Math.min(1,.62/k))).toBeLessThan(.03)
  }
})
it('is monotonic, continuous and reverses symmetrically', () => {
  for (let i=0;i<1000;i++) {
    const h=windowHashes([i%40,Math.floor(i/40)],Math.fround((i+.5)/1000))
    const values=Array.from({length:101},(_,p)=>windowLitAmount(h.cell,h.building,p/100))
    for(let p=1;p<values.length;p++) expect(values[p]!).toBeGreaterThanOrEqual(values[p-1]!)
    const t=h.cell*(1.25-.5*h.building)
    expect(windowLitAmount(h.cell,h.building,t)).toBe(0)
    expect(windowLitAmount(h.cell,h.building,t+.03)).toBeCloseTo(.5,6)
    expect(windowLitAmount(h.cell,h.building,t+.06)).toBeCloseTo(1,6)
    const backwards=Array.from({length:101},(_,p)=>windowLitAmount(h.cell,h.building,1-p/100))
    for(let p=0;p<101;p++) expect(backwards[p]!).toBeCloseTo(values[100-p]!,12)
  }
  expect(windowLitAmount(.2,.4,-.5)).toBe(0)
  expect(windowLitAmount(.2,.4,1.5)).toBe(1)
})
it('maps actual stops, long-running time, and both reduced variants', () => {
  const targets=[.39,.96,1,1]
  for (const [i,s] of STOPS.entries()) for(const tier of ['full','lite','reduced'] as const) {
    const look=windowLookFor(s,1234.125,tier)
    expect(Math.abs(look.uEmissiveScale-targets[i]!)).toBeLessThan(.01)
    expect(look.uTime).toBe(234.125)
    expect(look.uFlicker).toBe(tier==='reduced'?0:1)
  }
})
it('uses float32 seed semantics, including negative facade coordinates', () => {
  for(const cell of [[-40,0],[0,0],[39,49]] as const) {
    const seed=.123456789123
    expect(hash13(cell,seed)).toBe(hash13(cell,Math.fround(seed)))
    expect(hash13(cell,seed)).toBeGreaterThanOrEqual(0)
    expect(hash13(cell,seed)).toBeLessThan(1)
  }
  expect(hash11(.25)).toBe(0.4783235788345337)
})
it('calibrates each sRGB class in linear space and meets both brightness contracts', () => {
  for(const p of WINDOW_PALETTE) {
    expect(p.gain).toBe(gainFor(p.hex,2.3))
    expect(Math.abs(p.gain*linearLuminance(p.linear)-2.3)).toBeLessThan(1e-3)
  }
  const project=windowLookFor(STOPS[1]!,0,'full').uEmissiveScale
  expect(2.3*.92*project).toBeGreaterThanOrEqual(2)
  expect(2.3*.92*project*.6).toBeGreaterThan(1)
  expect(WINDOW_PALETTE[0].gain*linearLuminance(WINDOW_PALETTE[0].linear)).toBeCloseTo(2.3,6)
})
it('has 70/20/10 class shares and roughly 4% eligible flicker among lit samples', () => {
  const counts={warm:0,neutral:0,cool:0}; let eligible=0,total=0
  // Large deterministic field; take the first 10,000 lit windows.
  for(let i=0;total<10000 && i<30000;i++) {
    const h=windowHashes([i%100,Math.floor(i/100)],Math.fround(((i%97)+.5)/97))
    if(windowLitAmount(h.cell,h.building,.9)<=.5) continue
    const cls=windowClass(h.tint); counts[cls]++; total++
    if(cls==='cool' && h.flicker<.4) eligible++
  }
  expect(total).toBe(10000)
  for(const [cls,target] of [['warm',.7],['neutral',.2],['cool',.1]] as const)
    expect(Math.abs(counts[cls]/total-target)).toBeLessThan(.02)
  expect(Math.abs(eligible/total-.04)).toBeLessThan(.01)
})
it('keeps gate-zero brightness exactly one even across the wrap boundary', () => {
  for(let p=0;p<100;p++) for(const t of [0,.1,1,99,999.9,1000,1000.1]) {
    const phase=p/100*6.2832
    expect(flickerMultiplier(phase,t,0)).toBe(1)
    const a=flickerMultiplier(phase,t,1)
    expect(a).toBeGreaterThanOrEqual(.6); expect(a).toBeLessThanOrEqual(1)
  }
  // The specified modulo reset can change an eligible cell; reduced mode cannot.
  expect(windowLookFor(STOPS[3]!,1000.1,'reduced').uFlicker).toBe(0)
})
