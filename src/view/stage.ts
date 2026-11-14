import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

/** Renderer, camera, orbit controls, lights and floor. */
export class Stage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
  readonly renderer: THREE.WebGLRenderer;
  readonly labels = new CSS2DRenderer();
  readonly controls: OrbitControls;
  /** Width (px) covered by a panel on the right; the view centres on the uncovered part. */
  private insetRight = 0;
  private resize: () => void;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);
    this.labels.domElement.className = 'labels';
    container.appendChild(this.labels.domElement);

    this.scene.background = new THREE.Color(0x1b1e23);
    // Soft studio reflections so metal parts (fixtures, rails, bowls) don't render black.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.6;
    this.scene.fog = new THREE.Fog(0x1b1e23, 12, 30);

    this.camera.position.set(0.7, 2.6, 3.2);
    this.controls = new OrbitControls(this.camera, this.labels.domElement);
    this.controls.target.set(0, 0.9, 0);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 0.15;
    this.controls.maxDistance = 14;

    // Broad fill plus a softer key light, so shadows don't stripe the work area.
    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3328, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(2.5, 6, 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const sc = sun.shadow.camera;
    sc.left = -4;
    sc.right = 4;
    sc.top = 3;
    sc.bottom = -3;
    sc.near = 1;
    sc.far = 15;
    sun.shadow.bias = -0.0005;
    sun.shadow.radius = 4;
    this.scene.add(sun);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const grid = new THREE.GridHelper(20, 40, 0x4b525c, 0x434951);
    grid.position.y = 0.001;
    this.scene.add(grid);

    this.resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      this.renderer.setSize(w, h);
      this.labels.setSize(w, h);
      // Render the canvas as the right-hand part of a wider virtual view, so its centre sits in
      // the middle of the uncovered area.
      const inset = Math.min(this.insetRight, w * 0.4);
      this.camera.aspect = (w + inset) / h;
      if (inset > 0) this.camera.setViewOffset(w + inset, h, inset, 0, w, h);
      else this.camera.clearViewOffset();
      this.camera.updateProjectionMatrix();
    };
    new ResizeObserver(this.resize).observe(container);
    this.resize();
  }

  /**
   * Moves the camera along its current viewing direction (toward the box centre) to the closest
   * distance at which the whole box is in view, with a margin, in the area the side panel leaves free.
   */
  fit(box: THREE.Box3): void {
    const centre = box.getCenter(new THREE.Vector3());
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
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
    fits(hi);
    this.controls.target.copy(centre);
    this.controls.update();
  }

  setInsetRight(px: number): void {
    this.insetRight = px;
    this.resize();
  }

  render(): void {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }
}
