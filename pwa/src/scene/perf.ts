/** Frame budget probe (spec §2): the last 240 rendered frames, CPU and GPU milliseconds. Read by __fo.perf() and the bloom gate. */
export const RING = 240;
export const MAX_IN_FLIGHT = 4;

export class Ring {
  private buf = new Float64Array(RING);
  private n = 0;
  private i = 0;
  push(v: number): void { this.buf[this.i] = v; this.i = (this.i + 1) % RING; if (this.n < RING) this.n++; }
  get size(): number { return this.n; }
  values(): number[] { return Array.from(this.buf.subarray(0, this.n)); }
  clear(): void { this.n = 0; this.i = 0; }
}

/** Nearest-rank percentile (p in 0-100); null for no samples. */
export function pct(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

/** bloomDead: the bloom gate gave up for this page (world.ts copies gate.dead) — a baseline is only comparable with it. */
export const perf = { cpu: new Ring(), gpu: new Ring(), bloomDead: false, capMs: 0 };
export interface PerfStats { frames: number; cpuP50: number | null; cpuP95: number | null; gpuP50: number | null; gpuP95: number | null; bloomDead: boolean; capMs: number }
export function stats(): PerfStats {
  const c = perf.cpu.values(), g = perf.gpu.values();
  return { frames: perf.cpu.size, cpuP50: pct(c, 50), cpuP95: pct(c, 95), gpuP50: pct(g, 50), gpuP95: pct(g, 95), bloomDead: perf.bloomDead, capMs: perf.capMs };
}

interface TimerExt { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }
export type GL2 = Pick<WebGL2RenderingContext, "getExtension" | "createQuery" | "deleteQuery" | "beginQuery" | "endQuery" | "getQueryParameter" | "getParameter" | "QUERY_RESULT" | "QUERY_RESULT_AVAILABLE">;

/** GPU time of a render via EXT_disjoint_timer_query_webgl2. Results arrive frames later; poll() drains them in order. */
export class GpuTimer {
  private ext: TimerExt | null;
  private pending: WebGLQuery[] = [];
  private cur: WebGLQuery | null = null;
  constructor(private gl: GL2 | null) {
    this.ext = gl ? (gl.getExtension("EXT_disjoint_timer_query_webgl2") as TimerExt | null) : null;
  }
  get ok(): boolean { return !!this.ext; }
  begin(): boolean {
    if (!this.gl || !this.ext || this.cur || this.pending.length >= MAX_IN_FLIGHT) return false;
    const q = this.gl.createQuery();
    if (!q) return false;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.cur = q;
    return true;
  }
  end(): void {
    if (!this.gl || !this.ext || !this.cur) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.cur);
    this.cur = null;
  }
  /** Runs fn between begin and end; if fn throws the query is still ended, then the error propagates. `began` is begin()'s result. */
  around(began: boolean, fn: () => void): void {
    try { fn(); } finally { if (began) this.end(); }
  }
  /** Newly resolved GPU times in ms, oldest first. A disjoint event (GPU clock reset) drops every pending result. */
  poll(): number[] {
    const gl = this.gl, ext = this.ext, out: number[] = [];
    if (!gl || !ext || !this.pending.length) return out;
    const disjoint = !!gl.getParameter(ext.GPU_DISJOINT_EXT);
    while (this.pending.length) {
      const q = this.pending[0];
      if (!disjoint && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      this.pending.shift();
      if (!disjoint) out.push(Number(gl.getQueryParameter(q, gl.QUERY_RESULT)) / 1e6);
      gl.deleteQuery(q);
    }
    return out;
  }
}
