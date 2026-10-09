import { Color } from 'three'
import type { StopState } from './stops'
import type { Tier } from './tier'

export const WINDOW = {
  hashMultiplier:.1031, hash13Offset:31.32, hash11Offset:33.33,
  kMin:.75, kMax:1.25, fadeBand:.06, target:2.3,
  warmCut:.7, neutralCut:.9, brightnessMin:.92, brightnessMax:1.2,
  flickerCut:.4, phasePeriod:6.2832, timeWrap:1000,
  tintSalt:[17,43,.137], brightnessSalt:[59,11,.271], flickerSalt:[7,83,.419],
} as const
const f=Math.fround
const add=(a:number,b:number)=>f(f(a)+f(b))
const mul=(a:number,b:number)=>f(f(a)*f(b))
const fract=(x:number)=>f(f(x)-Math.floor(f(x)))
const clamp=(x:number)=>Math.max(0,Math.min(1,x))
const smooth=(a:number,b:number,x:number)=>{
  const s=clamp((x-a)/(b-a)); return s*s*(3-2*s)
}
export function hash11(seed:number):number {
  let p=fract(mul(seed,WINDOW.hashMultiplier))
  p=mul(p,add(p,WINDOW.hash11Offset))
  p=mul(p,add(p,p))
  return fract(p)
}
export function hash13(cell:readonly [number,number],seed:number):number {
  let x=fract(mul(cell[0],WINDOW.hashMultiplier))
  let y=fract(mul(cell[1],WINDOW.hashMultiplier))
  let z=fract(mul(seed,WINDOW.hashMultiplier))
  // p3.zyx + offset, in exactly the GLSL scalar evaluation order.
  const a=mul(x,add(z,WINDOW.hash13Offset))
  const b=mul(y,add(y,WINDOW.hash13Offset))
  const c=mul(z,add(x,WINDOW.hash13Offset))
  const d=add(add(a,b),c)
  x=add(x,d); y=add(y,d); z=add(z,d)
  return fract(mul(add(x,y),z))
}
export function windowHashes(cell:readonly [number,number],seed:number) {
  const salted=(salt:readonly [number,number,number])=>
    hash13([add(cell[0],salt[0]),add(cell[1],salt[1])],add(seed,salt[2]))
  return {cell:hash13(cell,seed),building:hash11(seed),
    tint:salted(WINDOW.tintSalt),brightness:salted(WINDOW.brightnessSalt),
    flicker:salted(WINDOW.flickerSalt)}
}
export function windowLitAmount(cellHash:number,buildingHash:number,uLit:number):number {
  const k=WINDOW.kMax+(WINDOW.kMin-WINDOW.kMax)*buildingHash
  const t=cellHash*k
  return smooth(t,t+WINDOW.fadeBand,uLit)
}
export function linearLuminance(rgb:readonly number[]):number {
  return .2126*rgb[0]!+.7152*rgb[1]!+.0722*rgb[2]!
}
export function gainFor(srgbHex:number,targetLuminance:number):number {
  const c=new Color(srgbHex) // r186 converts hex sRGB to linear working space.
  return targetLuminance/linearLuminance([c.r,c.g,c.b])
}
const palette=(name:'warm'|'neutral'|'cool',hex:number)=>{
  const c=new Color(hex)
  return {name,hex,linear:[c.r,c.g,c.b] as const,gain:gainFor(hex,WINDOW.target)}
}
export const WINDOW_PALETTE=[palette('warm',0xffc983),palette('neutral',0xffe9c4),palette('cool',0xbfe0ff)] as const
export function windowClass(tintHash:number):'warm'|'neutral'|'cool' {
  return tintHash<WINDOW.warmCut?'warm':tintHash<WINDOW.neutralCut?'neutral':'cool'
}
export function flickerMultiplier(phase:number,time:number,gate:number):number {
  if(gate===0) return 1
  const moving=.8+.2*Math.sin(time*6.3+phase)*Math.sin(time*2.1+phase*1.7)
  return 1+(moving-1)*gate
}
export function windowLookFor(state:Pick<StopState,'windowLitRatio'>,t:number,tier:Exclude<Tier,'none'>) {
  return {uEmissiveScale:.35+.65*smooth(0,.35,state.windowLitRatio),
    uTime:t%WINDOW.timeWrap,uFlicker:tier==='reduced'?0:1}
}
