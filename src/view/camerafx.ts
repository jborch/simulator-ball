// Camera realism for the RTSP feeds (`?fx=1`, on unless CAMERA_REALISM=off): makes the rendered
// picture look more like it came from an industrial IP camera, so vision built on the feeds has a
// chance of working on a real one. Cheap enough to run on every frame:
//
// - mount: each camera is installed slightly differently on every run (position, aim, roll, focal
//   length), from the scene seed, and vibrates a little while the line runs, with now and then a
//   knock that sets it swinging
// - optics: barrel distortion, chromatic aberration at the edges, a little softness, vignetting
// - exposure: motion blur (each frame blends into the next), lamp flicker, a gain that rises in
//   poor light, and the sensor noise that comes with it (brighter areas noisier in absolute terms,
//   dark areas noisier relative to the signal), plus a slight white-balance cast per camera
//
// Compression artefacts come from the encoder (a lower bit rate with realism on; see cameras.ts).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { hash01, hashSigned } from './scene';

/** What the scene asks of the camera: how hard the lighting makes it work. */
export interface Exposure {
  /** Sensor gain (1 in good light): brightens the picture and the noise with it. */
  gain: number;
  /** Lamp flicker amplitude (fraction of brightness). */
  flicker: number;
  /** Motion blur: how much of the previous frame stays in each frame (0..1). */
  blur: number;
}

/** Per-camera constants, drawn from the scene seed and the camera id. */
interface Mount {
  offset: THREE.Vector3;
  yaw: number;
  pitch: number;
  roll: number;
  fovScale: number;
  k1: number;
  ca: number;
  vignette: number;
  wb: THREE.Vector3;
  flickerHz: number;
  noise: number;
}

/** A number for a camera id, so each camera draws its own values from the scene seed. */
function camNumber(camId: string): number {
  let id = 0;
  for (const ch of camId) id = (id * 31 + ch.charCodeAt(0)) | 0;
  return id;
}

function mountFor(seed: number, camId: string): Mount {
  const id = camNumber(camId);
  const r = (k: number) => hashSigned(seed, id, k); // -1..1
  const deg = Math.PI / 180;
  return {
    offset: new THREE.Vector3(r(1) * 0.015, r(2) * 0.012, r(3) * 0.015),
    yaw: r(4) * 1.5 * deg,
    pitch: r(5) * 1.0 * deg,
    roll: r(6) * 1.2 * deg,
    fovScale: 1 + r(7) * 0.04,
    k1: 0.06 + 0.05 * hash01(seed, id, 8),
    ca: 0.0008 + 0.0012 * hash01(seed, id, 9),
    vignette: 0.25 + 0.2 * hash01(seed, id, 10),
    wb: new THREE.Vector3(1 + r(11) * 0.04, 1 + r(12) * 0.015, 1 + r(13) * 0.05),
    flickerHz: 0.15 + 1.2 * hash01(seed, id, 14),
    noise: 0.012 + 0.008 * hash01(seed, id, 15),
  };
}

/** Exponential blend with the previous frame: a cheap stand-in for exposure-time motion blur. */
const BLEND = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, tPrev: { value: null as THREE.Texture | null }, amount: { value: 0.3 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform sampler2D tPrev; uniform float amount; varying vec2 vUv;
    void main() { gl_FragColor = mix(texture2D(tDiffuse, vUv), texture2D(tPrev, vUv), amount); }`,
};

const SENSOR = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    res: { value: new THREE.Vector2(1280, 720) },
    frame: { value: 0 },
    k1: { value: 0.08 },
    ca: { value: 0.001 },
    soft: { value: 0.6 },
    gain: { value: 1 },
    vignette: { value: 0.3 },
    wb: { value: new THREE.Vector3(1, 1, 1) },
    noise: { value: 0.015 },
  },
  vertexShader: BLEND.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform vec2 res; uniform float frame, k1, ca, soft, gain, vignette, noise; uniform vec3 wb;
    varying vec2 vUv;

    // Barrel distortion, zoomed so the corners stay filled.
    vec2 lens(vec2 uv, float k) {
      float aspect = res.x / res.y;
      vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
      float corner = 0.25 * (aspect * aspect + 1.0);
      c *= (1.0 + k * dot(c, c)) / (1.0 + k * corner);
      return c / vec2(aspect, 1.0) + 0.5;
    }
    vec3 sampleSoft(vec2 uv) {
      vec2 px = soft / res;
      vec3 s = texture2D(tDiffuse, uv).rgb * 0.4;
      s += texture2D(tDiffuse, uv + vec2(px.x, 0.0)).rgb * 0.15;
      s += texture2D(tDiffuse, uv - vec2(px.x, 0.0)).rgb * 0.15;
      s += texture2D(tDiffuse, uv + vec2(0.0, px.y)).rgb * 0.15;
      s += texture2D(tDiffuse, uv - vec2(0.0, px.y)).rgb * 0.15;
      return s;
    }
    float hash(vec3 p) {
      p = fract(p * vec3(443.897, 441.423, 437.195));
      p += dot(p, p.yzx + 19.19);
      return fract((p.x + p.y) * p.z);
    }
    // Roughly Gaussian (sum of uniforms), zero mean, unit variance.
    float gauss(vec3 p) {
      return (hash(p) + hash(p + 17.0) + hash(p + 41.0) + hash(p + 73.0) - 2.0) * 1.7320508;
    }

    void main() {
      float r = sampleSoft(lens(vUv, k1 + ca)).r;
      float g = sampleSoft(lens(vUv, k1)).g;
      float b = sampleSoft(lens(vUv, k1 - ca)).b;
      vec3 lin = pow(vec3(r, g, b), vec3(2.2));
      vec2 c = vUv - 0.5;
      lin *= gain * wb * (1.0 - vignette * dot(c, c) * 2.0);
      // Shot noise grows with the signal, read noise doesn't; gain amplifies both.
      vec3 p = vec3(gl_FragCoord.xy, frame);
      float luma = dot(lin, vec3(0.2126, 0.7152, 0.0722));
      float sd = noise * (sqrt(max(luma, 0.0)) * 0.9 + 0.08) * sqrt(gain);
      lin += sd * gauss(p);                                                // luminance noise
      lin += sd * 0.5 * vec3(gauss(p + 101.0), gauss(p + 211.0), gauss(p + 307.0)); // colour noise
      gl_FragColor = vec4(pow(clamp(lin, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
    }`,
};

class SensorPass extends Pass {
  private readonly blend = new THREE.ShaderMaterial(BLEND);
  readonly sensor = new THREE.ShaderMaterial(SENSOR);
  private readonly blendQuad = new FullScreenQuad(this.blend);
  private readonly sensorQuad = new FullScreenQuad(this.sensor);
  private prev: THREE.WebGLRenderTarget;
  private cur: THREE.WebGLRenderTarget;
  private fresh = true;
  blurAmount = 0.3;

  constructor() {
    super();
    const opts = { type: THREE.HalfFloatType, depthBuffer: false } as const;
    this.prev = new THREE.WebGLRenderTarget(1, 1, opts);
    this.cur = new THREE.WebGLRenderTarget(1, 1, opts);
  }

  override setSize(w: number, h: number): void {
    this.prev.setSize(w, h);
    this.cur.setSize(w, h);
    this.sensor.uniforms.res.value.set(w, h);
    this.fresh = true;
  }

  override render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget): void {
    this.blend.uniforms.tDiffuse.value = read.texture;
    this.blend.uniforms.tPrev.value = this.prev.texture;
    this.blend.uniforms.amount.value = this.fresh ? 0 : this.blurAmount;
    this.fresh = false;
    renderer.setRenderTarget(this.cur);
    this.blendQuad.render(renderer);
    this.sensor.uniforms.tDiffuse.value = this.cur.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : _write);
    this.sensorQuad.render(renderer);
    [this.prev, this.cur] = [this.cur, this.prev];
  }
}

export class CameraFx {
  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly sensor = new SensorPass();
  private mount: Mount;
  private seed = -1;
  private frame = 0;
  private readonly camNo: number;
  private readonly saved = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), fov: 0 };
  private readonly size = new THREE.Vector2();
  exposure: Exposure = { gain: 1, flicker: 0.015, blur: 0.3 };
  /** Machine running: the mount vibrates. */
  running = false;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    private readonly camId: string,
  ) {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(this.sensor);
    this.mount = mountFor(0, camId);
    this.camNo = camNumber(camId);
  }

  setSeed(seed: number): void {
    if (seed === this.seed) return;
    this.seed = seed;
    this.mount = mountFor(seed, this.camId);
    const u = this.sensor.sensor.uniforms;
    u.k1.value = this.mount.k1;
    u.ca.value = this.mount.ca;
    u.vignette.value = this.mount.vignette;
    u.wb.value.copy(this.mount.wb);
  }

  /** Renders one frame through the camera, at sim time `t` (s). */
  /** Called during each render while the camera has the mount's pose (offset, knocks, sway). */
  onPosed: ((camera: THREE.PerspectiveCamera) => void) | null = null;

  render(camera: THREE.PerspectiveCamera, t: number): void {
    this.renderer.getDrawingBufferSize(this.size);
    if (this.size.x !== this.sensor.sensor.uniforms.res.value.x || this.size.y !== this.sensor.sensor.uniforms.res.value.y) {
      this.composer.setPixelRatio(1);
      this.composer.setSize(this.size.x, this.size.y);
    }
    const s = this.saved;
    s.position.copy(camera.position);
    s.quaternion.copy(camera.quaternion);
    s.fov = camera.fov;

    const m = this.mount;
    const shake = this.shake(t);
    // The mount offset is in the camera's own frame (right, up, back).
    camera.position.add(m.offset.clone().applyQuaternion(camera.quaternion));
    camera.rotateY(m.yaw + shake.yaw);
    camera.rotateX(m.pitch + shake.pitch);
    camera.rotateZ(m.roll + shake.roll);
    camera.fov = s.fov * m.fovScale;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    this.onPosed?.(camera);

    const e = this.exposure;
    const flicker = 1 + e.flicker * (Math.sin(2 * Math.PI * m.flickerHz * t) + 0.3 * hashSigned(this.seed, this.frame, 99));
    const u = this.sensor.sensor.uniforms;
    u.gain.value = e.gain * flicker;
    u.noise.value = m.noise;
    u.frame.value = this.frame++ % 997;
    this.sensor.blurAmount = e.blur;
    this.composer.render();

    camera.position.copy(s.position);
    camera.quaternion.copy(s.quaternion);
    camera.fov = s.fov;
    camera.updateProjectionMatrix();
  }

  /**
   * Vibration from the running line (a few hundredths of a degree), a slow sway, and now and then
   * a knock (someone bumps the mast) that rings out over a few seconds.
   */
  private shake(t: number): { yaw: number; pitch: number; roll: number } {
    const deg = Math.PI / 180;
    const vib = this.running ? 0.03 * deg : 0.004 * deg;
    let yaw = vib * (Math.sin(t * 2 * Math.PI * 11.3) + 0.6 * Math.sin(t * 2 * Math.PI * 17.9 + 1.3));
    let pitch = vib * (Math.sin(t * 2 * Math.PI * 13.1 + 0.7) + 0.5 * Math.sin(t * 2 * Math.PI * 7.7));
    yaw += 0.02 * deg * Math.sin(t * 2 * Math.PI * 0.23 + this.seed + this.camNo);
    // Knocks: in some 90 s slots, at a random moment; each camera on its own mast.
    const SLOT = 90;
    for (const k of [Math.floor(t / SLOT), Math.floor(t / SLOT) - 1]) {
      if (k < 0 || hash01(this.seed, this.camNo, k, 501) > 0.25) continue;
      const at = (k + hash01(this.seed, this.camNo, k, 502)) * SLOT;
      const dt = t - at;
      if (dt < 0 || dt > 6) continue;
      const amp = (0.25 + 0.35 * hash01(this.seed, this.camNo, k, 503)) * deg * Math.exp(-dt * 1.2);
      yaw += amp * Math.sin(dt * 2 * Math.PI * 3.1);
      pitch += amp * 0.7 * Math.sin(dt * 2 * Math.PI * 2.4 + 0.5);
    }
    return { yaw, pitch, roll: 0.3 * pitch };
  }
}
