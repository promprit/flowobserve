import * as THREE from "three";
import { ATTN, HEX, I3, NEEDS, STAGES } from "../config";
import { eff } from "../select";
import { ARC_ALPHA, stageArc } from "./arc";
import { ui, type CSession } from "../state";
import type { NodeKey } from "@fo/shared";
import type { buildGeometry, Geometry, Gate } from "./geometry";
import { activeNode, oldestRun, runningMin, type Shape } from "./rate";
import type { Topology } from "./topology";
import { FRAG, LANE_VERT, VERT } from "./shaders";
import { laneView, type LaneView } from "../lanes";
import { bindLanes, laneCurve, laneOf, makeLanes, type LaneObj } from "./lanes";
import { MHEX, agentView, summaryParts, type AgentView } from "../agents";
import { paintParts } from "../ui/agents";
import { clamp, easeOut } from "../util";
import { agentLabels, bindSlots, EMERGE_MS, layoutAgents, type AgentLabel, type AgentTarget, type SlotState } from "./agents";

export interface Mk { s: number; a: number; l: number; f: number; r: number; amp: number; per: number; c: THREE.Color }
export interface Packet { k?: string; route?: number; sp?: number; ph?: number; col: THREE.Color; size: number; tr: number; gap: number; max: number; rev?: boolean; fixed?: number; lane?: LaneObj; half?: "out" | "ret" }
export interface Tgt {
  t: Record<string, Mk>; o: Record<string, Mk>; g: number; ring: number[]; gateS: Record<string, string>;
  packets: Packet[]; prog: number; offline?: boolean; ag: AgentTarget[];
}
export interface Cur { t: Record<string, Mk>; o: Record<string, Mk>; g: number; prog: number }
export interface GateObj extends Gate {
  g: THREE.Group; a: THREE.Mesh; b: THREE.Mesh; m1: THREE.MeshBasicMaterial; m2: THREE.MeshBasicMaterial; lit: number; deny: number; vis: number;
}
export interface Ring { g: THREE.Group; ms: THREE.MeshBasicMaterial[]; meshes: THREE.Mesh[]; a: THREE.Vector3; b: THREE.Vector3; lit: number }
/** One agent orb + its tether (spec: per-loop slots, created on demand up to AMAX, disposed with the loop). */
export interface Slot extends SlotState<AgentTarget> { pts: THREE.Points; mat: THREE.ShaderMaterial; lg: THREE.BufferGeometry; lm: THREE.LineBasicMaterial; line: THREE.Line; a: number; c: THREE.Color; pos: THREE.Vector3 }
export interface Loop {
  id: string; group: THREE.Group; detail: "full" | "lite";
  t: Record<string, THREE.ShaderMaterial>; o: Record<string, THREE.ShaderMaterial>;
  rings: Ring[]; gates: Record<string, GateObj>;
  pGeo: THREE.BufferGeometry; pPos: Float32Array; pCol: Float32Array; pSize: Float32Array;
  cur: Cur; tgt: Tgt; mats: Set<THREE.Material>;
  ll: HTMLElement; llb: HTMLElement; lls: HTMLElement; lla: HTMLElement;
  offA: THREE.Vector3; offB: THREE.Vector3; off: THREE.Vector3 | null;
  pulseAt: Record<string, number>;
  flash: { key: string; kind: "ask" | "deny"; t0: number } | null;
  clk: number; spd: number; stall: number; act: NodeKey | null; escAt: number | null; escWas: boolean; here: string | null; head: string; waitAt: number | null;
  ns: Record<string, string>; nc: Record<string, string>; word: Record<string, string>; label: Record<string, string[]>;
  lanes: LaneObj[]; lv: LaneView | null;
  slots: Slot[]; mkSlot: () => Slot; lastBorn: number; av: AgentView | null; agL: AgentLabel[]; A: Topology; B: Topology;
}
export interface LoopCtx {
  sc: THREE.Scene; G: Geometry["G"]; GD: Geometry["GD"]; U: { uTime: { value: number }; uMorph: { value: number } };
  allMats: Set<THREE.ShaderMaterial>; labelsEl: HTMLElement; A: Topology; B: Topology; PS: () => number;
}

/** Spec §3.7: a node grows with the docs written for it (log, capped). */
export function nodeGrowth(n: number): number { return Math.min(1.6, 1 + 0.15 * Math.log2(1 + n)); }

export const MAXP = 18, TR = 14, PN = MAXP * (TR + 1);
export const tKeys = ["in", "out0", "out1", "out2", "ret0", "ret1", "ret2", "ship", "esc", "trunk", "teth"];
export const oKeys = ["you", "plan", "b0", "b1", "b2", "review", "main", "fable"];
const TS: Record<string, { a: number; l: number; f: number; r: number }> = { future: { a: 0.26, l: 0, f: 3, r: 0 }, done: { a: 0.5, l: 0, f: 0.8, r: 1.1 }, live: { a: 1, l: 0.28, f: 4.5, r: 1.1 }, ghost: { a: 0.55, l: 0, f: 1.6, r: 1.1 } };
const OS: Record<string, { a: number; l: number; amp?: number; per?: number }> = { calm: { a: 0.3, l: 0 }, done: { a: 0.62, l: 0.04 }, live: { a: 1, l: 0.3, amp: 0.25, per: 3.2 }, attn: { a: 1, l: 0.2, amp: 0.65, per: 4 }, seen: { a: 1, l: 0.45, amp: 0.1, per: 4 }, failed: { a: 0.95, l: 0.3 }, ghost: { a: 0.5, l: 0 }, held: { a: 1, l: 0.45 }, stall: { a: 0.6, l: 0 }, hide: { a: 0, l: 0 } };
const mk = (): Mk => ({ s: 1, a: 0, l: 0, f: 1, r: 0, amp: 0, per: 1, c: new THREE.Color(HEX.paper) });

const opusGeo = [new THREE.TorusGeometry(1.7, 0.012, 6, 160), new THREE.TorusGeometry(2.05, 0.012, 6, 160)];
const r1 = new THREE.TorusGeometry(0.52, 0.022, 8, 96), r2 = new THREE.TorusGeometry(0.88, 0.008, 6, 96);
const pMatShared = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: `attribute vec3 aColor; attribute float aSize; varying vec3 vC;
      void main(){ vC = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * (64.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `varying vec3 vC; void main(){ float r = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vC * 1.7, smoothstep(0.5, 0.0, r)); }`,
});

export function makeLoop(cx: LoopCtx, id: string): Loop {
  const { sc, G, GD, U, allMats, labelsEl, A, B } = cx;
  const group = new THREE.Group(); sc.add(group);
  const mats = new Set<THREE.Material>();
  const cloud = (g: THREE.BufferGeometry, hex: string, size: number) => {
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: U.uTime, uMorph: U.uMorph, uPaper: { value: new THREE.Color(HEX.paper) }, uColor: { value: new THREE.Color(hex) }, uSize: { value: size * cx.PS() }, uPhase: { value: 0 }, uAlpha: { value: 0 }, uLit: { value: 0 }, uReveal: { value: 1.1 } },
      vertexShader: VERT, fragmentShader: FRAG,
    });
    m.userData.base = size; mats.add(m); allMats.add(m);
    const p = new THREE.Points(g, m); p.frustumCulled = false; group.add(p); m.userData.pts = p; return m;
  };
  const laneCloud = (g: THREE.BufferGeometry, hex: string, size: number) => {
    const m = cloud(g, hex, size);
    m.vertexShader = LANE_VERT;
    for (const u of ["uA0", "uA1", "uA2", "uB0", "uB1", "uB2"]) m.uniforms[u] = { value: new THREE.Vector3() };
    return m;
  };
  const t = {
    in: cloud(G.in, HEX.paper, 1.3), out0: cloud(G.out[0], HEX.sonnet, 1.3), out1: cloud(G.out[1], HEX.sonnet, 1.3), out2: cloud(G.out[2], HEX.sonnet, 1.3),
    ret0: cloud(G.ret[0], HEX.sonnet, 1.3), ret1: cloud(G.ret[1], HEX.sonnet, 1.3), ret2: cloud(G.ret[2], HEX.sonnet, 1.3),
    ship: cloud(G.ship, HEX.opus, 1.3), esc: cloud(G.esc, HEX.fable, 1.3), trunk: cloud(G.trunk, HEX.brand, 1.2), teth: cloud(G.teth, HEX.fable, 1.0),
  };
  const o = {
    you: cloud(G.you, HEX.paper, 1.7), plan: cloud(G.plan, HEX.opus, 1.7), b0: cloud(G.exec[0], HEX.sonnet, 1.7), b1: cloud(G.exec[1], HEX.sonnet, 1.7), b2: cloud(G.exec[2], HEX.sonnet, 1.7),
    review: cloud(G.review, HEX.opus, 1.7), main: cloud(G.main, HEX.brand, 1.7), fable: cloud(G.fable, HEX.fable, 1.7),
  };
  const addM = <M extends THREE.Material>(m: M): M => { m.transparent = true; m.blending = THREE.AdditiveBlending; m.depthWrite = false; mats.add(m); return m; };
  const rings: Ring[] = (["plan", "review"] as const).map(k => {
    const g = new THREE.Group(), ms: THREE.MeshBasicMaterial[] = [], meshes: THREE.Mesh[] = [];
    ([[0, 0.4], [1, -0.7]] as const).forEach(([i, tilt]) => {
      const m = addM(new THREE.MeshBasicMaterial({ color: HEX.opus, opacity: 0 }));
      const mesh = new THREE.Mesh(opusGeo[i], m); mesh.userData.tilt = tilt; g.add(mesh); ms.push(m); meshes.push(mesh);
    });
    group.add(g); return { g, ms, meshes, a: A.N[k], b: B.N[k], lit: 0 };
  });
  const gates: Record<string, GateObj> = {};
  for (const k in GD) {
    const g = new THREE.Group();
    const m1 = addM(new THREE.MeshBasicMaterial({ color: HEX.jev, opacity: 0 })), m2 = addM(new THREE.MeshBasicMaterial({ color: HEX.jev, opacity: 0 }));
    const a = new THREE.Mesh(r1, m1), b = new THREE.Mesh(r2, m2); g.add(a, b); group.add(g);
    gates[k] = Object.assign({ g, a, b, m1, m2, lit: 0, deny: 0, vis: 1 }, GD[k]);
  }
  const pPos = new Float32Array(PN * 3), pCol = new Float32Array(PN * 3), pSize = new Float32Array(PN);
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute("aColor", new THREE.BufferAttribute(pCol, 3)); pGeo.setAttribute("aSize", new THREE.BufferAttribute(pSize, 1));
  const pPts = new THREE.Points(pGeo, pMatShared); pPts.frustumCulled = false; group.add(pPts);
  const cur: Cur = { t: {}, o: {}, g: 0, prog: 0 }, tgt: Tgt = { t: {}, o: {}, g: 1, ring: [0, 0], gateS: {}, packets: [], prog: 0, ag: [] };
  tKeys.forEach(k => { cur.t[k] = mk(); tgt.t[k] = mk(); });
  oKeys.forEach(k => { cur.o[k] = mk(); tgt.o[k] = mk(); });
  // overview label
  const ll = document.createElement("div"); ll.className = "ll";
  const llb = document.createElement("b"), lls = document.createElement("span"), lla = document.createElement("i"); lla.className = "la"; ll.append(llb, lls, lla); labelsEl.appendChild(ll);
  const mkSlot = (): Slot => {
    const mat = cloud(G.agent, HEX.sonnet, 1.25), pts = mat.userData.pts as THREE.Points; pts.visible = false;
    const lg = new THREE.BufferGeometry(); lg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(ATP * 3), 3));
    const lm = addM(new THREE.LineBasicMaterial({ color: HEX.sonnet, opacity: 0 })), line = new THREE.Line(lg, lm); line.frustumCulled = false; line.visible = false; group.add(line);
    return { key: null, T: null, live: false, born: 0, tc: 0, tick: 0, init: false, pts, mat, lg, lm, line, a: 0, c: new THREE.Color(HEX.sonnet), pos: new THREE.Vector3() };
  };
  return { id, group, detail: "full", t, o, rings, gates, pGeo, pPos, pCol, pSize, cur, tgt, mats, ll, llb, lls, lla, offA: new THREE.Vector3(), offB: new THREE.Vector3(), off: null, pulseAt: {}, flash: null, clk: 0, spd: 1, stall: 0, act: null, escAt: null, escWas: false, here: null, head: HEX.opus, waitAt: null, ns: {}, nc: {}, word: {}, label: {},
    lanes: makeLanes(laneCloud, cloud, G), lv: null, slots: [], mkSlot, lastBorn: 0, av: null, agL: [], A, B };
}

export function disposeLoop(cx: LoopCtx, L: Loop): void {
  cx.sc.remove(L.group);
  L.mats.forEach(m => { m.dispose(); cx.allMats.delete(m as THREE.ShaderMaterial); });
  L.pGeo.dispose(); L.ll.remove(); L.slots.forEach((q) => q.lg.dispose());
}

export function stateOf(L: Loop, s: CSession | undefined, mode: string, mo: { spd: number; stall: number; packets: boolean } = { spd: 1, stall: 0, packets: true }): void {
  const tgt = L.tgt;
  const st = s ? s.stage : -1, status = s ? eff(s) : "none", shipped = status === "shipped", bs = s ? s.builders || I3() : I3();
  const empty = mode === "empty", escOn = !!(s && s.esc && (status === "escalated" || status === "handoff"));
  const liveKeys: string[] = [];
  const T = (k: string, state: string, hex: string) => { const p = TS[state]; Object.assign(tgt.t[k], { a: p.a, l: p.l, f: p.f, r: p.r }); tgt.t[k].c.set(hex); if (state === "live") liveKeys.push(k); return state === "live"; };
  const P: Packet[] = [];
  const pk = (key: string, hex: string, o: Partial<Packet> = {}) => P.push(Object.assign({ k: key, sp: 0.42, ph: 0, col: new THREE.Color(hex), size: 6.5, tr: 7, gap: 0.012, max: 1, rev: false }, o));
  let inS = empty ? "ghost" : st === 0 ? "live" : st > 0 ? "done" : "future", inC: string = HEX.paper, inO: Partial<Packet> = {};
  if (status === "waiting") { inS = "live"; inC = HEX.jev; inO = { rev: true, sp: 0.3 }; }
  if (shipped) inS = "done";
  if (T("in", inS, inC)) pk("in", inC, inO);
  const gs: Record<string, string> = { route: st > 0 ? "pass" : st === 0 ? "check" : "calm" };
  for (let i = 0; i < 3; i++) {
    let os = empty ? "ghost" : st === 2 ? "live" : st > 2 ? "done" : "future", oc: string = HEX.sonnet, oo: Partial<Packet> = { ph: i * 0.21 };
    if ((st === 3 || st === 4) && bs[i] === "idle") os = "future";
    if (st === 3 && bs[i] === "working") os = "live";
    if (s && s.deny === i && status === "deny") { os = "live"; oc = HEX.deny; oo = { max: 0.5, sp: 0.5 }; }
    let rs = empty ? "ghost" : st === 5 ? "live" : st > 5 ? "done" : "future";
    if ((st === 3 || st === 4) && bs[i] === "done") rs = "done";
    if (shipped) { os = "done"; rs = "done"; }
    if (T("out" + i, os, oc)) pk("out" + i, oc, oo);
    if (T("ret" + i, rs, HEX.sonnet)) pk("ret" + i, HEX.sonnet, { ph: i * 0.17 });
    let dg = st === 2 ? "check" : st > 2 ? "pass" : "calm";
    if ((st === 3 || st === 4) && bs[i] === "idle") dg = "calm";
    if (s && s.deny === i && status === "deny") dg = "deny";
    let rg = st === 5 ? "check" : st > 5 ? "pass" : "calm";
    if ((st === 3 || st === 4) && bs[i] === "done") rg = "pass";
    if (shipped) { dg = "pass"; rg = "pass"; }
    gs["d" + i] = dg; gs["r" + i] = rg;
  }
  if (T("ship", empty ? "ghost" : shipped ? "done" : st === 6 ? "live" : "future", HEX.opus)) pk("ship", HEX.opus);
  gs.commit = shipped ? "pass" : st === 6 ? "check" : "calm";
  if (escOn) T("esc", "live", HEX.fable); else Object.assign(tgt.t.esc, { a: 0.12, l: 0, f: 1, r: 0 });
  // One packet to the frontier node when escalation starts (spec §5); a page opened mid-escalation sees it already landed.
  if (escOn && !L.escWas) L.escAt = s!.nodes.find((n) => n.key === "fable")?.startedAt ?? Date.now();
  if (!escOn) L.escAt = null;
  L.escWas = escOn;
  const arc = stageArc(st, status, s?.agents);
  tgt.prog = empty ? 1 : arc.to; L.here = empty ? null : arc.here; L.head = arc.head;
  L.waitAt = status === "waiting" ? L.waitAt ?? Date.now() : null;
  Object.assign(tgt.t.trunk, { a: ARC_ALPHA, l: shipped ? 0.3 : 0.12, f: 5, r: tgt.prog }); tgt.t.trunk.c.set(HEX.opus);
  Object.assign(tgt.t.teth, { a: escOn ? 0 : 0.35, l: 0, f: 0, r: 1.1 });
  if (empty) for (let i = 0; i < 3; i++) P.push({ route: i, sp: 0.07, ph: i / 3, col: new THREE.Color(HEX.paper), size: 5.5, tr: 7, gap: 0.012, max: 1 });
  // Agents mode (spec: `agents` present, even []): B1-B3, their out/return packets and the d/r gates give way to the agents.
  const av = s ? agentView(s, Date.now()) : null; L.av = av;
  L.lv = av ? laneView(s!, av) : null; bindLanes(L.lanes, L.lv, Date.now(), ui.reduce);
  if (av) for (let i = P.length - 1; i >= 0; i--) if (/^(out|ret)/.test(P[i].k ?? "")) P.splice(i, 1);
  if (L.lv && !L.lv.single) L.lv.open.forEach((ln, i) => {
    if (ln.state !== "working") return;
    const lane = laneOf(L.lanes, ln.key), hex = ln.rung ? MHEX[ln.rung] : HEX.sonnet;
    if (lane) { pk("", hex, { ph: i * 0.21, lane, half: "out" }); pk("", hex, { ph: i * 0.17, lane, half: "ret" }); }
  });
  tgt.packets = mo.stall || !mo.packets || L.detail === "lite" ? [] : P;
  if (ui.reduce) for (const k of liveKeys) tgt.t[k].l = 0.6; // reduced motion: live edges drawn static and bright
  if (av) for (let i = 0; i < 3; i++) { Object.assign(tgt.t["out" + i], { a: 0, l: 0, f: 1, r: 1.1 }); Object.assign(tgt.t["ret" + i], { a: 0, l: 0, f: 1, r: 1.1 }); gs["d" + i] = gs["r" + i] = "hide"; }
  tgt.gateS = gs;
  L.spd = mo.spd; L.stall = mo.stall;
  const shape: Shape | null = s ? { ...s, status: eff(s), builders: bs } : null;
  L.act = shape ? activeNode(shape) : null;
  const attnS = s && s.seen ? "seen" : "attn";
  const ns: Record<string, string> = {
    you: status === "waiting" ? attnS : st === 0 ? "live" : "calm",
    plan: status === "waiting" ? "done" : (st === 0 || st === 1) ? "live" : st > 1 ? "done" : "calm",
    review: st === 5 ? "live" : st > 5 ? "done" : "calm",
    main: shipped ? "attn" : st === 6 ? "live" : "calm",
    fable: escOn ? (status === "handoff" ? "failed" : "held") : "calm",
  };
  const bmap: Record<string, string> = { working: "live", done: "done", failed: "failed", blocked: "failed", idle: "calm" };
  bs.forEach((b, i) => ns["b" + i] = shipped ? "done" : bmap[b] || "calm");
  if (av) for (let i = 0; i < 3; i++) ns["b" + i] = "hide";
  if (empty) oKeys.forEach(k => ns[k] = "ghost");
  const nc: Record<string, string> = { you: status === "waiting" ? HEX.jev : HEX.paper, plan: HEX.opus, review: HEX.opus, main: HEX.brand, fable: HEX.fable, b0: HEX.sonnet, b1: HEX.sonnet, b2: HEX.sonnet };
  if (mo.stall && L.act && ns[L.act] !== "hide") { ns[L.act] = "stall"; nc[L.act] = HEX.t3; }
  oKeys.forEach(k => { const p = OS[ns[k]]; Object.assign(tgt.o[k], { s: k === "you" ? nodeGrowth(s?.docs?.spec ?? 0) : k === "plan" ? nodeGrowth(s?.docs?.plan ?? 0) : 1, a: p.a, l: p.l, amp: p.amp || 0, per: p.per || 1 }); tgt.o[k].c.set(ns[k] === "failed" ? HEX.deny : nc[k]); });
  tgt.g = mode === "offline" ? 0.3 : status === "idle" ? 0.55 : 1;
  tgt.ring = [ns.plan === "live" ? 1 : ns.plan === "done" ? 0.4 : 0, ns.review === "live" ? 1 : ns.review === "done" ? 0.4 : 0];
  tgt.offline = mode === "offline";
  // labels
  const word: Record<string, string> = { working: "WORKING", done: "DONE", failed: "OPUS ✗ → FABLE", blocked: "BLOCKED", idle: "IDLE" };
  L.label = {
    you: ["YOU", status === "waiting" ? "NEEDS YOU" : "BRAINSTORM"], plan: ["PLAN", "ORCHESTRATOR · OPUS"],
    review: ["REVIEW", "2-STAGE + VERIFY"], main: ["SHIP", shipped ? "MERGED TO MAIN" : "COMMIT · MERGE"],
    fable: ["FRONTIER", status === "handoff" ? "FABLE ✗ · TO YOU" : escOn ? "FABLE · RUNNING" : "FABLE · ONE SHOT"],
  };
  const dn = s?.docs;
  if (dn && dn.spec > 0 && L.label.you) L.label.you = [L.label.you[0], `SPEC \u00b7 ${dn.spec}`];
  if (dn && dn.plan > 0 && L.label.plan) L.label.plan = [L.label.plan[0], `PLAN \u00b7 ${dn.plan}`];
  bs.forEach((b, i) => L.label["b" + i] = [`B${i + 1}`, word[b] || "IDLE"]);
  if (av) {
    for (let i = 0; i < 3; i++) L.label["b" + i] = ["", ""];
    const tl = av.tally;
    const lv = L.lv;
    if (lv && !lv.single && st < 5) {
      if (lv.queued + lv.overflow > 0) L.label.plan = [L.label.plan[0], `${L.label.plan[1]} \u00b7 ${lv.queued ? `${lv.queued} QUEUED${lv.overflow ? ` +${lv.overflow}` : ""}` : `${lv.overflow} MORE`}`];
      if (lv.done > 0) L.label.review = [L.label.review[0], `${L.label.review[1]} \u00b7 ${lv.done} DONE`];
    }
    if (st >= 5 && tl.spawned) L.label.review = ["REVIEW", `${tl.spawned} SPAWNED · ${tl.passed} PASSED · ${tl.failed} FAILED`];
  }
  const run = s ? oldestRun(s) : null, rm = s && L.act && run ? runningMin(s, Date.now()) : 0;
  if (L.act && L.label[L.act]) {
    if (mo.stall) L.label[L.act] = [L.label[L.act][0], `STALLED ${mo.stall}M`];
    else if (rm) L.label[L.act] = [L.label[L.act][0], `${run!.tool.toUpperCase()} \u00b7 ${rm}M`];
  }
  if (L.detail === "lite") L.label = {};
  L.ns = ns; L.nc = nc;
  const sel = s && ui.agentSel?.sid === s.id ? ui.agentSel.aid : null;
  tgt.ag = av ? layoutAgents(av, L.A, L.B, L.lv) : [];
  for (const t of tgt.ag) t.lane = L.lv && !L.lv.single && L.lv.open.some((ln) => ln.key === t.key) ? laneOf(L.lanes, t.key) : undefined;
  L.agL = av && L.detail === "full" ? agentLabels(av, sel, Date.now(), L.lv) : [];
  // overview label
  const ac = s ? ATTN[status as keyof typeof ATTN] : null;
  L.llb.textContent = s ? s.name : "no sessions";
  L.llb.style.color = ac || (status === "idle" ? HEX.t2 : HEX.paper);
  L.lls.textContent = !s ? "" : mode === "offline" ? "STALE" : status === "shipped" ? "SHIPPED" : `${STAGES[st] ?? STAGES[0]}${s.tasksTotal && (st === 3 || st === 4) ? ` · ${s.tasksDone}/${s.tasksTotal}` : ""}${status === "idle" ? " · IDLE" : NEEDS.has(status as never) ? " · NEEDS YOU" : ""}`;
  L.lls.style.color = ac || "";
  paintParts(L.lla, av && av.counts.n && mode !== "offline" ? summaryParts(av, Date.now()) : []);
}

type CurveOf = ReturnType<typeof buildGeometry>["curveOf"];
const pv = new THREE.Vector3(), pv2 = new THREE.Vector3();
/** Writes up to MAXP packets (head + trail) into the loop's point buffers. `L.clk` is the loop's packet clock. */
export function writePackets(L: Loop, list: Packet[], m: number, ps: number, curveOf: CurveOf, g: number): void {
  for (let j = 0; j < MAXP; j++) {
    const P = list[j];
    let key = (P && P.k) || "", t0 = 0;
    if (P) {
      const u = P.fixed != null ? P.fixed : (L.clk * (P.sp || 0) + (P.ph || 0)) % 1;
      if (P.route != null) {
        if (u < 0.22) { key = "in"; t0 = u / 0.22; } else if (u < 0.47) { key = "out" + P.route; t0 = (u - 0.22) / 0.25; }
        else if (u < 0.72) { key = "ret" + P.route; t0 = (u - 0.47) / 0.25; } else { key = "ship"; t0 = (u - 0.72) / 0.28; }
      } else t0 = (P.rev ? 1 - u : u) * P.max;
    }
    const ln = P?.lane, half = P?.half ?? "out";
    const la = ln && ln.tgtA > 0 ? Math.min(1, ln.a / ln.tgtA) : ln ? 0 : 1; // a lane's packets arrive with the lane
    const c0 = !P ? null : ln ? laneCurve(ln, half, 0) : curveOf(key, 0), c1 = !P ? null : ln ? laneCurve(ln, half, 1) : curveOf(key, 1);
    for (let q = 0; q <= TR; q++) {
      const idx = j * (TR + 1) + q;
      if (!P || q > P.tr || la <= 0.01) { L.pSize[idx] = 0; continue; }
      const tt = Math.min(1, Math.max(0, t0 + (P.rev ? 1 : -1) * q * P.gap));
      if (ln) { c0!.getPoint(tt, pv); c1!.getPoint(tt, pv2); } else { c0!.getPointAt(tt, pv); c1!.getPointAt(tt, pv2); } pv.lerp(pv2, m);
      L.pPos[idx * 3] = pv.x; L.pPos[idx * 3 + 1] = pv.y; L.pPos[idx * 3 + 2] = pv.z;
      const f = 1 - q / (P.tr + 1);
      L.pCol[idx * 3] = P.col.r * f * g * la; L.pCol[idx * 3 + 1] = P.col.g * f * g * la; L.pCol[idx * 3 + 2] = P.col.b * f * g * la;
      L.pSize[idx] = P.size * ps * 1.4 * (q === 0 ? 1 : 0.7 * f) * la;
    }
  }
  const at = L.pGeo.attributes;
  at.position.needsUpdate = at.aColor.needsUpdate = at.aSize.needsUpdate = true;
}

// ---- agents: emerge from the parent along a tether, one tick of light per tool call, waiting is the only glow (prototype P:1575-1608) ----
export const ATP = 24;
const AS: Record<string, { a: number; l: number; s: number; t: number }> = {
  spawning: { a: 0.45, l: 0, s: 0.85, t: 0.4 }, working: { a: 1, l: 0.1, s: 1, t: 0.3 }, waiting: { a: 1, l: 0.2, s: 1, t: 0.5 }, done: { a: 0.38, l: 0, s: 0.72, t: 0.08 },
  failed: { a: 0.9, l: 0.16, s: 1, t: 0.25 }, blocked: { a: 0.55, l: 0, s: 1, t: 0.2 }, escalated: { a: 0.8, l: 0.08, s: 1, t: 0.25 },
};
const av1 = new THREE.Vector3(), av2 = new THREE.Vector3(), acv = new THREE.Vector3(), aup = new THREE.Vector3(), acol = new THREE.Color();
/** Per rendered frame. `wall` = Date.now() (spawn times are wall clock; the 4 s breathe runs on it too). Returns ms to keep rendering. */
export function frameAgents(L: Loop, m: number, dt: number, k: number, wall: number, reduce: boolean): number {
  const r = bindSlots(L.slots, L.tgt.ag, wall, L.lastBorn, reduce, L.mkSlot);
  L.lastBorn = r.lastBorn;
  const g = L.cur.g;
  for (const q of L.slots) {
    const T = q.T;
    if (!q.key || !T) { if (q.pts.visible) q.pts.visible = q.line.visible = false; continue; }
    if (q.init) { q.init = false; q.a = 0; q.c.set(T.col); q.pos.lerpVectors(T.pa, T.pb, m); }
    const S = AS[T.state] ?? AS.working;
    const e = q.born ? clamp((wall - q.born) / EMERGE_MS, 0, 1) : 1, ee = easeOut(e);
    av1.lerpVectors(T.pa, T.pb, m); av2.lerpVectors(T.oa, T.ob, m);
    const ln = T.lane?.key === q.key ? T.lane : undefined; // a lane's orb rides the lane's own eased node, so the two never drift apart; a lane re-bound to another task is not this orb's
    if (ln) av1.lerpVectors(ln.curA.node, ln.curB.node, m);
    const pt = T.par ? L.tgt.ag.find((x) => x.key === T.par) : undefined, pl = pt?.lane?.key === pt?.key ? pt?.lane : undefined; // a lane head's children tether to its eased node
    if (pl) av2.lerpVectors(pl.curA.node, pl.curB.node, m);
    if (e < 1) q.pos.lerpVectors(av2, av1, ee); else if (ln) q.pos.copy(av1); else q.pos.lerp(av1, 1 - Math.exp(-dt * 3));
    q.tick *= Math.exp(-dt * 4);
    q.a += ((q.live && wall >= q.born ? S.a : 0) - q.a) * k;
    if (!q.live && q.a < 0.01) { q.key = null; q.T = null; q.pts.visible = q.line.visible = false; continue; }
    q.c.lerp(acol.set(T.col), 1 - Math.exp(-dt * 1.6));
    const br = T.state === "waiting" ? (reduce ? 0.6 : 0.5 + 0.5 * Math.sin((Math.PI * 2 * wall) / 4000)) : 0;
    q.pts.visible = wall >= q.born; q.line.visible = q.pts.visible && T.state === "escalated" && !ln;
    q.pts.position.copy(q.pos); q.pts.scale.setScalar(T.r * S.s * (0.15 + 0.85 * ee));
    const u = q.mat.uniforms; u.uAlpha.value = q.a * g; u.uLit.value = S.l + br * 0.6 + q.tick * 0.3; u.uColor.value.copy(q.c);
    if (q.line.visible) {
      const arr = q.lg.attributes.position.array as Float32Array;
      acv.lerpVectors(av2, q.pos, 0.5).add(aup.set(0, 1.3 * (1 - m), 0.9 * m));
      for (let j = 0; j < ATP; j++) {
        const w = j / (ATP - 1), a0 = (1 - w) * (1 - w), a1 = 2 * w * (1 - w), a2 = w * w;
        arr[j * 3] = a0 * av2.x + a1 * acv.x + a2 * q.pos.x; arr[j * 3 + 1] = a0 * av2.y + a1 * acv.y + a2 * q.pos.y; arr[j * 3 + 2] = a0 * av2.z + a1 * acv.z + a2 * q.pos.z;
      }
      q.lg.attributes.position.needsUpdate = true;
      q.lm.color.copy(q.c); q.lm.opacity = q.a * g * S.t;
    }
  }
  return r.wakeMs;
}
