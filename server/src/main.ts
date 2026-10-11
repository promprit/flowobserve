import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DAY_MS, POLL_MS, REGISTRY_MS, SPOOL_RETENTION_DAYS, TICK_MS, loadConfig } from "./config";
import { Engine } from "./engine";
import { RootCache, handoffSavedAt } from "./handoff";
import { createServer } from "./http";
import { HOST_MS, HostPoller, realDeps } from "./hostpoll";
import { pidAlive, readRegistry } from "./registry";
import { Store } from "./store";
import { Tailer, pruneSpool } from "./tailer";
import { TranscriptTailer, warnPctFrom } from "./transcript";
import { UsageCachePoller } from "./usagepoll";

const cfg = loadConfig();
fs.mkdirSync(cfg.spoolDir, { recursive: true });

const store = new Store(cfg.dbPath);
const engine = new Engine(store);
engine.load();
engine.helperJson = cfg.helperJson;
engine.edition = cfg.edition;
engine.jevPresent = fs.existsSync(cfg.jevLogDir);
if (process.env.FO_EDITION && process.env.FO_EDITION !== cfg.edition) console.warn(`fo-server: FO_EDITION=${process.env.FO_EDITION} ignored, using ${cfg.edition}`);
engine.machineBootAt = Date.now() - os.uptime() * 1000;
engine.setProjectsRoot(cfg.projectsRoot);

const transcripts = new TranscriptTailer(cfg.transcriptsRoot, (items) => engine.onTranscripts(items), { onRc: (sid, r) => engine.onRc(sid, r), onMeta: (sid, m) => engine.onMeta(sid, m) });
engine.transcripts = transcripts;
let thr = { mtime: -1, pct: warnPctFrom(null) };
engine.warnPct = () => {
  try {
    const mt = fs.statSync(cfg.thresholdsPath).mtimeMs;
    if (mt !== thr.mtime) thr = { mtime: mt, pct: warnPctFrom(fs.readFileSync(cfg.thresholdsPath, "utf8")) };
  } catch { thr = { mtime: -1, pct: warnPctFrom(null) }; }
  return thr.pct;
};
const roots = new RootCache();

const plat = process.platform;
const hostPoller = plat === "darwin" || plat === "win32"
  ? new HostPoller(realDeps, cfg.disks, (host) => { engine.setHost(host); hub.broadcast({ type: "host", host }); }, HOST_MS, plat)
  : null;
const { server, hub } = createServer(engine, cfg.staticDir, { onClients: (n) => hostPoller?.clients(n) });
engine.out = {
  session: (session) => hub.broadcast({ type: "session", session }),
  usage: (usage) => hub.broadcast({ type: "usage", usage }),
  metrics: (m) => hub.broadcast(m),
  snapshot: (m) => hub.broadcast(m),
  projects: (m) => hub.broadcast(m),
};

const tailer = new Tailer(store, [
  { dir: cfg.spoolDir, match: /^\d{4}-\d{2}-\d{2}\.jsonl$/, onLine: (_f, line) => engine.ingestSpool(line) },
  { dir: cfg.jevLogDir, match: /\.jsonl$/, onLine: (f, line) => engine.ingestJev(path.basename(f, ".jsonl"), line) },
], () => engine.flush());

server.on("error", (err: NodeJS.ErrnoException) => {
  console.error(err.code === "EADDRINUSE" ? `fo-server: port ${cfg.port} is busy; not starting` : `fo-server: ${err.message}`);
  process.exit(1);
});

const usagePoller = new UsageCachePoller(cfg.usageCachePath, (u) => { engine.setUsage(u); engine.flush(); });

server.listen(cfg.port, "127.0.0.1", () => {
  console.log(`fo-server listening on http://127.0.0.1:${cfg.port} (FO_HOME=${cfg.home})`);
  pruneSpool(store, cfg.spoolDir, Date.now(), SPOOL_RETENTION_DAYS);
  store.closedPrune(Date.now() - 7 * DAY_MS);
  tailer.start(POLL_MS);
  try { usagePoller.check(); } catch (err) { console.error("fo-server: usage cache failed:", err); }
  setInterval(() => {
    try { engine.tick(); } catch (err) { console.error("fo-server: tick failed:", err); }
  }, TICK_MS);
  setInterval(() => {
    try { transcripts.poll(); engine.flush(); } catch (err) { console.error("fo-server: transcripts failed:", err); }
  }, POLL_MS);
  setInterval(() => {
    for (const { id, cwd } of engine.liveIds())
      roots.get(cwd).then((root) => {
        try { engine.setHandoff(id, handoffSavedAt(cfg.handoffDir, root, Date.now())); } catch (err) { console.error("fo-server: handoff failed:", err); }
      }, () => {});
  }, 5_000);
  setInterval(() => {
    try { engine.onRegistry(readRegistry(cfg.sessionsDir), pidAlive); engine.flush(); } catch (err) { console.error("fo-server: registry failed:", err); }
  }, REGISTRY_MS);
  setInterval(() => {
    try { engine.rescan(); } catch (err) { console.error("fo-server: rescan failed:", err); }
  }, 60_000);
  setInterval(() => {
    try { usagePoller.check(); } catch (err) { console.error("fo-server: usage cache failed:", err); }
  }, TICK_MS);
  setInterval(() => {
    try { pruneSpool(store, cfg.spoolDir, Date.now(), SPOOL_RETENTION_DAYS); store.closedPrune(Date.now() - 7 * DAY_MS); } catch (err) { console.error("fo-server: prune failed:", err); }
  }, DAY_MS);
});

const stop = () => { hostPoller?.clients(0); tailer.stop(); server.close(); process.exit(0); };
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
