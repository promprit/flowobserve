import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Kpi } from "@fo/shared";
import { connect, enableValidation, type Env, linkState, linkTick, parse, spendBase, srcFrom } from "../src/source";
import { store } from "../src/state";
import { METRICS, T0, reset, snap, wire } from "./helpers";

class FakeWS {
  static all: FakeWS[] = [];
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor(public url: string) { FakeWS.all.push(this); }
  close() { this.onclose?.({}); }
  send(m: unknown) { this.onmessage?.({ data: JSON.stringify(m) }); }
}
const env: Env = {
  WebSocket: FakeWS as unknown as Env["WebSocket"],
  EventSource: FakeWS as unknown as Env["EventSource"],
  setTimeout: (f, ms) => setTimeout(f, ms),
  now: () => Date.now(),
};
const last = () => FakeWS.all[FakeWS.all.length - 1];

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); reset(); FakeWS.all = []; });

describe("addresses", () => {
  const loc = { protocol: "http:", host: "127.0.0.1:4317" };
  it("defaults to the serving host, honours ?src in dev, and ?demo means no source", () => {
    expect(srcFrom(loc, new URLSearchParams(""), false)).toBe("ws://127.0.0.1:4317/ws");
    expect(srcFrom({ protocol: "https:", host: "h" }, new URLSearchParams(""), false)).toBe("wss://h/ws");
    expect(srcFrom(loc, new URLSearchParams("src=http://x:1/events"), false)).toBe("http://x:1/events");
    expect(srcFrom(loc, new URLSearchParams("demo=4"), false)).toBeNull();
    expect(srcFrom(loc, new URLSearchParams("demo"), false)).toBeNull();
    expect(spendBase("ws://127.0.0.1:4317/ws")).toBe("http://127.0.0.1:4317");
    expect(spendBase("wss://h/ws")).toBe("https://h");
    expect(spendBase("http://h:1/events")).toBe("http://h:1");
  });

  it("in production honours ?src only on the serving host", () => {
    expect(srcFrom(loc, new URLSearchParams("src=http://127.0.0.1:4317/events"), true)).toBe("http://127.0.0.1:4317/events");
    expect(srcFrom(loc, new URLSearchParams("src=ws://evil.example/ws"), true)).toBe("ws://127.0.0.1:4317/ws");
    expect(srcFrom(loc, new URLSearchParams("src=http://127.0.0.1:9999/events"), true)).toBe("ws://127.0.0.1:4317/ws");
  });

  it("a malformed ?src never throws", () => {
    expect(srcFrom(loc, new URLSearchParams("src=::nope"), true)).toBe("ws://127.0.0.1:4317/ws");
    expect(() => spendBase("::nope")).not.toThrow();
    expect(spendBase("::nope")).toBeNull();
  });
});

describe("linkState", () => {
  it("is live while open and heard from within 10 s, stale for the next 10 s, then offline", () => {
    expect(linkState(T0 + 9_000, { open: true, lastMsgAt: T0, downAt: null })).toBe("live");
    expect(linkState(T0 + 15_000, { open: true, lastMsgAt: T0, downAt: null })).toBe("stale");
    expect(linkState(T0 + 20_000, { open: true, lastMsgAt: T0, downAt: null })).toBe("offline");
    expect(linkState(T0 + 1_000, { open: false, lastMsgAt: T0, downAt: T0 })).toBe("stale");
    expect(linkState(T0 + 10_000, { open: false, lastMsgAt: T0, downAt: T0 })).toBe("offline");
    expect(linkState(T0 + 5_000, { open: true, lastMsgAt: 0, downAt: T0 })).toBe("stale");
  });
});

describe("connect", () => {
  it("a host message fills the row; a later snapshot without host clears it", () => {
    connect("ws://h/ws", env);
    const ws = last();
    ws.onopen?.({});
    const host = { at: 1, cpu: 0.2, gpu: null, mem: { used: 0.5, pressure: "normal" }, disks: [] };
    ws.send(snap([wire("a")]));
    expect(store.host).toBeNull();
    ws.send({ type: "host", host });
    expect(store.host).toEqual(host);
    ws.send({ ...snap([wire("a")]), host });
    expect(store.host).toEqual(host);
    ws.send(snap([wire("a")]));
    expect(store.host).toBeNull();
  });
  it("applies snapshot, session, usage and metrics messages", () => {
    connect("ws://h/ws", env);
    const ws = last();
    ws.onopen?.({});
    const { kpis: _omit, ...noKpis } = snap([wire("a"), wire("b")]);
    ws.send(noKpis);
    expect(store.kpis).toEqual([]);
    ws.send({ type: "session", session: wire("c", { status: "waiting", action: "ANSWER" }) });
    const K: Kpi = { id: "ESC-M1", tile: "build", value: 0.24, unit: "pct", healthy: "<20%", window: "7d", n: 17, ready: true, warn: true, next: "read escalation reasons" };
    ws.send({ type: "metrics", metrics: METRICS, blockedMs: 120_000, blockedWindowMs: 60_000, kpis: [K] });
    expect(store.kpis).toEqual([K]);
    expect([...store.sessions.keys()]).toEqual(["a", "b", "c"]);
    expect(store.blockedMs).toBe(120_000);
    expect(store.blockedWindowMs).toBe(60_000);
    ws.send(snap([wire("c")]));
    expect([...store.sessions.keys()]).toEqual(["c"]);
    linkTick();
    expect(store.link).toBe("live");
  });

  it("a heartbeat alone keeps a quiet link live", () => {
    connect("ws://h/ws", env);
    const ws = last();
    ws.onopen?.({});
    ws.send(snap([]));
    for (let i = 0; i < 6; i++) { vi.advanceTimersByTime(5_000); ws.send({ type: "hb", at: Date.now() }); }
    linkTick();
    expect(store.link).toBe("live");
  });

  it("goes stale on close, retries with backoff 1 s then 2 s, and recovers on the next message", () => {
    connect("ws://h/ws", env);
    const a = last();
    a.onopen?.({});
    a.send(snap([wire("a")]));
    a.onerror?.({});
    a.onclose?.({});
    linkTick();
    expect(store.link).toBe("stale");
    expect(store.retryAt).toBe(Date.now() + 1000);
    vi.advanceTimersByTime(1000);
    expect(FakeWS.all).toHaveLength(2);
    last().onclose?.({});
    expect(store.retryAt).toBe(Date.now() + 2000);
    vi.advanceTimersByTime(2000);
    expect(FakeWS.all).toHaveLength(3);
    linkTick();
    expect(store.link).toBe("stale");
    const c = last();
    c.onopen?.({});
    c.send(snap([wire("a")]));
    linkTick();
    expect(store.link).toBe("live");
  });

  it("shows offline 10 s after the link drops", () => {
    connect("ws://h/ws", env);
    last().onclose?.({});
    vi.advanceTimersByTime(10_000);
    linkTick();
    expect(store.link).toBe("offline");
  });

  it("stops retrying once closed by the caller", () => {
    const stop = connect("ws://h/ws", env);
    stop();
    vi.advanceTimersByTime(30_000);
    expect(FakeWS.all).toHaveLength(1);
  });

  it("stop() while a retry is pending opens no new socket", () => {
    const stop = connect("ws://h/ws", env);
    last().onclose?.({});
    stop();
    vi.advanceTimersByTime(30_000);
    expect(FakeWS.all).toHaveLength(1);
  });

  it("backs off 1, 2, 4, 8, then stays at 8 s", () => {
    connect("ws://h/ws", env);
    for (const d of [1000, 2000, 4000, 8000, 8000]) {
      const n = FakeWS.all.length;
      last().onclose?.({});
      expect(store.retryAt).toBe(Date.now() + d);
      vi.advanceTimersByTime(d - 1);
      expect(FakeWS.all).toHaveLength(n);
      vi.advanceTimersByTime(1);
      expect(FakeWS.all).toHaveLength(n + 1);
    }
  });

  it("an http source uses EventSource and retries once per error", () => {
    class FakeES {
      static all: FakeES[] = [];
      onopen: ((e: unknown) => void) | null = null;
      onmessage: ((e: { data: unknown }) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      closed = 0;
      constructor(public url: string) { FakeES.all.push(this); }
      close() { this.closed++; }
    }
    connect("http://h/events", { ...env, EventSource: FakeES as unknown as Env["EventSource"] });
    expect(FakeWS.all).toHaveLength(0);
    expect(FakeES.all.map((e) => e.url)).toEqual(["http://h/events"]);
    const es = FakeES.all[0];
    es.onopen?.({});
    es.onmessage?.({ data: JSON.stringify(snap([wire("a")])) });
    expect([...store.sessions.keys()]).toEqual(["a"]);
    es.onerror?.({});
    es.onerror?.({});
    expect(es.closed).toBe(2);
    vi.advanceTimersByTime(1000);
    expect(FakeES.all).toHaveLength(2);
    vi.advanceTimersByTime(30_000);
    expect(FakeES.all).toHaveLength(2);
  });
});

describe("parse", () => {
  it("drops garbage and, with validation on, messages that break the wire schema", async () => {
    expect(parse("not json")).toBeNull();
    expect(parse(JSON.stringify({ type: "nope" }))).toBeNull();
    await enableValidation();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parse(JSON.stringify({ type: "session", session: { id: 1 } }))).toBeNull();
    expect(parse(JSON.stringify({ type: "hb", at: 1 }))).toEqual({ type: "hb", at: 1 });
  });
});
