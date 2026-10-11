/** Agent orbs on screen (kept out of world.ts): hit points, the inspect/probe anchor and the agent label pool.
 *  Labels are placed by the same layoutLabels pass as the node labels (spec: no second collision loop). */
import * as THREE from "three";
import { AMAX, partsText } from "../agents";
import type { Anchor } from "../ui/inspect";
import { paintParts } from "../ui/agents";
import type { Box, LItem } from "./labels";
import type { Loop } from "./loop";

export const AGENT_HIT_PX = 28;
export interface Scr { key: string; x: number; y: number; rpx: number }
export const isBKey = (k: string): boolean => k === "b0" || k === "b1" || k === "b2";
const tv = new THREE.Vector3();
function toScreen(L: Loop, pos: THREE.Vector3, cam: THREE.PerspectiveCamera, W: number, H: number, r: number, key: string): Scr {
  tv.copy(pos).add(L.off!); const d = tv.distanceTo(cam.position); tv.project(cam);
  return { key, x: (tv.x * 0.5 + 0.5) * W, y: (-tv.y * 0.5 + 0.5) * H, rpx: ((r / (d * Math.tan((cam.fov * Math.PI) / 360))) * H) / 2 };
}

/** Every visible agent orb of a loop on screen; `grow` widens the radius (1.6 for picking, as the prototype). `out` is reused. */
export function projectAgents(L: Loop, cam: THREE.PerspectiveCamera, W: number, H: number, out: Scr[] = [], grow = 1): Scr[] {
  out.length = 0;
  if (!L.off) return out;
  for (const q of L.slots) if (q.key && q.pts.visible && q.a >= 0.1) out.push(toScreen(L, q.pos, cam, W, H, q.pts.scale.x * grow, q.T?.aid ?? q.key));
  return out;
}

export function agentAnchor(L: Loop | undefined, id: string, cam: THREE.PerspectiveCamera, W: number, H: number): Anchor | null {
  if (!L || !L.off) return null;
  const q = L.slots.find((z) => z.key && z.T?.aid === id && z.pts.visible);
  if (!q) return null;
  const s = toScreen(L, q.pos, cam, W, H, q.pts.scale.x, id);
  return { x: s.x, y: s.y, r: Math.max(s.rpx, AGENT_HIT_PX) };
}

interface AL { el: HTMLElement; a: HTMLElement; b: HTMLElement; w: number; h: number; kk: string; id: string; op: number }
export function agentLabelPool(host: HTMLElement) {
  const pool: AL[] = Array.from({ length: AMAX + 3 }, () => {
    const el = document.createElement("div"); el.className = "nl right";
    const a = document.createElement("b"), b = document.createElement("span"); el.append(a, b); host.appendChild(el);
    return { el, a, b, w: 0, h: 0, kk: "", id: "", op: 0 };
  });
  let used = 0;
  return {
    /** Sized label items for the focused loop's agent labels, appended to `items` (screen px). */
    collect(L: Loop | undefined, cam: THREE.PerspectiveCamera, W: number, H: number, items: LItem[]): void {
      used = 0;
      if (!L || !L.off) return;
      for (const it of L.agL) {
        if (used >= pool.length) break;
        const q = L.slots.find((z) => z.key && z.T?.aid === it.key);
        if (!q || !q.pts.visible || q.a < 0.05) continue;
        const lb = pool[used++], kk = it.t1 + "\u0001" + partsText(it.t2) + "\u0001" + it.t2.map((p) => p.color ?? "").join();
        if (lb.kk !== kk) { lb.kk = kk; lb.a.textContent = it.t1; paintParts(lb.b, it.t2); lb.w = 0; }
        lb.a.style.color = it.c1; lb.b.style.color = it.c2; lb.id = it.id; lb.op = Math.min(1, q.a * 1.5);
        if (!lb.w) { lb.w = lb.el.offsetWidth; lb.h = lb.el.offsetHeight; }
        const s = toScreen(L, q.pos, cam, W, H, q.pts.scale.x, it.id);
        items.push({ key: it.id, r: q.pts.scale.x, mode: it.group ? "below" : "right", x: s.x, y: s.y, rpx: s.rpx, w: lb.w, h: lb.h });
      }
    },
    /** Moves the collected labels to their laid-out boxes; hides the rest. */
    place(put: Record<string, Box & { md: string }>, op: number): void {
      for (let i = 0; i < pool.length; i++) {
        const lb = pool[i], p = i < used ? put[lb.id] : undefined;
        if (!p || op < 0.01) { if (lb.el.style.opacity !== "0") lb.el.style.opacity = "0"; continue; }
        const cn = "nl " + (p.md === "left" ? "left" : p.md === "right" ? "right" : "c");
        if (lb.el.className !== cn) lb.el.className = cn;
        lb.el.style.transform = `translate3d(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px,0)`;
        lb.el.style.opacity = (op * lb.op).toFixed(2);
      }
    },
    resize(): void { for (const lb of pool) lb.w = 0; },
  };
}
