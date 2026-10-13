import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AccountsFile, accountRoots } from "./accounts";
import { DAY_MS, JEV_SEEN_DAYS, POLL_MS, REGISTRY_MS, SPOOL_RETENTION_DAYS, TICK_MS, loadConfig, resolveJev, type JevPaths } from "./config";
import { Engine } from "./engine";
import { RootCache, handoffSavedAt } from "./handoff";
import { createServer } from "./http";
import { HOST_MS, HostPoller, realDeps } from "./hostpoll";
import { pidAlive, readRegistries } from "./registry";
import { Store } from "./store";
import { Tailer, backfillJevSeen, pruneSpool, type TailSource } from "./tailer";
import { TranscriptTailer, warnPctFrom } from "./transcript";
import { UsageCachePoller } from "./usagepoll";

const cfg = loadConfig();
fs.mkdirSync(cfg.spoolDir, { recursive: true });

const store = new Store(cfg.dbPath);
const engine = new Engine(store);
engine.load();
engine.helperJson = cfg.helperJson;
engine.edition = cfg.edition;
// Jev state: FO_* / JEV_* env > Dryas data root (~/.dryas/jev/logs) and/or legacy ~/.claude/jev (see resolveJev);
// re-checked every minute so a migration is picked up live. Lines are deduped, so reading both dirs is safe.
let jev: JevPaths = { logDirs: cfg.jevLogDirs, handoffDirs: cfg.handoffDirs, thresholdsPath: cfg.thresholdsPath };
const sharedLogs = path.join(cfg.dryasRoot, "jev", "logs");
backfillJevSeen(store, [cfg.spoolDir], jev.logDirs.includes(sharedLogs) ? sharedLogs : null);
engine.jevPresent = jev.logDirs.some((d) => fs.existsSync(d));
engine.switchAt = cfg.switchAt;
if (process.env.FO_EDITION && process.env.FO_EDITION !== cfg.edition) console.warn(`fo-server: FO_EDITION=${process.env.FO_EDITION} ignored, using ${cfg.edition}`);
engine.machineBootAt = Date.now() - os.uptime() * 1000;
engine.setProjectsRoot(cfg.projectsRoot);
const accountsFile = new AccountsFile(cfg.accountsPath, cfg.dryasAccountsPath, cfg.claudeDirs);
accountsFile.check();
engine.setAccounts(accountsFile.accounts());

// Every watched Claude config dir: the board accounts (FlowObserve's and Dryas's accounts.json) plus the server's own dirs (re-read on change).
const rootsOf = (): { projects: string[]; sessions: string[] } => {
  const dirs = accountsFile.watchDirs().map((dir) => ({ dir }));
  return { projects: accountRoots(dirs, "projects", cfg.transcriptsEnv), sessions: accountRoots(dirs, "sessions", cfg.sessionsEnv) };
};
let acctRoots = rootsOf(); // recomputed only when accountsFile.check() reports a change
const transcripts = new TranscriptTailer(acctRoots.projects, (items) => engine.onTranscripts(items), { onRc: (sid, r) => engine.onRc(sid, r), onMeta: (sid, m) => engine.onMeta(sid, m) });
engine.transcripts = transcripts;
let thr = { mtime: -1, pct: warnPctFrom(null) };
engine.warnPct = () => {
  try {
    const mt = fs.statSync(jev.thresholdsPath).mtimeMs;
    if (mt !== thr.mtime) thr = { mtime: mt, pct: warnPctFrom(fs.readFileSync(jev.thresholdsPath, "utf8")) };
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

const spoolSource: TailSource = { dir: cfg.spoolDir, match: /^\d{4}-\d{2}-\d{2}\.jsonl$/, onLine: (_f, line) => engine.ingestSpool(line) };
const jevSources = (dirs: string[]): TailSource[] =>
  dirs.map((dir) => ({ dir, match: /\.jsonl$/, onLine: (f: string, line: string) => engine.ingestJev(path.basename(f, ".jsonl"), line) }));
const tailer = new Tailer(store, [spoolSource, ...jevSources(jev.logDirs)], () => engine.flush());

/** Dryas migrated (or Jev appeared) while we run: tail the new set of log dirs. */
function recheckJev(): void {
  const next = resolveJev(process.env, os.homedir());
  if (next.logDirs.join("\0") !== jev.logDirs.join("\0")) {
    tailer.setSources([spoolSource, ...jevSources(next.logDirs)]);
    console.log(`fo-server: Jev logs now read from ${next.logDirs.join(", ")}`);
  }
  jev = next;
  engine.jevPresent = jev.logDirs.some((d) => fs.existsSync(d));
}

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
        try {
          const now = Date.now(), at = jev.handoffDirs.map((d) => handoffSavedAt(d, root, now)).filter((x): x is number => x !== null);
          engine.setHandoff(id, at.length ? Math.max(...at) : null);
        } catch (err) { console.error("fo-server: handoff failed:", err); }
      }, () => {});
  }, 5_000);
  setInterval(() => {
    try {
      if (accountsFile.check()) {
        engine.setAccounts(accountsFile.accounts());
        acctRoots = rootsOf();
        transcripts.setRoots(acctRoots.projects);
      }
    } catch (err) { console.error("fo-server: accounts failed:", err); }
    try { engine.onRegistry(readRegistries(acctRoots.sessions), pidAlive); engine.flush(); } catch (err) { console.error("fo-server: registry failed:", err); }
  }, REGISTRY_MS);
  setInterval(() => {
    try { engine.rescan(); } catch (err) { console.error("fo-server: rescan failed:", err); }
    try { recheckJev(); } catch (err) { console.error("fo-server: jev paths failed:", err); }
  }, 60_000);
  setInterval(() => {
    try { usagePoller.check(); } catch (err) { console.error("fo-server: usage cache failed:", err); }
  }, TICK_MS);
  setInterval(() => {
    try { pruneSpool(store, cfg.spoolDir, Date.now(), SPOOL_RETENTION_DAYS); store.closedPrune(Date.now() - 7 * DAY_MS); store.jevSeenPrune(Date.now() - JEV_SEEN_DAYS * DAY_MS); } catch (err) { console.error("fo-server: prune failed:", err); }
  }, DAY_MS);
});

const stop = () => { hostPoller?.clients(0); tailer.stop(); server.close(); process.exit(0); };
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
