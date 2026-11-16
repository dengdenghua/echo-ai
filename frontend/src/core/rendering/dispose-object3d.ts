import * as THREE from "three";

function disposeMaterial(material: THREE.Material): void {
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture) value.dispose();
  }
  if (material instanceof THREE.ShaderMaterial) {
    for (const uniform of Object.values(material.uniforms)) {
      const value: unknown = uniform?.value;
      if (value instanceof THREE.Texture) value.dispose();
    }
  }
  material.dispose();
}

function disposeMaterials(
  material: THREE.Material | THREE.Material[],
): void {
  const materials = Array.isArray(material) ? material : [material];
  for (const item of materials) disposeMaterial(item);
}

/** Releases every GPU-backed resource reachable from a scene graph. */
export function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (
      object instanceof THREE.Mesh ||
      object instanceof THREE.Line ||
      object instanceof THREE.Points
    ) {
      object.geometry.dispose();
      disposeMaterials(object.material);
    } else if (object instanceof THREE.Sprite) {
      disposeMaterials(object.material);
    }
    if (object instanceof THREE.SkinnedMesh) {
      object.skeleton.boneTexture?.dispose();
    }
  });
  root.clear();
}
