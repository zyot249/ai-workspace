import * as THREE from 'three'
import { createFacadeMaterial, createFacadeUniforms } from '../../app/journey/facade-material'
import { createTestRenderer } from './gpu-utils'
export interface WindowProbeInput {
  variant:'full'|'lite';seed:number;ratio:number;time?:number;flicker?:number;
  emissiveScale?:number;mode?:0|1|2|3;pixelsPerCell?:number;depth?:number
}
export interface WindowProbeResult {
  samples:number[][];shaderError:string|null;glError:number
}
export function probeWindows(input:WindowProbeInput):WindowProbeResult {
  const p=input.pixelsPerCell??6, width=80*p, height=50*p
  const ctx=createTestRenderer({width,height})
  const {renderer,recorder}=ctx
  const target=new THREE.WebGLRenderTarget(width,height,{
    type:THREE.FloatType,format:THREE.RGBAFormat,minFilter:THREE.NearestFilter,
    magFilter:THREE.NearestFilter,depthBuffer:true,stencilBuffer:false})
  const geometry=new THREE.BoxGeometry(1,1,1)
  const uniforms={...createFacadeUniforms(input.flicker??0),uLit:{value:input.ratio},uSkyTint:{value:new THREE.Color(0xbfdbfe)},
    uTime:{value:input.time??0},uEmissiveScale:{value:input.emissiveScale??1}}
  const material=createFacadeMaterial({color:0x353b5c,uniforms,variant:input.variant})
  if(input.mode) material.defines={...material.defines,FACADE_DEBUG_WINDOW:input.mode}
  const mesh=new THREE.InstancedMesh(geometry,material,1)
  geometry.setAttribute('aSeed',new THREE.InstancedBufferAttribute(new Float32Array([input.seed]),1))
  geometry.setAttribute('aWindowed',new THREE.InstancedBufferAttribute(new Float32Array([1]),1))
  mesh.setMatrixAt(0,new THREE.Matrix4().compose(
    new THREE.Vector3(0,4.5,0),new THREE.Quaternion(),new THREE.Vector3(12.8,11,1)))
  mesh.instanceMatrix.needsUpdate=true;mesh.frustumCulled=false
  const scene=new THREE.Scene();scene.add(mesh)
  const depth=input.depth??4.5
  const camera=new THREE.OrthographicCamera(-6.4,6.4,5.5,-5.5,.1,200)
  camera.position.set(0,4.5,.5+depth);camera.lookAt(0,4.5,0)
  renderer.setPixelRatio(1);renderer.setSize(width,height,false)
  renderer.toneMapping=THREE.NoToneMapping
  renderer.outputColorSpace=THREE.LinearSRGBColorSpace
  target.texture.colorSpace=THREE.LinearSRGBColorSpace
  try {
    if(!renderer.getContext().getExtension('EXT_color_buffer_float'))
      throw new Error('Window GPU tests require readable float color targets')
    renderer.setRenderTarget(target);renderer.render(scene,camera);recorder.assertClean()
    const pixels=new Float32Array(width*height*4)
    renderer.readRenderTargetPixels(target,0,0,width,height,pixels)
    const samples:number[][]=[]
    for(let row=0;row<50;row++) for(let col=0;col<80;col++) {
      const x=col*p+Math.floor(p/2),y=row*p+Math.floor(p/2)
      const offset=4*(y*width+x)
      samples.push(Array.from(pixels.subarray(offset,offset+3)))
    }
    return {samples,shaderError:recorder.error?.message??null,glError:renderer.getContext().getError()}
  } finally {
    renderer.setRenderTarget(null);target.dispose();geometry.dispose();material.dispose();ctx.dispose()
  }
}
