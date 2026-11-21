import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './contact';
import { Hall } from './hall';
import { type RoomLight, roomEnvironment } from './environment';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import type { CameraPose } from './cameras';

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const DAY_ROOM: RoomLight = { strips: 12, stripColor: 0xfff4e4, room: 1, windows: 1.3, windowColor: 0xd5dee2 };

/** Renderer, camera, orbit controls and lights. The floor is the line's plate (LineView). */
export class Stage {
  readonly scene = new THREE.Scene();
  readonly hall: Hall;
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
  readonly renderer: THREE.WebGLRenderer;
  readonly labels = new CSS2DRenderer();
  readonly controls: OrbitControls;
  /** Width (px) covered by a panel on the right; the view centres on the uncovered part. */
  private insetRight = 0;
  /** Eases toward insetRight, so the view glides when the panels hide or show. */
  private inset = 0;
  private size = { w: 1, h: 1 };
  private lastRender = 0;
  private resize: () => void;
  /** Draw the DOM labels (off for a capture feed, which only records the canvas). */
  showLabels = true;
  /** Called when the user starts orbiting/zooming: the view is no longer a fixed camera. */
  onUserMove?: () => void;
  /** Called after the canvas changes size. */
  onResize?: () => void;
  /** Broad fill and key light (see SceneView for the lighting presets). */
  readonly hemi = new THREE.HemisphereLight(0xdfe8ff, 0x3a3328, 1.1);
  /**
   * The key light comes from above the viewer's side, turned `yaw` (rad) off the view direction
   * and `elevation` (rad) above the floor, as a photographer sets a key: faces toward the camera
   * are lit, shadows fall back and to the side where they show the shapes, and none fall across
   * what a station camera looks at.
   */
  readonly key = { yaw: 0.7, elevation: 0.9 };
  private readonly keyOffset = new THREE.Vector3();
  readonly sun = new THREE.DirectionalLight(0xffffff, 1.6);
  /**
   * Replaces the plain render (a camera feed's post-processing, camerafx.ts). Gets the scene and
   * camera, and must draw the frame to the canvas.
   */
  renderOverride: ((renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) => void) | null = null;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);
    this.labels.domElement.className = 'labels';
    container.appendChild(this.labels.domElement);

    this.scene.background = new THREE.Color(0x9da9a9);
    this.hall = new Hall(this.scene);
    // Reflections and ambient light come from a probe of the room (environment.ts); the
    // lighting preset replaces it (SceneView).
    this.setRoom(DAY_ROOM);
    this.scene.environmentIntensity = 1;
    this.scene.fog = new THREE.Fog(0x8f9795, 6, 34);

    this.camera.position.set(0.7, 2.6, 3.2);
    this.controls = new OrbitControls(this.camera, this.labels.domElement);
    this.controls.target.set(0, 0.9, 0);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 0.15;
    this.controls.maxDistance = 14;
    this.controls.addEventListener('start', () => this.onUserMove?.());

    // Broad fill plus a softer key light, so shadows don't stripe the work area.
    this.scene.add(this.hemi);
    const sun = this.sun;
    sun.position.set(2.5, 6, 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -4;
    sc.right = 4;
    sc.top = 3;
    sc.bottom = -3;
    sc.near = 1;
    sc.far = 15;
    sun.shadow.bias = -0.0001;
    sun.shadow.normalBias = 0.00032;
    // A narrow filter: the penumbra stays soft without its dither showing on large faces.
    sun.shadow.radius = 2.5;
    this.scene.add(sun, sun.target);

    this.resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      this.size = { w, h };
      this.renderer.setSize(w, h);
      this.labels.setSize(w, h);
      this.project();
      this.onResize?.();
    };
    new ResizeObserver(this.resize).observe(container);
    this.resize();
  }

  /**
   * Renders the canvas as the right-hand part of a wider virtual view, so the centre of the view
   * sits in the middle of the area the side panel leaves free.
   */
  private project(): void {
    const { w, h } = this.size;
    const inset = Math.min(this.inset, w * 0.4);
    this.camera.aspect = (w + inset) / h;
    if (inset > 0.5) this.camera.setViewOffset(w + inset, h, inset, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  private roomKey = '';
  /** Re-renders the reflection/ambient probe for the room's light (once per preset). */
  setRoom(light: RoomLight): void {
    const key = JSON.stringify(light);
    if (key === this.roomKey) return;
    this.roomKey = key;
    const old = this.scene.environment;
    this.scene.environment = roomEnvironment(this.renderer, light);
    old?.dispose();
  }

  /** Cuts to a camera pose, like switching to another camera on a monitoring screen. */
  view(p: CameraPose): void {
    this.camera.fov = p.fov;
    this.camera.position.copy(p.position);
    this.controls.target.copy(p.target);
    this.camera.lookAt(p.target);
    this.project();
    this.controls.update();
  }

  /**
   * The pose looking along `direction` (toward the box centre) from the closest distance at which
   * the whole box is in view, with a margin, in the area the side panel leaves free.
   */
  fitPose(box: THREE.Box3, direction: THREE.Vector3, fov = 45): CameraPose {
    const saved = { position: this.camera.position.clone(), quaternion: this.camera.quaternion.clone(), fov: this.camera.fov };
    this.camera.fov = fov;
    this.project();
    const centre = box.getCenter(new THREE.Vector3());
    const dir = direction.clone().normalize();
    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(
      (i) => new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z),
    );
    const fits = (d: number) => {
      this.camera.position.copy(centre).addScaledVector(dir, d);
      this.camera.lookAt(centre);
      this.camera.updateMatrixWorld();
      // Leave room for the top bar and a little air at the edges.
      return corners.every((c) => {
        const p = c.clone().project(this.camera);
        return Math.abs(p.x) <= 0.94 && p.y <= 0.8 && p.y >= -0.94;
      });
    };
    let lo = 0.5;
    let hi = 30;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    const position = centre.clone().addScaledVector(dir, hi);
    this.camera.position.copy(saved.position);
    this.camera.quaternion.copy(saved.quaternion);
    this.camera.fov = saved.fov;
    this.project();
    return { position, target: centre, fov };
  }

  setInsetRight(px: number, immediate = false): void {
    this.insetRight = px;
    if (immediate) {
      this.inset = px;
      this.project();
    }
  }

  render(): void {
    const now = performance.now();
    const dt = Math.min((now - this.lastRender) / 1000, 0.1);
    this.lastRender = now;
    if (Math.abs(this.inset - this.insetRight) > 0.5) {
      this.inset += (this.insetRight - this.inset) * Math.min(1, dt * 8);
      this.project();
    } else if (this.inset !== this.insetRight) {
      this.inset = this.insetRight;
      this.project();
    }
    this.controls.update();
    // Installed cameras see less than two metres of machinery. Concentrate
    // their shadow texels and cull the other cells from the light pass.
    const span = THREE.MathUtils.clamp(this.camera.position.distanceTo(this.controls.target) * 1.32, 1.1, 4.1);
    const sc = this.sun.shadow.camera;
    if (Math.abs(sc.right - span) > 0.001) {
      sc.left = -span;
      sc.right = span;
      sc.top = 0.82 * span;
      sc.bottom = -sc.top;
      sc.updateProjectionMatrix();
      // A few shadow texels along the normal: no acne on faces the key grazes.
      this.sun.shadow.normalBias = (2.5 * 2 * span) / this.sun.shadow.mapSize.x;
    }
    const k = this.keyOffset.copy(this.camera.position).sub(this.controls.target).setY(0);
    if (k.lengthSq() < 1e-8) k.set(0, 0, 1);
    k.normalize().applyAxisAngle(Y_AXIS, this.key.yaw).multiplyScalar(7 * Math.cos(this.key.elevation));
    k.y = 7 * Math.sin(this.key.elevation);
    this.sun.target.position.copy(this.controls.target);
    this.sun.position.copy(this.sun.target.position).add(k);
    this.hall.cutaway(this.camera.position);
    if (this.renderOverride) this.renderOverride(this.renderer, this.scene, this.camera);
    else this.renderer.render(this.scene, this.camera);
    if (this.showLabels) this.labels.render(this.scene, this.camera);
  }
}
