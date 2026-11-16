// blender-preview — the three.js scene behind the preview: load, frame, orbit,
// light, and drive animation clips. No React here; the body component owns one
// of these per open tab and disposes it when the tab closes.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export const BACKGROUNDS = { dark: 0x1e1e1f, light: 0xe9e9ec };

/** Parse GLB/glTF bytes. External buffers or images (a .gltf beside its .bin) cannot be fetched from here. */
export function parseGltf(bytes) {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(buffer, '', (gltf) => resolve({ root: gltf.scene, clips: gltf.animations ?? [] }), (error) => {
      const message = String(error?.message ?? error);
      reject(new Error(/fetch|Failed to load|404/i.test(message)
        ? `This glTF points to separate files (${message}). Export it as a single .glb to preview it here.`
        : message));
    });
  });
}

/** Parse OBJ text. OBJ has no animation; materials (.mtl) are not loaded, so a neutral one is applied. */
export function parseObj(bytes) {
  const text = new TextDecoder().decode(bytes);
  const root = new OBJLoader().parse(text);
  const material = new THREE.MeshStandardMaterial({ color: 0xb8b8bc, roughness: 0.55, metalness: 0.05 });
  root.traverse((node) => {
    if (node.isMesh) node.material = material;
  });
  return { root, clips: [] };
}

/** Count what the model holds, for the info chips. */
export function statsOf(root) {
  let meshes = 0;
  let triangles = 0;
  const materials = new Set();
  let skinned = false;
  root.traverse((node) => {
    if (!node.isMesh) return;
    meshes += 1;
    if (node.isSkinnedMesh) skinned = true;
    const geometry = node.geometry;
    const count = geometry.index ? geometry.index.count : geometry.attributes.position?.count ?? 0;
    triangles += Math.floor(count / 3);
    for (const material of [].concat(node.material)) if (material) materials.add(material.uuid);
  });
  return { meshes, triangles, materials: materials.size, skinned };
}

export class ModelViewer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.outline = 'none';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BACKGROUNDS.dark);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.environment;
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(3, 6, 4);
    this.scene.add(sun);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
    this.camera.position.set(2.5, 1.8, 3.2);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.autoRotateSpeed = 1.6;

    this.grid = new THREE.GridHelper(10, 20, 0x5a5a5e, 0x3a3a3e);
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.55;
    this.scene.add(this.grid);

    this.clock = new THREE.Clock();
    this.mixer = null;
    this.action = null;
    this.clips = [];
    this.playing = false;
    this.speed = 1;
    this.root = null;
    this.wireframe = false;
    this.onTick = null;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.loop = this.loop.bind(this);
    this.frame = requestAnimationFrame(this.loop);
  }

  resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** Put a model on stage, framed, with its clips ready (the first one playing). */
  show({ root, clips }) {
    if (this.root) this.scene.remove(this.root);
    this.root = root;
    this.scene.add(root);
    this.clips = clips;
    this.mixer = clips.length > 0 ? new THREE.AnimationMixer(root) : null;
    this.action = null;
    if (clips.length > 0) this.selectClip(0, true);
    this.frameModel();
    this.applyWireframe();
  }

  /** Fit the camera to the model and sit the grid under it. */
  frameModel() {
    if (!this.root) return;
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.root, true);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 1e-3);
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.15;
    const direction = new THREE.Vector3(1, 0.65, 1.25).normalize();
    this.camera.position.copy(center).addScaledVector(direction, distance);
    this.camera.near = Math.max(distance / 1000, 1e-4);
    this.camera.far = distance * 100;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.minDistance = radius * 0.05;
    this.controls.maxDistance = distance * 20;
    this.controls.update();
    const span = Math.max(size.x, size.z, radius) * 3;
    this.grid.scale.setScalar(span / 10);
    this.grid.position.set(center.x, box.min.y, center.z);
  }

  selectClip(index, autoplay = this.playing) {
    if (!this.mixer) return;
    this.mixer.stopAllAction();
    const clip = this.clips[index];
    if (!clip) return;
    this.action = this.mixer.clipAction(clip);
    this.action.reset();
    this.action.setLoop(THREE.LoopRepeat, Infinity);
    this.action.play();
    this.playing = autoplay;
    this.action.paused = !autoplay;
  }

  setPlaying(playing) {
    if (!this.action) return;
    this.playing = playing;
    this.action.paused = !playing;
  }

  seek(time) {
    if (!this.action || !this.mixer) return;
    this.action.time = Math.max(0, Math.min(time, this.action.getClip().duration));
    this.mixer.update(0);
  }

  get time() {
    return this.action ? this.action.time : 0;
  }

  get duration() {
    return this.action ? this.action.getClip().duration : 0;
  }

  setWireframe(on) {
    this.wireframe = on;
    this.applyWireframe();
  }

  applyWireframe() {
    this.root?.traverse((node) => {
      if (!node.isMesh) return;
      for (const material of [].concat(node.material)) if (material && 'wireframe' in material) material.wireframe = this.wireframe;
    });
  }

  setGrid(on) {
    this.grid.visible = on;
  }

  setAutoRotate(on) {
    this.controls.autoRotate = on;
  }

  setBackground(name) {
    this.scene.background = new THREE.Color(BACKGROUNDS[name] ?? BACKGROUNDS.dark);
  }

  loop() {
    this.frame = requestAnimationFrame(this.loop);
    const delta = this.clock.getDelta();
    if (this.mixer && this.playing) this.mixer.update(delta * this.speed);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.onTick?.();
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.mixer?.stopAllAction();
    this.scene.traverse((node) => {
      if (!node.isMesh) return;
      node.geometry?.dispose();
      for (const material of [].concat(node.material)) {
        if (!material) continue;
        for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
        material.dispose();
      }
    });
    this.environment.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this.renderer.domElement.remove();
  }
}
