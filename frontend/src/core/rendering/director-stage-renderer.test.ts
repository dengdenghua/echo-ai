import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";

import {
  captureDirectorFrame,
  disposeDirectorStageRenderer,
} from "./director-stage-renderer";

describe("captureDirectorFrame", () => {
  it("renders immediately before reading a non-preserved canvas", () => {
    const calls: string[] = [];
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const data = captureDirectorFrame({
      renderer: {
        render: () => calls.push("render"),
        domElement: {
          toDataURL: () => {
            calls.push("toDataURL");
            return "data:image/png;base64,frame";
          },
        },
      },
      scene,
      camera,
    });

    expect(calls).toEqual(["render", "toDataURL"]);
    expect(data).toBe("data:image/png;base64,frame");
  });
});

describe("disposeDirectorStageRenderer", () => {
  it("disposes background, graph resources, and the WebGL context", () => {
    const scene = new THREE.Scene();
    const background = new THREE.Texture();
    scene.background = background;
    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshBasicMaterial({ map: new THREE.Texture() });
    scene.add(new THREE.Mesh(geometry, material));
    const backgroundDispose = vi.spyOn(background, "dispose");
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(material, "dispose");
    const forceContextLoss = vi.fn();
    const rendererDispose = vi.fn();

    disposeDirectorStageRenderer(scene, {
      forceContextLoss,
      dispose: rendererDispose,
    });

    expect(backgroundDispose).toHaveBeenCalledOnce();
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(forceContextLoss).toHaveBeenCalledOnce();
    expect(rendererDispose).toHaveBeenCalledOnce();
    expect(scene.children).toHaveLength(0);
  });
});
