import * as THREE from "three";

import { disposeObject3D } from "./dispose-object3d";

export function renderDirectorFrame({
  renderer,
  scene,
  camera,
  host,
  character,
  label,
  showLabel,
}: {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  host: HTMLElement;
  character: THREE.Object3D;
  label: HTMLElement | null;
  showLabel: boolean;
}): void {
  renderer.render(scene, camera);
  if (!label) return;
  const point = character.getWorldPosition(new THREE.Vector3());
  point.y += 1.9;
  point.project(camera);
  const visible = showLabel && point.z > -1 && point.z < 1;
  label.style.display = visible ? "block" : "none";
  if (!visible) return;
  label.style.left = `${((point.x + 1) / 2) * host.clientWidth}px`;
  label.style.top = `${((-point.y + 1) / 2) * host.clientHeight}px`;
}

/** Render, then read synchronously so the canvas need not preserve its buffer. */
export function captureDirectorFrame({
  renderer,
  scene,
  camera,
}: {
  renderer: {
    render(scene: THREE.Scene, camera: THREE.Camera): void;
    domElement: { toDataURL(type?: string): string };
  };
  scene: THREE.Scene;
  camera: THREE.Camera;
}): string {
  renderer.render(scene, camera);
  return renderer.domElement.toDataURL("image/png");
}

/** Drop every GPU resource owned by one DirectorStage mount. */
export function disposeDirectorStageRenderer(
  scene: THREE.Scene,
  renderer: Pick<THREE.WebGLRenderer, "forceContextLoss" | "dispose">,
): void {
  if (scene.background instanceof THREE.Texture) scene.background.dispose();
  disposeObject3D(scene);
  renderer.forceContextLoss();
  renderer.dispose();
}
