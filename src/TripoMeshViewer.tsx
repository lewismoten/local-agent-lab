import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { TripoMesh } from './tripoRuntime.ts';
import { createTripoGeometry } from './tripoThree.ts';

export default function TripoMeshViewer({ mesh }: { mesh: TripoMesh }) {
  const viewport = useRef<HTMLDivElement>(null);
  const resetView = useRef<() => void>(() => {});
  const renderView = useRef<() => void>(() => {});
  const materialRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const [wireframe, setWireframe] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const host = viewport.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return; }
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#20252b');
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
    const geometry = createTripoGeometry(mesh);
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85, metalness: 0 });
    materialRef.current = material;
    const object = new THREE.Mesh(geometry, material);
    scene.add(object);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x65717c, 2.2));
    const light = new THREE.DirectionalLight(0xffffff, 2.4);
    light.position.set(3, 5, 4);
    scene.add(light);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.screenSpacePanning = true;
    controls.zoomToCursor = true;
    const sphere = geometry.boundingSphere ?? new THREE.Sphere(new THREE.Vector3(), 1);
    const radius = Math.max(sphere.radius, 0.01);
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.05;
    controls.minDistance = radius * 0.15;
    controls.maxDistance = radius * 30;
    const render = () => renderer.render(scene, camera);
    renderView.current = render;
    controls.addEventListener('change', render);
    resetView.current = () => {
      controls.target.copy(sphere.center);
      camera.position.copy(sphere.center).add(new THREE.Vector3(0.7, 0.35, 1).normalize().multiplyScalar(distance));
      controls.update();
      render();
    };
    resetView.current();
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    host.append(renderer.domElement);
    const resize = () => {
      const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    return () => {
      observer.disconnect();
      controls.removeEventListener('change', render);
      controls.dispose();
      geometry.dispose();
      material.dispose();
      materialRef.current = null;
      renderer.dispose();
      renderer.domElement.remove();
      resetView.current = () => {};
      renderView.current = () => {};
    };
  }, [mesh]);

  useEffect(() => {
    if (materialRef.current) {
      materialRef.current.wireframe = wireframe;
      renderView.current();
    }
  }, [wireframe]);

  return <section className="tripo-mesh-viewer" aria-label="Interactive 3D mesh viewer">
    <div className="tripo-viewer-toolbar"><strong>3D mesh</strong><button className="button secondary compact" type="button" onClick={() => resetView.current()}>Reset view</button><label><input type="checkbox" checked={wireframe} onChange={event => setWireframe(event.target.checked)}/> Wireframe</label></div>
    {error ? <p role="alert" className="model-error">3D viewer unavailable: {error}</p> : <div ref={viewport} className="tripo-viewer-viewport"/>}
    <small>Drag to rotate · scroll to zoom · right drag or Shift drag to pan</small>
  </section>;
}
