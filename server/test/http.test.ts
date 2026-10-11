import fs from "node:fs";
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { MsgZ } from "@fo/shared";
import { Engine } from "../src/engine";
import { createServer } from "../src/http";
import { Store } from "../src/store";
import { at, mk } from "./helpers";

let close: (() => void) | null = null;
afterEach(() => { close?.(); close = null; });

async function start(opts: { hbMs?: number; onClients?: (n: number) => void } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fo-http-"));
  fs.writeFileSync(path.join(dir, "index.html"), "<html>ok</html>");
  fs.mkdirSync(path.join(dir, "assets"));
  fs.writeFileSync(path.join(dir, "assets", "app-1.js"), "x");
  const engine = new Engine(new Store(":memory:"), () => at(10));
  engine.ingestSpool(mk().pre(1, "Skill", { skill: "writing-plans" }));
  const { server, hub } = createServer(engine, dir, opts);
  engine.out = { session: (s) => hub.broadcast({ type: "session", session: s }) };
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  close = () => server.close();
  return { engine, port };
}

function get(port: number, p: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: p, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode!, body, headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
}

function post(port: number, p: string, body: string, headers: Record<string, string> = {}, method = "POST"): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: p, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode!)); });
    req.on("error", reject);
    req.end(body);
  });
}

describe("POST /api/dismiss", () => {
  const TOKEN = "cd".repeat(32);
  async function withToken() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fo-helper-"));
    const f = path.join(dir, "helper.json");
    fs.writeFileSync(f, JSON.stringify({ token: TOKEN }));
    const r = await start();
    r.engine.helperJson = f;
    r.engine.setProjectsRoot(null);
    return r;
  }
  it("needs the helper token, a POST and a known sid; then the session ends", async () => {
    const { port, engine } = await withToken();
    const h = { "x-fo-token": TOKEN, "content-type": "application/json" };
    expect(await post(port, "/api/dismiss", "", {}, "GET")).toBe(405);
    expect(await post(port, "/api/dismiss", '{"sid":"s1"}')).toBe(403);
    expect(await post(port, "/api/dismiss", '{"sid":"s1"}', { "x-fo-token": "0".repeat(64) })).toBe(403);
    expect(await post(port, "/api/dismiss", '{"sid":"s1"}', { ...h, origin: "http://evil.example" })).toBe(403);
    expect(await post(port, "/api/dismiss", '{"sid":"nope"}', h)).toBe(404);
    expect(engine.liveIds()).toHaveLength(1);
    expect(await post(port, "/api/dismiss", '{"sid":"s1"}', h)).toBe(200);
    expect(engine.liveIds()).toHaveLength(0);
  });
  it("without a helper token every dismiss is refused", async () => {
    const { port } = await start();
    expect(await post(port, "/api/dismiss", '{"sid":"s1"}', { "x-fo-token": TOKEN })).toBe(403);
  });
});

describe("POST /api/color", () => {
  const TOKEN = "cd".repeat(32);
  async function withToken() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fo-helper-"));
    const f = path.join(dir, "helper.json");
    fs.writeFileSync(f, JSON.stringify({ token: TOKEN }));
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), "fo-root-"));
    fs.mkdirSync(path.join(proj, "app", ".git"), { recursive: true });
    const r = await start();
    r.engine.helperJson = f;
    r.engine.setProjectsRoot(proj);
    return { ...r, h: { "x-fo-token": TOKEN, "content-type": "application/json" } };
  }

  it("stores a palette colour with a valid token", async () => {
    const { port, h, engine } = await withToken();
    expect(await post(port, "/api/color", '{"key":"app","color":"#e06c75"}', h)).toBe(200);
    expect(engine.projectsMsg()!.projects.find((p) => p.key === "app")!.color).toBe("#e06c75");
    expect(await post(port, "/api/color", '{"key":"app","color":null}', h)).toBe(200);
  });
  it("guards method, token, origin and body", async () => {
    const { port, h } = await withToken();
    expect(await post(port, "/api/color", "", {}, "GET")).toBe(405);
    expect(await post(port, "/api/color", '{"key":"app","color":"#e06c75"}')).toBe(403);
    expect(await post(port, "/api/color", '{"key":"app","color":"#e06c75"}', { ...h, origin: "http://evil.example" })).toBe(403);
    expect(await post(port, "/api/color", '{"key":"app","color":"#123456"}', h)).toBe(400);
    expect(await post(port, "/api/color", '{"key":"zzz/deep","color":"#e06c75"}', h)).toBe(400);
    expect(await post(port, "/api/color", "not json", h)).toBe(400);
    expect(await post(port, "/api/color", '{"key":5}', h)).toBe(400);
    expect(await post(port, "/api/color", "null", h)).toBe(400);
    expect(await post(port, "/api/color", "5", h)).toBe(400);
    expect(await post(port, "/api/color", '"x"', h)).toBe(400);
    expect(await post(port, "/api/color", '{"key":"app","color":"#e06c75"}', h)).toBe(200);
  });
});

describe("http", () => {
  it("serves the Dryas KPIs at /api/kpis", async () => {
    const { port } = await start();
    const r = await get(port, "/api/kpis");
    expect(r.status).toBe(200);
    const body = JSON.parse(r.body);
    expect(body).toMatchObject({ source: "dryas metrics.md@8cd1ad3", at: expect.any(Number), ok: true });
    expect(body.kpis).toHaveLength(9);
  });

  it("serves health, spend and the PWA", async () => {
    const { port } = await start();
    expect(JSON.parse((await get(port, "/health")).body)).toMatchObject({ ok: true, sessions: 1 });
    expect((await get(port, "/spend?range=7d")).status).toBe(200);
    expect((await get(port, "/spend?range=year")).status).toBe(400);
    const r = await get(port, "/");
    expect(r.status).toBe(200);
    expect(r.body).toBe("<html>ok</html>");
    expect(r.headers["cache-control"]).toBe("no-cache");
    expect((await get(port, "/assets/app-1.js")).headers["cache-control"]).toContain("immutable");
    expect((await get(port, "/index.html")).headers["cache-control"]).toBe("no-cache");
    expect((await get(port, "/../package.json")).status).toBe(404);
    expect((await get(port, "/%2e%2e/package.json")).status).toBe(404);
  });

  it("an assets path that resolves outside assets is not served immutable", async () => {
    const { port } = await start();
    const r = await get(port, "/assets/..%2findex.html");
    expect(r.status).toBe(200);
    expect(r.headers["cache-control"]).toBe("no-cache");
    expect((await get(port, "/assets/app-1.js")).headers["cache-control"]).toContain("immutable");
  });

  it("broadcasts a heartbeat so idle clients can tell quiet from stale", async () => {
    const { port } = await start({ hbMs: 30 });
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const types: string[] = [];
    await new Promise<void>((resolve) => ws.on("message", (d) => {
      const m = MsgZ.parse(JSON.parse(String(d)));
      types.push(m.type);
      if (m.type === "hb") { ws.close(); resolve(); }
    }));
    expect(types[0]).toBe("snapshot");
    expect(types).toContain("hb");
  }, 2000);

  it("rejects foreign host and origin", async () => {
    const { port } = await start();
    expect((await get(port, "/health", { host: `evil.com:${port}` })).status).toBe(403);
    expect((await get(port, "/health", { origin: "http://evil.com" })).status).toBe(403);
    expect((await get(port, "/events", { origin: "http://evil.com" })).status).toBe(403);
    expect((await get(port, "/health", { origin: `http://localhost:${port}`, host: `localhost:${port}` })).status).toBe(200);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { origin: "http://evil.com" } });
    const failed = await new Promise<boolean>((r) => { ws.on("error", () => r(true)); ws.on("open", () => r(false)); });
    expect(failed).toBe(true);
  });

  it("WebSocket sends a snapshot first, then session updates", async () => {
    const { engine, port } = await start();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const msgs: unknown[] = [];
    await new Promise<void>((r) => ws.on("message", (d) => { msgs.push(JSON.parse(String(d))); if (msgs.length === 1) r(); }));
    expect(MsgZ.parse(msgs[0])).toMatchObject({ type: "snapshot", sessions: [{ stage: 1 }] });
    const next = new Promise<void>((r) => ws.on("message", () => r()));
    engine.ingestSpool(mk().stop(2));
    await next;
    expect(MsgZ.parse(msgs[1])).toMatchObject({ type: "session", session: { status: "waiting" } });
    ws.close();
  });

  it("SSE sends the snapshot as the first event", async () => {
    const { port } = await start();
    const first = await new Promise<string>((resolve) => {
      const req = http.request({ host: "127.0.0.1", port, path: "/events", headers: { host: `127.0.0.1:${port}` } }, (res) => {
        res.once("data", (c) => { resolve(String(c)); req.destroy(); });
      });
      req.end();
    });
    expect(first.startsWith("data: ")).toBe(true);
    expect(JSON.parse(first.slice(6)).type).toBe("snapshot");
  });

  it("survives a null byte in the path", async () => {
    const { port } = await start();
    expect((await get(port, "/%00")).status).toBe(400);
    expect((await get(port, "/health")).status).toBe(200);
  });

  it("survives a malformed request-target", async () => {
    const { port } = await start();
    const reply = await new Promise<string>((resolve) => {
      const sock = net.connect(port, "127.0.0.1", () => sock.write(`GET http://[/ HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`));
      let buf = "";
      sock.on("data", (c) => (buf += c));
      sock.on("close", () => resolve(buf));
      sock.on("error", () => resolve(buf));
    });
    expect(reply).toMatch(/^HTTP\/1\.1 4\d\d/);
    expect((await get(port, "/health")).status).toBe(200);
  });

  it("survives an invalid WebSocket frame", async () => {
    const { port } = await start();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.on("error", () => {});
    await new Promise<void>((r) => ws.on("open", () => r()));
    (ws as unknown as { _socket: net.Socket })._socket.write(Buffer.from([0x83, 0x80, 0, 0, 0, 0]));
    await new Promise((r) => setTimeout(r, 100));
    expect((await get(port, "/health")).status).toBe(200);
  });

  it("reports the connected client count for WebSocket and SSE", async () => {
    const seen: number[] = [];
    const { port } = await start({ onClients: (n) => seen.push(n) });
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { origin: `http://127.0.0.1:${port}` } });
    await new Promise((r) => ws.once("message", r));
    expect(seen).toEqual([1]);
    const req = http.get({ host: "127.0.0.1", port, path: "/events" });
    await new Promise<void>((r) => req.once("response", (res) => res.once("data", () => r())));
    expect(seen).toEqual([1, 2]);
    ws.close();
    req.destroy();
    await expect.poll(() => seen.at(-1)).toBe(0);
    expect(seen).toEqual([1, 2, 1, 0]);
  });
});
