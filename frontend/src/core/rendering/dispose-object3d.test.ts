import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";

import { disposeObject3D } from "./dispose-object3d";

describe("disposeObject3D", () => {
  it("disposes nested geometry, material, and every material texture", () => {
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    const map = new THREE.Texture();
    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshStandardMaterial({ map });
    group.add(new THREE.Mesh(geometry, material));
    scene.add(group);
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(material, "dispose");
    const textureDispose = vi.spyOn(map, "dispose");

    disposeObject3D(scene);

    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(textureDispose).toHaveBeenCalledOnce();
    expect(scene.children).toHaveLength(0);
  });

  it("disposes line, points and sprite resources", () => {
    const scene = new THREE.Scene();
    const lineGeometry = new THREE.BufferGeometry();
    const lineMaterial = new THREE.LineBasicMaterial();
    const pointsGeometry = new THREE.BufferGeometry();
    const pointsMaterial = new THREE.PointsMaterial();
    const spriteMaterial = new THREE.SpriteMaterial();
    scene.add(new THREE.Line(lineGeometry, lineMaterial));
    scene.add(new THREE.Points(pointsGeometry, pointsMaterial));
    scene.add(new THREE.Sprite(spriteMaterial));
    const disposers = [
      vi.spyOn(lineGeometry, "dispose"),
      vi.spyOn(lineMaterial, "dispose"),
      vi.spyOn(pointsGeometry, "dispose"),
      vi.spyOn(pointsMaterial, "dispose"),
      vi.spyOn(spriteMaterial, "dispose"),
    ];

    disposeObject3D(scene);

    for (const dispose of disposers) expect(dispose).toHaveBeenCalledOnce();
  });
});
