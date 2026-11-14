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

    this.camera.position.set(0.9, 2.3, 2.7);
    this.controls = new OrbitControls(this.camera, this.labels.domElement);
    this.controls.target.set(0, 0.9, 0);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 0.15;
    this.controls.maxDistance = 14;

    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3328, 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
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
    this.scene.add(sun);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const grid = new THREE.GridHelper(20, 40, 0x4b525c, 0x434951);
    grid.position.y = 0.001;
    this.scene.add(grid);

    const resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      this.renderer.setSize(w, h);
      this.labels.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    new ResizeObserver(resize).observe(container);
    resize();
  }

  render(): void {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }
}
