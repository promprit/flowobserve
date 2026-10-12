import { stats } from "./scene/perf";
import "@fontsource/archivo/500.css";
import "@fontsource/archivo/600.css";
import "@fontsource/archivo/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "./styles.css";
import { RESUME } from "./config";
import { bindInput } from "./input";
import { pager, pagerTick } from "./pager";
import { demand } from "./scene/demand";
import { type Scene, initScene } from "./scene/world";
import { connect, enableValidation, linkTick, spendBase, srcFrom } from "./source";
import { orbit } from "./scene/orbit";
import { changed, hooks, now, store, ui, view } from "./state";
import { bindCards, renderCards } from "./ui/cards";
import { bindDrawer } from "./ui/drawer";
import { bindOpen, renderSheet } from "./ui/open";
import { bindReader } from "./ui/reader";
import { renderFoot } from "./ui/foot";
import { bindTabs } from "./ui/tabs";
import { headSwap, renderHead } from "./ui/head";
import { renderHost } from "./ui/host";
import { bindSlim, renderSlim } from "./ui/slim";
import { renderModels } from "./ui/models";
import { bindUsage, renderUsage } from "./ui/usage";
import { bindInspect, tickInspect } from "./ui/inspect";
import type { NodeKey } from "@fo/shared";
import { $ } from "./util";

const qs = new URLSearchParams(location.search);
const RMQ = matchMedia("(prefers-reduced-motion: reduce)");
ui.reduce = RMQ.matches;
RMQ.addEventListener("change", (e) => { ui.reduce = e.matches; });

// orientation (prototype lines 650-664)
const forced = qs.get("orient"), FR = (qs.get("frame") || "").split("x").map(Number);
if (FR.length === 2 && FR[0]) {
  $("#app")!.style.cssText = `inset:auto;left:0;top:0;width:${FR[0]}px;height:${FR[1]}px`;
  document.documentElement.style.setProperty("--u", Math.min(FR[0], FR[1]) / 1440 + "px");
}
const isPortrait = () => (forced ? forced === "portrait" : FR[0] ? FR[1] > FR[0] : innerHeight > innerWidth);
const setBody = () => { const b = document.body.classList; b.toggle("portrait", ui.portrait); b.toggle("landscape", !ui.portrait); };
ui.portrait = isPortrait();
setBody();

let scene: Scene | null = null;
try { scene = initScene(); } catch (e) { console.error(e); document.body.classList.add("nogl"); }
hooks.headSwap = headSwap;
hooks.pick = (x, y) => scene?.pick(x, y) ?? null;
hooks.nodeScreen = (k) => scene?.nodeScreen(k) ?? null;

addEventListener("resize", () => {
  const p = isPortrait();
  if (p !== ui.portrait) {
    ui.portrait = p;
    setBody();
    const d = $("#dock")!;
    d.classList.add("relayout");
    requestAnimationFrame(() => requestAnimationFrame(() => { d.classList.remove("relayout"); d.style.transition = "opacity .9s cubic-bezier(.22,1,.36,1)"; }));
    scene?.relayout(p);
  }
  changed();
});

bindCards(); bindTabs(); bindUsage(); bindSlim(); bindDrawer(); bindOpen(); bindReader(); bindInspect();

const src = import.meta.env.MODE === "demo" || qs.has("agents") ? null : srcFrom(location, qs); // demo build and ?agents=a..f run the simulator, like ?demo
if (src) {
  if (import.meta.env.DEV) await enableValidation();
  store.spendBase = spendBase(src);
  connect(src);
  bindInput();
} else {
  const sim = await import("./sim");
  const d = qs.get("demo"), aq = qs.get("agents");
  if (aq) { sim.startAgents(aq, qs.has("replay"), qs.has("pick")); if (view.zt > 0) pager.pinUntil = now() + RESUME; } // a focused agents scenario stays on its loop (the idle zoom-out would hide the orbs from hover)
  else sim.startSim(d === null || d === "" || d === "offline" ? 4 : Number(d));
  if (d === "offline") sim.simKey("o");
  const st = qs.get("state");
  if (st || qs.has("pause")) setTimeout(() => { if (st) sim.simKey(st); if (qs.has("pause")) sim.pauseSim(); }, 1200);
  const lq = qs.get("life"); if (lq === "working" || lq === "breathing" || lq === "still") ui.life = lq;
  const hq = qs.get("host");
  if (hq) sim.simHost(hq);
  const cq = qs.get("ctx"); if (cq) sim.simCtx(cq);
  bindInput({ key: sim.simKey });
}
/** __fo.perf() is always there (read-only, no network); the other probes only for the demo or ?probe. */
const probe: Record<string, unknown> = { frames: () => demand.rendered, perf: stats };
probe.orbit = () => ({ yaw: orbit.yaw, pitch: orbit.pitch });
probe.node = (k: NodeKey) => scene?.nodeScreen(k) ?? null;
probe.agent = (id: string) => scene?.agentScreen(id) ?? null;
Object.assign(window, { __fo: store.demo || qs.has("probe") ? probe : { perf: stats } });
if (qs.has("freeze")) ui.freezeT = 10;
if (qs.get("zoom") === "out") { view.zt = view.z = 0; pager.pinUntil = now() + RESUME; }
renderHead();

let lastSecond = 0;
function uiTick(): void {
  if (src) linkTick();
  pagerTick();
  const full = now() - lastSecond > 1000;
  if (ui.dirty || full) {
    if (full) lastSecond = now();
    renderCards(); renderFoot(); renderSheet();
    if (full) { renderUsage(); renderHost(); renderSlim(); renderModels(); }
    if (!$("#head")!.classList.contains("out")) renderHead();
    tickInspect();
    scene?.sync();
    ui.dirty = false;
  }
}

let lastRAF = 0, lastErr = "";
function loop(): void {
  requestAnimationFrame(loop);
  lastRAF = performance.now();
  if (document.hidden) return;
  try { uiTick(); scene?.frame(); } catch (e) { const m = String((e as Error)?.stack ?? e); if (m !== lastErr) { lastErr = m; console.error(e); } }
}
loop();
setInterval(() => { if (document.hidden || performance.now() - lastRAF < 500) return; try { uiTick(); scene?.frame(); } catch { /* next frame logs */ } }, 250);
document.fonts?.ready.then(() => { scene?.resize(); changed(); });

if ("serviceWorker" in navigator && !import.meta.env.DEV && import.meta.env.MODE !== "demo") navigator.serviceWorker.register("/sw.js").catch(() => {});
