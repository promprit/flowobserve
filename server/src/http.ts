import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { HB_MS } from "./config";
import type { Engine } from "./engine";
import { RANGES, type Range } from "./queries";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ico": "image/x-icon",
};

/** Localhost only: blocks DNS rebinding (Host) and other web pages (Origin). */
export function allowed(req: http.IncomingMessage, port: number): boolean {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!hosts.includes(req.headers.host ?? "")) return false;
  const origin = req.headers.origin;
  return origin === undefined || hosts.some((h) => origin === `http://${h}`);
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

function serveStatic(root: string, pathname: string, res: http.ServerResponse): void {
  let rel: string;
  try { rel = decodeURIComponent(pathname); } catch { res.writeHead(400).end(); return; }
  if (rel.includes("\0")) { res.writeHead(400).end(); return; }
  const base = path.resolve(root);
  const file = path.resolve(base, "." + rel);
  if (!file.startsWith(base + path.sep)) { res.writeHead(404).end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404).end(); return; }
    const cache = file.startsWith(path.join(base, "assets") + path.sep) ? "public, max-age=31536000, immutable" : "no-cache";
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "cache-control": cache });
    fs.createReadStream(file).on("error", () => res.destroy()).pipe(res);
  });
}

export function createServer(engine: Engine, staticDir: string, opts: { hbMs?: number; onClients?: (n: number) => void } = {}): { server: http.Server; hub: { broadcast(msg: unknown): void } } {
  const sse = new Set<http.ServerResponse>();
  const wss = new WebSocketServer({ noServer: true });
  const server = http.createServer();
  const port = () => (server.address() as AddressInfo).port;
  let clients = 0;
  const count = (d: number) => {
    clients += d;
    try { opts.onClients?.(clients); } catch (err) { console.error("fo-server: client hook failed:", err); }
  };

  const hub = {
    broadcast(msg: unknown) {
      const data = JSON.stringify(msg);
      for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(data);
      for (const r of sse) r.write(`data: ${data}\n\n`);
    },
  };

  const hb = setInterval(() => hub.broadcast({ type: "hb", at: Date.now() }), opts.hbMs ?? HB_MS);
  hb.unref();

  server.on("request", (req, res) => {
    try {
      handle(req, res);
    } catch (err) {
      console.error("fo-server: request failed:", err);
      if (!res.headersSent) res.writeHead(500).end();
      else res.destroy();
    }
  });

  function dismiss(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.method !== "POST") { res.writeHead(405).end(); return; }
    const t = req.headers["x-fo-token"];
    if (!engine.tokenOk(typeof t === "string" ? t : undefined)) { res.writeHead(403).end(); return; }
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 4096) req.destroy(); });
    req.on("end", () => {
      let sid: unknown;
      try { sid = (JSON.parse(body) as { sid?: unknown }).sid; } catch { /* bad body: unknown sid */ }
      if (typeof sid !== "string" || !engine.dismiss(sid)) { res.writeHead(404).end(); return; }
      engine.flush();
      json(res, 200, { ok: true });
    });
  }

  function color(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.method !== "POST") { res.writeHead(405).end(); return; }
    const t = req.headers["x-fo-token"];
    if (!engine.tokenOk(typeof t === "string" ? t : undefined)) { res.writeHead(403).end(); return; }
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 4096) req.destroy(); });
    req.on("end", () => {
      let b: { key?: unknown; color?: unknown } | null = {};
      try { b = JSON.parse(body) as typeof b; } catch { /* bad body: 400 below */ }
      const ok = b !== null && typeof b === "object" && typeof b.key === "string" && (b.color === null || typeof b.color === "string") && engine.setColor(b.key, b.color as string | null);
      if (!ok) { res.writeHead(400).end(); return; }
      engine.flush();
      json(res, 200, { ok: true });
    });
  }

  function handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (!allowed(req, port())) { res.writeHead(403).end(); return; }
    let url: URL;
    try { url = new URL(req.url ?? "/", `http://${req.headers.host}`); } catch { res.writeHead(400).end(); return; }
    if (url.pathname === "/api/dismiss") return dismiss(req, res);
    if (url.pathname === "/api/color") return color(req, res);
    if (req.method !== "GET") { res.writeHead(405).end(); return; }
    switch (url.pathname) {
      case "/health":
        return json(res, 200, engine.health());
      case "/spend": {
        const r = url.searchParams.get("range") ?? "today";
        if (!RANGES.has(r)) return json(res, 400, { error: "range must be today, 7d or month" });
        return json(res, 200, engine.spend(r as Range));
      }
      case "/api/kpis":
        return json(res, 200, engine.kpisReport());
      case "/api/doc": {
        const r = engine.doc(url.searchParams.get("session") ?? "", url.searchParams.get("kind") ?? "");
        if (r.status !== 200) { res.writeHead(r.status, { "cache-control": "no-store" }).end(); return; }
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(r.body));
        return;
      }
      case "/events": {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        res.write(`data: ${JSON.stringify(engine.snapshot())}\n\n`);
        const pm = engine.projectsMsg();
        if (pm) res.write(`data: ${JSON.stringify(pm)}\n\n`);
        sse.add(res);
        count(1);
        req.on("close", () => { if (sse.delete(res)) count(-1); });
        return;
      }
      case "/":
        return serveStatic(staticDir, "/index.html", res);
      default:
        serveStatic(staticDir, url.pathname, res);
    }
  }

  server.on("upgrade", (req, socket, head) => {
    try {
      if (!allowed(req, port())) {
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      let url: URL;
      try { url = new URL(req.url ?? "/", "http://localhost"); } catch {
        socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      if (url.pathname !== "/ws") {
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        count(1);
        ws.on("close", () => count(-1));
        ws.on("error", () => ws.terminate());
        ws.send(JSON.stringify(engine.snapshot()));
        const pm = engine.projectsMsg();
        if (pm) ws.send(JSON.stringify(pm));
      });
    } catch (err) {
      console.error("fo-server: upgrade failed:", err);
      socket.destroy();
    }
  });

  server.on("close", () => {
    clearInterval(hb);
    for (const c of wss.clients) c.terminate();
    for (const r of sse) r.end();
  });

  return { server, hub };
}
