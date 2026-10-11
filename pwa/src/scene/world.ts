import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { HEX, SP } from "../config";
import { FLASH_MS, flashLit, flashSeen } from "./flash";
import { NEEDS_YOU } from "../layout";
import { celebrate, pager } from "../pager";
import { eff } from "../select";
import { changed, now, store, ui, view, type Pick } from "../state";
import { applyOrbit, orbit, orbitTick } from "./orbit";
import { $, clamp, easeIO, easeOut, smooth } from "../util";
import { buildGeometry } from "./geometry";
import { frameLanes } from "./lanes";
import { disposeLoop, frameAgents, makeLoop, oKeys, stateOf, tKeys, TR, writePackets, type Loop, type LoopCtx, type Packet } from "./loop"; import { arcHead, arcStep, isAtt, labelHex } from "./arc";
import { ESC_MS, LIFE, RateWindow, sceneTier, speedOf, stallMin, tierOf, type Tier } from "./rate";
import { topology } from "./topology";
import { fieldUniforms, floorAt, type FieldUniforms } from "./field";
import { fieldU, makeFloor, makeWordmark, WORD } from "./floor";
import { bloomOn, capOn, type CapGate, demand, due, frameDt, minGapMs, sceneSig, wake, wantsFrame, type BloomGate, type Motion, type SigRow } from "./demand";
import { GpuTimer, perf } from "./perf";
import { boxOf, coreHidden, coreLabels, hitNode, HIT_MIN_PX, LABEL_DEFS, layoutLabels, nodeOf, obstacles, projector, type Box, type LItem, type Pt } from "./labels";
import { placeInspect, type Anchor } from "../ui/inspect";
import { awayKey, galaxyLayout, projectSubset, threadEnd, type Galaxy } from "./galaxy";
import { galaxyFrame, makeThreads, overviewFrame, poseBox } from "./threads";
import { cpage } from "../ui/cards";
import type { Page } from "../layout";
import type { NodeKey } from "@fo/shared";
import { agentSig } from "../agents";
import { AGENT_HIT_PX, agentAnchor, agentLabelPool, isBKey, projectAgents, type Scr } from "./agentScreen";

const seats = new Map<string, number>();
/** Spec §3.6: positions (x, y, z) of the bright point drawn at each project core, in grid units (the galaxy frame matrix scales them like the loops). */
export function corePointPositions(cores: { x: number; z: number }[]): Float32Array {
  const a = new Float32Array(cores.length * 3);
  cores.forEach((c, i) => { a[i * 3] = c.x; a[i * 3 + 2] = c.z; });
  return a;
}
/** Spec §3.6: the galaxy of every project group on every card page (the loop zone never pages), wrapped to the zone's aspect;
 *  ids = the chat loops that exist (a lone placeholder when there are none). */
export function fleetGalaxy(pages: Page[], aspect: number, seat: Map<string, number> = seats): { g: Galaxy; ids: string[] } {
  const g = galaxyLayout({ groups: pages.flatMap((p) => p.groups) }, seat, aspect), ids = g.loops.map((l) => l.id);
  return { g, ids: ids.length ? ids : ["__empty"] };
}

export interface Scene { frame(): boolean; sync(): void; resize(): void; relayout(portrait: boolean): void; pick(x: number, y: number): Pick | null; nodeScreen(key: NodeKey): Anchor | null; agentScreen(id: string): Anchor | null }

interface Label { key: string; r: number; mL: string; mP: string; el: HTMLElement; a: HTMLElement; b: HTMLElement; pa: THREE.Vector3; pb: THREE.Vector3; w: number; h: number }

export function initScene(): Scene | null {
  const canvas = $<HTMLCanvasElement>("#gl")!, labelsEl = $("#labels")!;
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true }); }
  catch { document.body.classList.add("nogl"); return null; }
  const loopEl = $("#loop")!, head = $("#head")!;
  const DPR = Math.min(devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(DPR);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
  const sc = new THREE.Scene();
  sc.background = new THREE.Color(0x0a0a0f); const fog = new THREE.FogExp2(0x0a0a0f, 0.011); sc.fog = fog;
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
  const A = topology(false), B = topology(true);
  const FU = fieldU(), floor = makeFloor(FU), word = makeWordmark(FU), ZERO = new THREE.Vector3();
  sc.add(floor, word.mesh);
  document.fonts?.ready.then(() => { word.draw(); wake(performance.now()); });
  let fAt = floorAt(A, B, 0), fAtM = 0;
  const pingEl = $("#ping")!, curEl = $("#cur")!, wv = new THREE.Vector3(), wpts: Pt[] = [0, 1, 2, 3].map(() => ({ x: 0, y: 0 }));
  function wordBox(): Box {
    const g = word.mesh.geometry as THREE.PlaneGeometry, hw = g.parameters.width / 2, hh = g.parameters.height / 2;
    word.mesh.updateMatrixWorld();
    for (let i = 0; i < 4; i++) {
      wv.set(i & 1 ? hw : -hw, i & 2 ? hh : -hh, 0).applyMatrix4(word.mesh.matrixWorld).project(camera);
      wpts[i].x = (wv.x * 0.5 + 0.5) * W; wpts[i].y = (-wv.y * 0.5 + 0.5) * H;
    }
    return boxOf(wpts);
  }
  function syncPing(p: FieldUniforms["ping"], zf: number) {
    const L = pager.focus ? loops.get(pager.focus) : undefined;
    if (!p || !L || !L.off || zf < 0.5) { pingEl.className = ""; return; }
    tv.lerpVectors(nodeOf(A, p.key), nodeOf(B, p.key), morph.v).add(L.off).project(camera);
    pingEl.style.transform = `translate3d(${((tv.x * 0.5 + 0.5) * W).toFixed(1)}px,${((-tv.y * 0.5 + 0.5) * H).toFixed(1)}px,0)`;
    pingEl.className = p.kind === 2 ? "on red" : "on";
  }
  /** Reduced motion (spec §5): a still ring on the node where work is happening, instead of packets. */
  function syncCur(zf: number) {
    const L = pager.focus ? loops.get(pager.focus) : undefined;
    if (!ui.reduce || !L || !L.off || !L.act || zf < 0.5) { if (curEl.className) curEl.className = ""; return; }
    tv.lerpVectors(nodeOf(A, L.act), nodeOf(B, L.act), morph.v).add(L.off).project(camera);
    curEl.style.transform = `translate3d(${((tv.x * 0.5 + 0.5) * W).toFixed(1)}px,${((-tv.y * 0.5 + 0.5) * H).toFixed(1)}px,0)`;
    curEl.className = "on";
  }
  const U = { uTime: { value: 0 }, uMorph: { value: 0 } };
  const { G, GD, curveOf } = buildGeometry(A, B);
  let PS = 1;
  const allMats = new Set<THREE.ShaderMaterial>();
  const cx: LoopCtx = { sc, G, GD, U, allMats, labelsEl, A, B, PS: () => PS };

  // ---- node labels (bound to the focused loop) ----
  const LB: Label[] = LABEL_DEFS.map(([key, r, mL, mP]) => {
    const el = document.createElement("div"); el.className = "nl";
    const a = document.createElement("b"), b = document.createElement("span"); el.append(a, b); labelsEl.appendChild(el);
    return { key, r, mL, mP, el, a, b, pa: nodeOf(A, key), pb: nodeOf(B, key), w: 0, h: 0 };
  });
  const agl = agentLabelPool(labelsEl), ascr: Scr[] = [];

  // ---- loops & layout ----
  const loops = new Map<string, Loop>();
  const rates = new RateWindow();
  let tierNow: Tier = "still";
  let sig = "";
  const morph = { v: 0, from: 0, to: 0, at: 0 };
  const threads = makeThreads(sc), coreEls = new Map<string, HTMLElement>(), coreHide = new Set<string>(), stageSeen = new Map<string, number>();
  const docsSeen = new Map<string, { spec: number; plan: number; at: number }>();
  const flashSeenMap = new Map<string, number>();
  const coreGeo = new THREE.BufferGeometry();
  const coreMat = new THREE.PointsMaterial({ color: HEX.paper, size: 1.1, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const corePts = new THREE.Points(coreGeo, coreMat); corePts.frustumCulled = false; corePts.matrixAutoUpdate = false; sc.add(corePts);
  let galaxy: Galaxy = { cores: [], loops: [] }, loopKey = new Map<string, string>(), coreSig = "", inset = 0; // inset: share of the zone height under the header
  const attn = new Map<string, boolean>(), cJev = new THREE.Color(HEX.jev), cOpus = new THREE.Color(HEX.opus);
  const gBox = new THREE.Box3(), ovOut = { target: new THREE.Vector3(), distance: 0 };
  let gBoxFor: Galaxy | null = null, gBoxM = NaN, gBoxK = "";
  function layoutLoops() {
    const pg = fleetGalaxy(cpage.fleet, W / H), ids = pg.ids; galaxy = pg.g;
    loopKey = new Map(galaxy.loops.map((l) => [l.id, l.key]));
    const shown = ui.portrait ? projectSubset(galaxy, pager.focus) : galaxy;
    inset = clamp((head.getBoundingClientRect().bottom - loopEl.getBoundingClientRect().top) / H, 0, 0.35) || 0;
    for (const [id, L] of loops) if (!ids.includes(id)) { disposeLoop(cx, L); loops.delete(id); }
    ids.forEach(id => { if (!loops.has(id)) loops.set(id, makeLoop(cx, id)); });
    for (const l of galaxy.loops) {
      const L = loops.get(l.id)!;
      L.offA.set(l.x * SP.A[0], 0, l.z * SP.A[1]);
      L.offB.set(l.x * SP.B[0], -l.z * SP.B[1], 0);
      if (!L.off) L.off = new THREE.Vector3().lerpVectors(L.offA, L.offB, morph.v);
    }
    if (!galaxy.loops.length) { const L = loops.get("__empty")!; if (!L.off) L.off = new THREE.Vector3(); }
    const core = new Map(galaxy.cores.map((c) => [c.key, c]));
    threads.set(shown.loops.map((l) => { const c = core.get(l.key)!, e = threadEnd(c, l); return { id: l.id, x1: c.x, z1: c.z, x2: e.x, z2: e.z }; }));
    coreLabels(labelsEl, shown.cores, coreEls);
    coreHide.clear();
    if (ui.portrait) {
      const ln = shown.loops.map((l) => ({ key: l.key, name: store.sessions.get(l.id)?.name ?? "" }));
      for (const c of shown.cores) if (coreHidden(c, ln)) coreHide.add(c.key);
    }
    const csig = shown.cores.map((c) => `${c.x},${c.z}`).join("|");
    if (csig !== coreSig) { coreSig = csig; coreGeo.setAttribute("position", new THREE.BufferAttribute(corePointPositions(shown.cores), 3)); }
    attn.clear();
    for (const id of loops.keys()) { const sx = store.sessions.get(id); attn.set(id, id !== pager.focus && !!sx && NEEDS_YOU.has(eff(sx))); }
  }
  function sync() {
    layoutLoops();
    const off = store.link !== "live";
    const mode = off ? "offline" : store.sessions.size ? "normal" : "empty";
    const t = Date.now(), tiers: Tier[] = [], nowP = performance.now();
    for (const s of store.sessions.values()) rates.note(s.id, s.lastEventAt, t);
    rates.keep(store.sessions.keys());
    for (const [id, L] of loops) {
      const s = store.sessions.get(id);
      L.detail = id === pager.focus ? "full" : "lite";
      if (s) { const was = stageSeen.get(id); if (was !== undefined && was !== s.stage) { threads.pulse(id, nowP); wake(nowP, 1500); } stageSeen.set(id, s.stage); }
      if (s?.docs) {
        const d = s.docs, was = docsSeen.get(id), at = d.at ?? 0;
        if (was !== undefined && at > was.at) {
          if (!ui.reduce) { if (d.spec > was.spec) L.pulseAt.you = nowP; if (d.plan > was.plan) L.pulseAt.plan = nowP; }
          wake(nowP, 1200);
        }
        docsSeen.set(id, { spec: d.spec, plan: d.plan, at });
      }
      if (s && flashSeen(flashSeenMap, id, s.gateFlash?.at, Date.now())) { L.flash = { key: s.gateFlash!.gate, kind: s.gateFlash!.kind, t0: nowP }; wake(nowP, FLASH_MS + 100); }
      const tier = s ? tierOf({ ...s, status: eff(s) }, t) : "still", stall = s ? stallMin(s, t) : 0;
      if (s) tiers.push(tier);
      stateOf(L, s, mode, { spd: !s ? 1 : stall ? 0 : s.running && !rates.rate(id, t) ? speedOf(0) : speedOf(rates.rate(id, t)), stall, packets: LIFE[tier].packets });
      if (s && L.av?.counts.waiting) tiers.push("breathing"); // a waiting agent breathes: keep the slow frame rate
    }
    tierNow = ui.life ?? (off ? "still" : sceneTier(tiers));
    for (const id of [...stageSeen.keys()]) if (!store.sessions.has(id)) stageSeen.delete(id);
    for (const id of [...flashSeenMap.keys()]) if (!store.sessions.has(id)) flashSeenMap.delete(id);
    const rows: SigRow[] = [...store.sessions.values()].filter((s) => loops.has(s.id)).map(s => [s.id, s.stage, eff(s), s.builders.join(""), s.deny, s.esc, s.seen, s.tasksDone, s.tasksTotal, stallMin(s, t), loops.get(s.id)?.av ? agentSig(loops.get(s.id)!.av) : undefined]);
    const next = sceneSig(rows, store.link, pager.focus);
    if (next !== sig) { sig = next; wake(performance.now()); }
  }

  // ---- size / camera ----
  let W = 1, H = 1;
  function resize() {
    const w = loopEl.clientWidth, h = loopEl.clientHeight;
    if (!w || !h) return;
    W = w; H = h;
    renderer.setSize(W, H, false); composer.setSize(W, H); bloom.setSize(W * DPR, H * DPR);
    PS = DPR * H / 700;
    allMats.forEach(m => m.uniforms.uSize.value = m.userData.base * PS);
    LB.forEach(l => l.w = 0); agl.resize();
    wake(performance.now());
  }
  function relayout(p: boolean) { morph.from = morph.v; morph.to = 0; morph.at = performance.now(); wake(morph.at); }
  const camPos = new THREE.Vector3(0, 60, 80), camTgt = new THREE.Vector3(), tv = new THREE.Vector3(), fp = new THREE.Vector3(), ft = new THREE.Vector3(), op = new THREE.Vector3(), ot = new THREE.Vector3();
  const upv = new THREE.Vector3(), UP_P = new THREE.Vector3(0, 0, 1), ov = new THREE.Vector3(), tmp = new THREE.Vector3();
  let camInit = false, camLag = 0;
  function poses(m: number) {
    const fov = A.cam.fov + (B.cam.fov - A.cam.fov) * m, ref = A.cam.ref + (B.cam.ref - A.cam.ref) * m;
    const fit = Math.max(1, ref / (W / H)) * (ui.portrait ? 1.16 : 1);
    // focused pose
    const L = (pager.focus && loops.get(pager.focus)) || loops.values().next().value;
    const off = L && L.off ? L.off : ZERO;
    fp.lerpVectors(A.cam.pos, B.cam.pos, m); ft.lerpVectors(A.cam.tgt, B.cam.tgt, m);
    fp.sub(ft).multiplyScalar(fit).add(ft).add(off); ft.add(off);
    // overview pose: same viewing direction, pulled back to frame every core and loop of the page
    const dir = tv.set(0, 0.86, 0.52).lerp(ot.set(0.5, -0.2, 0.84), m).normalize();
    const mk = Math.round(m * 1000);
    const pk = ui.portrait ? loopKey.get(pager.focus ?? "") ?? "" : "*";
    if (gBoxFor !== galaxy || gBoxM !== mk || gBoxK !== pk) { poseBox(galaxy, pager.focus, ui.portrait, m, gBox); gBoxFor = galaxy; gBoxM = mk; gBoxK = pk; }
    const ovf = overviewFrame(gBox, dir, upv.set(0, 1, 0).lerp(UP_P, m).normalize(), fov, W / H, undefined, ovOut, inset, fp.distanceTo(ft) * 1.05);
    ot.copy(ovf.target);
    op.copy(dir).multiplyScalar(ovf.distance).add(ot);
    return fov;
  }
  const scr = LABEL_DEFS.map(([key]) => ({ key, x: 0, y: 0, rpx: 0 }));
  /** Screen position + rendered radius of each node of a loop (reused array). */
  function projectNodes(L: Loop) {
    const tan = Math.tan(camera.fov * Math.PI / 360);
    for (let i = 0; i < LABEL_DEFS.length; i++) {
      const [key, r] = LABEL_DEFS[i];
      tv.lerpVectors(nodeOf(A, key), nodeOf(B, key), morph.v).add(L.off!);
      const d = tv.distanceTo(camera.position); tv.project(camera);
      scr[i].x = (tv.x * 0.5 + 0.5) * W; scr[i].y = (-tv.y * 0.5 + 0.5) * H; scr[i].rpx = r / (d * tan) * H / 2;
    }
    return scr;
  }
  function nodeScreen(key: NodeKey): Anchor | null {
    const L = pager.focus ? loops.get(pager.focus) : undefined;
    if (!L || !L.off || L.id === "__empty") return null;
    const n = projectNodes(L).find((p) => p.key === key);
    return n ? { x: n.x, y: n.y, r: Math.max(n.rpx, HIT_MIN_PX) } : null;
  }
  function pick(x: number, y: number): Pick | null {
    const F = pager.focus ? loops.get(pager.focus) : undefined;
    if (F && F.off && F.id !== "__empty" && view.z > 0.6) {
      const aid = F.av ? hitNode(projectAgents(F, camera, W, H, ascr, 1.6), x, y, AGENT_HIT_PX) : null; if (aid) return { sessionId: F.id, nodeKey: null, agentId: aid };
      const k = hitNode(projectNodes(F).filter((n) => !(F.av && isBKey(n.key))), x, y);
      if (k) return { sessionId: F.id, nodeKey: k as NodeKey };
    }
    let best: string | null = null, bd = Infinity;
    const ak = awayKey(loopKey, pager.focus, ui.portrait);
    for (const [id, L] of loops) {
      if (id === "__empty" || !L.off || (ak !== undefined && loopKey.get(id) !== ak)) continue;
      tv.copy(A.center).lerp(B.center, morph.v).add(L.off).project(camera);
      const sx = (tv.x * 0.5 + 0.5) * W, sy = (-tv.y * 0.5 + 0.5) * H, d = Math.hypot(sx - x, sy - y);
      if (d < bd) { bd = d; best = id; }
    }
    return best === null ? null : { sessionId: best, nodeKey: null };
  }

  // ---- post ----
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(sc, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.66, 0.6, 0.5); composer.addPass(bloom);
  bloom.enabled = false;
  const gate: BloomGate = { over: 0, dead: false }, cap: CapGate = { over: 0, capped: false }; let lastRender = 0;
  const timer = new GpuTimer(renderer.getContext() as WebGL2RenderingContext);
  const anyNeeds = () => { for (const s of store.sessions.values()) if (NEEDS_YOU.has(eff(s))) return true; return false; };
  const glowEl = $("#glow")!, gProj = { fn: projector(camera, 1, 1), W: 1, H: 1 }, gpts: Pt[] = LABEL_DEFS.map(() => ({ x: 0, y: 0 }));
  /** Glow follows the focused loop's screen box (spec §6), fading out with zoom. */
  function syncGlow(zf: number) {
    const L = pager.focus ? loops.get(pager.focus) : undefined;
    if (!L || !L.off) { glowEl.style.opacity = "0"; return; }
    if (gProj.W !== W || gProj.H !== H) { gProj.fn = projector(camera, W, H); gProj.W = W; gProj.H = H; }
    const proj = gProj.fn;
    for (let i = 0; i < LABEL_DEFS.length; i++) {
      tv.lerpVectors(nodeOf(A, LABEL_DEFS[i][0]), nodeOf(B, LABEL_DEFS[i][0]), morph.v).add(L.off);
      const p = proj(tv.x, tv.y, tv.z); gpts[i].x = p.x; gpts[i].y = p.y;
    }
    const b = boxOf(gpts, 40);
    glowEl.style.transform = `translate3d(${b.x.toFixed(0)}px,${b.y.toFixed(0)}px,0)`;
    glowEl.style.width = `${b.w.toFixed(0)}px`; glowEl.style.height = `${b.h.toFixed(0)}px`;
    glowEl.style.opacity = (0.15 * zf).toFixed(3);
  }
  const grain = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uAmount: { value: 0.022 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uAmount; varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)) + uTime) * 43758.5453); }
      void main(){ vec4 c = texture2D(tDiffuse, vUv); float g = (hash(gl_FragCoord.xy) - 0.5) * uAmount;
        float vig = smoothstep(1.25, 0.35, length(vUv - 0.5) * 1.6); gl_FragColor = vec4((c.rgb + g) * mix(0.72, 1.0, vig), c.a); }`,
  });
  composer.addPass(grain); composer.addPass(new OutputPass());

  // ---- labels ----
  function headBoxes(): Box[] {
    const lr = loopEl.getBoundingClientRect(), boxes: Box[] = [];
    for (const el of Array.from(head.children) as HTMLElement[]) {
      if (!el.childNodes.length) continue;
      const r = el.getBoundingClientRect(); let w = r.width;
      if (el.id === "meta") w = Math.max(...Array.from(el.children).map(c => c.getBoundingClientRect().right)) - r.left;
      else { const rg = document.createRange(); rg.selectNodeContents(el); w = rg.getBoundingClientRect().width; }
      boxes.push({ x: r.left - lr.left, y: r.top - lr.top, w, h: r.height });
    }
    return boxes;
  }
  function placeLabels(m: number, settling: boolean, zf: number) {
    if (W < 2 || H < 2) return;
    const off = store.link !== "live";
    const boxes = headBoxes();
    if (word.uOpacity.value > 0.01) boxes.push(wordBox());
    const tan = Math.tan(camera.fov * Math.PI / 360), proj = projector(camera, W, H);
    const L = pager.focus ? loops.get(pager.focus) : undefined;
    const nodeOp = settling || !L ? 0 : smooth(0.78, 0.97, zf) * (1 - smooth(1.5, 6, camLag));
    const items: LItem[] = [], vis: Label[] = [];
    for (const lb of LB) {
      if (!L || !L.off || nodeOp < 0.01 || L.ns[lb.key] === "hide") { if (lb.el.style.opacity !== "0") lb.el.style.opacity = "0"; continue; }
      const [t1, t2] = L.label[lb.key] || ["", ""], x = L.ns[lb.key], hex = x === "failed" ? HEX.deny : L.nc[lb.key];
      if (lb.a.textContent !== t1) { lb.a.textContent = t1; lb.w = 0; }
      if (lb.b.textContent !== t2) { lb.b.textContent = t2; lb.w = 0; }
      const att = isAtt(x);
      lb.a.style.color = labelHex(lb.key, x, hex, L.here); lb.b.style.color = att ? hex : "";
      const mode = m > 0.5 ? lb.mP : lb.mL;
      lb.el.className = "nl " + (mode === "left" ? "left" : mode === "right" ? "right" : "c");
      if (!lb.w) { lb.w = lb.el.offsetWidth; lb.h = lb.el.offsetHeight; }
      tv.lerpVectors(lb.pa, lb.pb, m).add(L.off);
      const d = tv.distanceTo(camera.position); tv.project(camera);
      items.push({ key: lb.key, r: lb.r, mode, x: (tv.x * 0.5 + 0.5) * W, y: (-tv.y * 0.5 + 0.5) * H, rpx: lb.r / (d * tan) * H / 2, w: lb.w, h: lb.h });
      vis.push(lb);
    }
    agl.collect(nodeOp >= 0.01 && L?.detail === "full" ? L : undefined, camera, W, H, items);
    let put: Record<string, Box & { md: string }> = {};
    if (L && L.off && items.length) {
      const { rings, trail, orbit } = obstacles(proj, A, B, m, L.off); put = layoutLabels(items, W, H, boxes, rings, trail, orbit);
      for (const lb of vis) {
        const p = put[lb.key];
        lb.el.className = "nl " + (p.md === "left" ? "left" : p.md === "right" ? "right" : "c");
        lb.el.style.transform = `translate3d(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px,0)`;
        lb.el.style.opacity = ((off ? 0.5 : 1) * nodeOp).toFixed(2);
      }
    }
    agl.place(put, (off ? 0.5 : 1) * nodeOp);
    // overview labels
    const llOp = settling ? 0 : 1 - smooth(0.35, 0.7, zf);
    for (const c of galaxy.cores) {
      const el = coreEls.get(c.key); if (!el) continue;
      if (llOp < 0.01 || coreHide.has(c.key)) { if (el.style.opacity !== "0") el.style.opacity = "0"; continue; }
      tv.set(c.x, 0, c.z).applyMatrix4(corePts.matrix).project(camera);
      const w = el.offsetWidth;
      el.style.transform = `translate3d(${((tv.x * 0.5 + 0.5) * W - w / 2).toFixed(1)}px,${((-tv.y * 0.5 + 0.5) * H + 6).toFixed(1)}px,0)`;
      el.style.opacity = (0.9 * llOp).toFixed(2);
    }
    const ak = awayKey(loopKey, pager.focus, ui.portrait);
    for (const [id, Lp] of loops) {
      if (llOp < 0.01 || id === "__empty" || !Lp.off || (ak !== undefined && loopKey.get(id) !== ak)) { if (Lp.ll.style.opacity !== "0") Lp.ll.style.opacity = "0"; continue; }
      tv.copy(A.anchor).lerp(B.anchor, m).add(Lp.off).project(camera);
      const w = Lp.ll.offsetWidth, h = Lp.ll.offsetHeight;
      const bx = (tv.x * 0.5 + 0.5) * W - w / 2; let by = (-tv.y * 0.5 + 0.5) * H - h;
      for (let k = 0; k < 30 && boxes.some(b => bx < b.x + b.w + 10 && bx + w + 10 > b.x && by < b.y + b.h + 6 && by + h + 6 > b.y); k++) by += 8;
    boxes.push({ x: bx, y: by, w, h });
      Lp.ll.style.transform = `translate3d(${bx.toFixed(1)}px,${by.toFixed(1)}px,0)`;
      Lp.ll.style.opacity = (llOp * (Lp.cur.g < 0.8 ? 0.75 : 1)).toFixed(2);
    }
  }

  // ---- frame ----
  let simT = 0, timeScale = 1;
  const pv = new THREE.Vector3(), cDeny = new THREE.Color(HEX.deny), cBrand = new THREE.Color(HEX.brand), cFable = new THREE.Color(HEX.fable), list: Packet[] = [];
  function frame(): boolean {
    const reduce = ui.reduce, off = store.link !== "live";
    const nowp = performance.now(), since = nowp - lastRender;
    if (!loops.size) sync();
    const mp = clamp((nowp - morph.at) / 900, 0, 1);
    const pulsing = threads.tick(nowp, ui.reduce);
    const shipWave = pulsing || (celebrate.id !== null && Date.now() - celebrate.at < 1.75 * 1600);
    const mo: Motion = { now: nowp, settling: !reduce && mp < 1, camLag, zoomGap: Math.abs(view.zt - view.z), orbiting: orbitTick(now(), reduce),
      shipWave, tier: tierNow, reduce, capped: cap.capped };
    if (!wantsFrame(mo) || !due(mo, since)) return false;
    const dt = frameDt(since); lastRender = nowp;
    timeScale += ((off ? 0 : 1) - timeScale) * (1 - Math.exp(-dt * 4));
    const life = LIFE[mo.tier];
    simT += dt * timeScale * (reduce ? 0.3 : Math.max(life.drift, 0.15));
    const t = ui.freezeT ?? simT;
    morph.v = reduce ? morph.to : morph.from + (morph.to - morph.from) * easeOut(mp);
    const m = morph.v, settling = !reduce && mp < 1;
    threads.frame(m); galaxyFrame(m, corePts.matrix); corePts.matrixWorldNeedsUpdate = true;
    U.uMorph.value = m; U.uTime.value = t;
    // zoom + camera
    view.z += (view.zt - view.z) * (1 - Math.exp(-dt * (reduce ? 30 : 3.2)));
    const zf = easeIO(clamp(view.z, 0, 1));
    { const ov = 1 - smooth(0.35, 0.7, zf); threads.fade(ov); coreMat.opacity = ov; corePts.visible = ov > 0.01; } // overview-only, like the project labels
    if (m !== fAtM) { fAt = floorAt(A, B, m); fAtM = m; }
    const FL = pager.focus ? loops.get(pager.focus) : undefined;
    const fu = fieldUniforms(store.sessions.get(pager.focus ?? ""), Date.now(), reduce, fAt);
    // ?freeze: a live ship wave is pinned mid-expansion (Date.now drives it) so screenshots repeat
    FU.uMorph.value = m; FU.uTime.value = ui.freezeT ?? fu.time; FU.uPulseT.value = ui.freezeT !== null && fu.pulseT >= 0 ? 0.35 : fu.pulseT; FU.uActivity.value = fu.activity;
    FU.uPulseOrigin.value.set(fu.pulseOrigin[0], fu.pulseOrigin[1]);
    for (let i = 0; i < 3; i++) { const a = fu.attn[i]; FU.uAttn.value[i].set(a[0], a[1], a[2], a[3]); }
    FU.uOrigin.value.copy(FL && FL.off ? FL.off : ZERO);
    floor.rotation.x = m * Math.PI / 2; floor.position.z = -0.8 * m;
    word.mesh.position.lerpVectors(WORD.land.pos, WORD.port.pos, m).add(FU.uOrigin.value);
    word.mesh.rotation.x = WORD.land.rotX + (WORD.port.rotX - WORD.land.rotX) * m;
    word.mesh.scale.setScalar(1 + (WORD.port.scale - 1) * m);
    word.uOpacity.value = WORD.opacity * smooth(0.5, 1, zf) * (off ? 0.5 : 1);
    const fov = poses(m);
    const gp = tv.lerpVectors(op, fp, zf), gt = pv.lerpVectors(ot, ft, zf);
    if (!camInit) { camPos.copy(gp); camTgt.copy(gt); camInit = true; }
    const ck = reduce ? 1 : 1 - Math.exp(-dt * 2.2);
    camPos.lerp(gp, ck); camTgt.lerp(gt, ck); camLag = camPos.distanceTo(gp);
    camera.position.copy(camPos);
    if (!reduce && !off) { camera.position.x += Math.sin(t * 0.21) * 0.35 * life.sway; camera.position.y += Math.sin(t * 0.17) * 0.2 * life.sway; }
    if (orbit.yaw || orbit.pitch) { // free camera: rotate the offset from the target around the floor normal
      upv.set(0, 1, 0).lerp(UP_P, m).normalize();
      ov.copy(camera.position).sub(camTgt);
      const applied = applyOrbit(ov, upv, orbit.yaw, orbit.pitch);
      if (orbit.dragging) orbit.pitch = applied;
      camera.position.copy(camTgt).add(ov);
    }
    camera.fov = fov; camera.aspect = W / H; camera.updateProjectionMatrix();
    camera.lookAt(camTgt); camera.updateMatrixWorld();
    fog.density = 0.004 + 0.007 * zf;
    loopEl.classList.toggle("out", view.zt < 0.5);
    const k = 1 - Math.exp(-(dt) * (reduce ? 14 : 5));
    const fk = awayKey(loopKey, pager.focus, ui.portrait);
    for (const [id, L] of loops) {
      const cur = L.cur, tgt = L.tgt;
      if (!L.off) continue;
      L.off.lerp(tv.lerpVectors(L.offA, L.offB, m), 1 - Math.exp(-dt * 4));
      L.group.position.copy(L.off);
      const away = fk !== undefined && loopKey.get(id) !== fk;
      const fg = away ? 0 : tgt.g * (id === pager.focus || store.sessions.size < 2 ? 1 : 1 - 0.65 * zf);
      cur.g += (fg - cur.g) * k;
      if (away && cur.g < 0.005) { L.group.visible = false; continue; }
      L.group.visible = true;
      for (const key of tKeys) {
        const c = cur.t[key], g = tgt.t[key], u = L.t[key].uniforms;
        c.a += (g.a - c.a) * k; c.l += (g.l - c.l) * k; c.f += (g.f - c.f) * k; c.r = key === "trunk" ? arcStep(c.r, g.r, dt, reduce) : c.r + (g.r - c.r) * k; c.c.lerp(g.c, k);
        u.uAlpha.value = c.a * cur.g; u.uLit.value = c.l; u.uPhase.value = ui.freezeT !== null ? ui.freezeT * c.f : (u.uPhase.value + dt * timeScale * c.f * (reduce ? 0 : L.spd * life.pulse)) % 6283.185307; u.uReveal.value = key === "trunk" ? c.r * 1.0 + (c.r > 0.995 ? 0.1 : 0) : c.r; u.uColor.value.copy(c.c);
      }
      const cel = celebrate.id === id ? (Date.now() - celebrate.at) / 1600 : 2;
      for (const key of oKeys) {
        const c = cur.o[key], g = tgt.o[key], u = L.o[key].uniforms;
        c.a += (g.a - c.a) * k; c.l += (g.l - c.l) * k; c.amp += (g.amp - c.amp) * k; c.c.lerp(g.c, k);
        c.s += (g.s - c.s) * (1 - Math.exp(-dt / 0.6 * 3)); u.uSize.value = L.o[key].userData.base * PS * c.s;
        const pa = L.pulseAt[key]; if (pa !== undefined) { const age = (performance.now() - pa) / 1200; if (age >= 1) delete L.pulseAt[key]; }
        let lit = c.l + (reduce ? c.amp * 0.6 : c.amp * (0.5 + 0.5 * Math.sin(Math.PI * 2 * t / g.per)));
        if (L.pulseAt[key] !== undefined) lit += 0.9 * Math.sin(Math.PI * clamp((performance.now() - L.pulseAt[key]) / 1200, 0, 1));
        if (key === "main" && cel < 1.75) lit += 0.9 * Math.sin(Math.PI * clamp(cel / 1.75, 0, 1));
        u.uAlpha.value = c.a * cur.g; u.uLit.value = lit; u.uColor.value.copy(c.c);
      }
      for (const key in L.gates) {
        const Gt = L.gates[key], s = tgt.gateS[key] || "calm", isD = s === "deny";
        const want = s === "calm" || s === "hide" ? 0 : s === "pass" ? 0.3 : reduce ? 0.85 : 0.5 + 0.5 * Math.sin(Math.PI * 2 * t / (isD ? 1.1 : 1.8));
        Gt.lit += (want - Gt.lit) * (1 - Math.exp(-dt * 10)); Gt.deny += ((isD ? 1 : 0) - Gt.deny) * k; Gt.vis += ((s === "hide" ? 0 : 1) - Gt.vis) * k;
        const fa = L.flash && L.flash.key === key ? performance.now() - L.flash.t0 : -1, fl = flashLit(fa, reduce);
        const red = Math.max(Gt.deny, fl > 0 && L.flash?.kind === "deny" ? 1 : 0), lit = Math.min(1, Gt.lit + fl);
        if (L.flash && L.flash.key === key && fa >= FLASH_MS) L.flash = null;
        Gt.m1.color.set(HEX.jev).lerp(cDeny, red); Gt.m2.color.copy(Gt.m1.color);
        Gt.m1.opacity = (0.28 + lit * 0.72) * cur.g * Gt.vis; Gt.m2.opacity = (0.08 + lit * 0.5) * cur.g * Gt.vis;
        Gt.b.scale.setScalar(1 + lit * 0.6); Gt.a.rotation.z = t * 0.5;
        Gt.g.position.lerpVectors(Gt.pa, Gt.pb, m); Gt.g.quaternion.slerpQuaternions(Gt.qa, Gt.qb, m);
      }
      L.rings.forEach((r, i) => {
        r.lit += ((tgt.ring ? tgt.ring[i] : 0) - r.lit) * k;
        r.g.position.lerpVectors(r.a, r.b, m);
        const spin = t * (i ? -0.22 : 0.22);
        r.g.rotation.set(0, spin * (1 - m), spin * m);
        r.meshes.forEach(me => me.rotation.x = (1 - m) * Math.PI / 2 + me.userData.tilt);
        const hot = attn.get(id) === true;
        r.ms.forEach(mm => { mm.opacity = (0.14 + r.lit * 0.4) * cur.g; mm.color.copy(hot ? cJev : cOpus); });
      });
      { const wall = Date.now(), aw = frameAgents(L, m, dt, k, wall, reduce); if (aw) wake(nowp, aw); if (frameLanes(L.lanes, L.A, L.B, m, dt, L.cur.g, reduce, wall)) wake(nowp, 200); }
      // packets: live edges (working tier), the progress head, the ship comet, and the one-shot escalation packet
      L.clk = ui.freezeT ?? L.clk + dt * timeScale * L.spd;
      list.length = 0;
      if (!reduce) for (const p of tgt.packets) list.push(p);
      const pr = cur.t.trunk.r;
      { const hd = arcHead(pr, L.head, L.waitAt, Date.now(), reduce, !!tgt.offline); if (hd) list.push(hd); }
      if (!reduce && cel < 1) list.push({ k: "trunk", fixed: easeOut(clamp(cel, 0, 1)), col: cBrand, size: 15, tr: TR, gap: 0.006, max: 1 });
      const ep = L.escAt === null ? 1 : (Date.now() - L.escAt) / ESC_MS;
      if (!reduce && ep >= 0 && ep < 1) list.push({ k: "esc", fixed: easeOut(ep), col: cFable, size: 7, tr: 7, gap: 0.012, max: 1 });
      writePackets(L, list, m, PS, curveOf, cur.g);
    }
    grain.uniforms.uTime.value = t;
    const got = timer.poll();
    for (const ms of got) perf.gpu.push(ms);
    const smp = { gpuMs: timer.ok ? got.at(-1) : null, gapMs: since < 100 ? since : 0, capMs: minGapMs(mo) };
    bloom.enabled = bloomOn(gate, anyNeeds(), smp);
    capOn(cap, gate.dead, smp);
    const began = timer.begin();
    timer.around(began, () => composer.render());
    demand.rendered++;
    syncGlow(zf);
    placeLabels(m, settling, zf);
    syncPing(fu.ping, zf);
    syncCur(zf);
    placeInspect();
    perf.bloomDead = gate.dead; perf.capMs = minGapMs(mo);
    perf.cpu.push(performance.now() - nowp);
    return true;
  }
  resize();
  wake(performance.now());
  new ResizeObserver(() => { resize(); changed(); }).observe(loopEl);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { resize(); changed(); } });
  return { frame, sync, resize, relayout, pick, nodeScreen, agentScreen: (id: string) => agentAnchor(pager.focus ? loops.get(pager.focus) : undefined, id, camera, W, H) };
}
