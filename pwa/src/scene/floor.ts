import * as THREE from "three";
import { HEX } from "../config";
import { FLOOR_FRAG, FLOOR_VERT, WORD_FRAG, WORD_VERT } from "./shaders";

/** One uniform set shared by floor and wordmark; the scene copies fieldUniforms() into it. */
export function fieldU() {
  return {
    uTime: { value: 0 }, uMorph: { value: 0 }, uOrigin: { value: new THREE.Vector3() },
    uPulseOrigin: { value: new THREE.Vector2() }, uPulseT: { value: -1 }, uActivity: { value: 0 },
    uAttn: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
    uAmber: { value: new THREE.Color(HEX.jev) }, uRed: { value: new THREE.Color(HEX.deny) }, uLine: { value: new THREE.Color(0x3a4250) },
  };
}
export type FieldU = ReturnType<typeof fieldU>;

export function makeFloor(U: FieldU): THREE.Mesh {
  const g = new THREE.PlaneGeometry(260, 260, 130, 130); g.rotateX(-Math.PI / 2);
  const m = new THREE.ShaderMaterial({ uniforms: U, vertexShader: FLOOR_VERT, fragmentShader: FLOOR_FRAG, transparent: true, depthWrite: false, extensions: { derivatives: true } });
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = -1;
  return mesh;
}

/** Landscape: flat on the floor inside the trunk ring, in front. Portrait: below the ring, upright, 70%. */
export const WORD = {
  land: { pos: new THREE.Vector3(0, 0.03, 8.5), rotX: -Math.PI / 2, scale: 1 },
  port: { pos: new THREE.Vector3(0, -13.5, -0.75), rotX: 0, scale: 0.7 },
  width: 16, opacity: 0.1,
} as const;

export function makeWordmark(U: FieldU): { mesh: THREE.Mesh; draw(): void; uOpacity: { value: number } } {
  const cv = document.createElement("canvas"); cv.width = 2048; cv.height = 256;
  const tex = new THREE.CanvasTexture(cv), uOpacity = { value: 0 };
  const draw = () => {
    const c = cv.getContext("2d"); if (!c) return;
    c.clearRect(0, 0, cv.width, cv.height);
    c.font = "600 200px Archivo, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
    c.lineWidth = 3; c.strokeStyle = "#fff"; c.strokeText("FLOWOBSERVE", cv.width / 2, cv.height / 2);
    tex.needsUpdate = true;
  };
  draw();
  const mat = new THREE.ShaderMaterial({ uniforms: { ...U, uMap: { value: tex }, uOpacity }, vertexShader: WORD_VERT, fragmentShader: WORD_FRAG, transparent: true, depthWrite: false });
  return { mesh: new THREE.Mesh(new THREE.PlaneGeometry(WORD.width, WORD.width * cv.height / cv.width), mat), draw, uOpacity };
}
