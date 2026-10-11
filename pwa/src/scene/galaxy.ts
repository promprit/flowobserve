/** Spec §3.6 Constellation: project core + ring of chat loops. Pure; unit space (1 = loop diameter + gap; SP scales it to world). */
type GPage = { groups: { key: string; name: string; sessions: { id: string; startedAt?: number }[] }[] };
export interface Galaxy { cores: { key: string; name: string; x: number; z: number }[]; loops: { id: string; key: string; x: number; z: number }[] }

/** A loop's rim radius in units (its nodes reach ~12-14 world units from the visual centre, SP ≈ 36-42 per unit). */
export const RIM = 0.37;
/** A lone chat: its core sits this far beside the loop (short thread from the rim). */
const CORE1 = 0.56;
/** Room kept for the core point + name on the outside of a galaxy, and the gap between galaxies. */
const CORE_PAD = 0.32, GAP = 0.45;
/** Neighbouring seats at least 1 unit apart (chord 2r·sin(π/n) ≥ 1); the core keeps a short thread to every rim. */
const ringR = (n: number) => Math.max(0.75, 0.505 / Math.sin(Math.PI / n));
/** Nominal width/height of one galaxy cell, used only to pick the row count (so rows depend on the group count, not the chats). */
const CELL = 1.25;

/** Rows for n galaxies in a zone of the given aspect (w/h): the grid whose shape is closest to the zone; ties keep fewer rows. */
export function rowCount(n: number, aspect: number): number {
  if (!(aspect < Infinity) || n <= 1) return 1;
  let best = 1, score = Infinity;
  for (let r = 1; r <= n; r++) {
    const cols = Math.ceil(n / r);
    if ((r - 1) * cols >= n) continue; // would leave a row empty
    const d = Math.abs(Math.log((cols * CELL) / r / aspect));
    if (d < score - 1e-9) { score = d; best = r; }
  }
  return best;
}

/** Where the thread from a core meets its loop: on the loop's rim facing the core, never through its centre. */
export function threadEnd(c: { x: number; z: number }, l: { x: number; z: number }): { x: number; z: number } {
  const dx = c.x - l.x, dz = c.z - l.z, d = Math.hypot(dx, dz);
  if (d <= RIM) return { x: l.x, z: l.z };
  return { x: +(l.x + (dx / d) * RIM).toFixed(4), z: +(l.z + (dz / d) * RIM).toFixed(4) };
}

/** Per seats map and group: the session ids it was built for and the ring-size high-water mark (kept until the set is rebuilt). */
const hwOf = new WeakMap<Map<string, number>, Map<string, { ids: Set<string>; hw: number }>>();

/** `aspect` = the zone's width/height: groups wrap into rows to fit it (default: one row). */
export function galaxyLayout(page: GPage | undefined, seats: Map<string, number> = new Map(), aspect = Infinity): Galaxy {
  const out: Galaxy = { cores: [], loops: [] };
  if (!page?.groups.length) return out;
  const live = new Set(page.groups.flatMap((g) => g.sessions.map((s) => s.id)));
  for (const id of [...seats.keys()]) if (!live.has(id)) seats.delete(id);
  const hws = hwOf.get(seats) ?? new Map<string, { ids: Set<string>; hw: number }>(); hwOf.set(seats, hws);
  for (const k of [...hws.keys()]) if (!page.groups.some((g) => g.key === k)) hws.delete(k);
  const rows = rowCount(page.groups.length, aspect), cols = Math.ceil(page.groups.length / rows);
  // each galaxy laid out around its own origin, then packed side by side in rows (start order) and centred on 0
  const local = page.groups.map((g, gi) => {
    // keep a chat's seat unless another chat of this group already holds it (chats can join from another group)
    const used = new Set<number>(), fresh: string[] = [];
    for (const s of g.sessions) { const k = seats.get(s.id); if (k !== undefined && !used.has(k)) used.add(k); else fresh.push(s.id); }
    const at = new Map(g.sessions.map((s, i) => [s.id, s.startedAt ?? i]));
    fresh.sort((a, b) => at.get(a)! - at.get(b)!); // start order (stable: ties keep input order)
    for (const id of fresh) { let k = 0; while (used.has(k)) k++; seats.set(id, k); used.add(k); }
    // ring size keeps the highest seat so the others do not move when a chat ends
    let h = hws.get(g.key);
    if (!h || !g.sessions.some((s) => h!.ids.has(s.id))) { h = { ids: new Set(), hw: 0 }; hws.set(g.key, h); } // set rebuilt: forget the old ring size
    for (const s of g.sessions) h.ids.add(s.id);
    const n = h.hw = Math.max(h.hw, g.sessions.length, ...g.sessions.map((s) => seats.get(s.id)! + 1));
    let core = { x: 0, z: 0 }, loops: { id: string; x: number; z: number }[], ring: number[] = [0], half = RIM;
    if (n <= 1) {
      // one chat: the loop is the galaxy, its core just beside it toward the outside of the scene
      const inRow = Math.min(cols, page.groups.length - Math.floor(gi / cols) * cols), at = gi % cols;
      const side = inRow > 1 && at === inRow - 1 ? 1 : -1;
      core = { x: side * CORE1, z: 0 };
      loops = g.sessions.map((s) => ({ id: s.id, x: 0, z: 0 }));
    } else {
      const r = ringR(n), sx = (k: number) => r * Math.cos(-Math.PI / 2 + (k / n) * 2 * Math.PI);
      loops = g.sessions.map((s) => { const a = -Math.PI / 2 + (seats.get(s.id)! / n) * 2 * Math.PI; return { id: s.id, x: r * Math.cos(a), z: r * Math.sin(a) }; });
      ring = Array.from({ length: n }, (_, k) => sx(k)); // extents from every seat, so a chat ending does not shift the galaxy
      half = r + RIM;
    }
    const lo = Math.min(core.x - CORE_PAD, ...ring.map((x) => x - RIM)), hi = Math.max(core.x + CORE_PAD, ...ring.map((x) => x + RIM));
    return { g, core, loops, lo, hi, half };
  });
  const grid = Array.from({ length: rows }, (_, r) => local.slice(r * cols, (r + 1) * cols));
  const heights = grid.map((row) => 2 * Math.max(...row.map((x) => x.half)));
  let top = -(heights.reduce((a, h) => a + h, 0) + GAP * (rows - 1)) / 2;
  grid.forEach((row, r) => {
    const cz = top + heights[r] / 2;
    top += heights[r] + GAP;
    let left = -(row.reduce((a, x) => a + x.hi - x.lo, 0) + GAP * (row.length - 1)) / 2;
    for (const { g, core, loops, lo, hi } of row) {
      const cx = left - lo;
      left += hi - lo + GAP;
      out.cores.push({ key: g.key, name: g.name, x: +(cx + core.x).toFixed(4), z: +(cz + core.z).toFixed(4) });
      for (const l of loops) out.loops.push({ id: l.id, key: g.key, x: +(cx + l.x).toFixed(4), z: +(cz + l.z).toFixed(4) });
    }
  });
  return out;
}

/** The project of session `id`, at its fleet positions (portrait frames only this). The whole galaxy when id is null or unknown. */
export function projectSubset(g: Galaxy, id: string | null): Galaxy {
  const key = id ? g.loops.find((l) => l.id === id)?.key : undefined;
  if (key === undefined) return g;
  return { cores: g.cores.filter((c) => c.key === key), loops: g.loops.filter((l) => l.key === key) };
}

/** The focused project's key in portrait when known, else undefined. A loop is away iff `key !== undefined && loopKey.get(id) !== key`. */
export function awayKey(loopKey: Map<string, string>, focus: string | null, portrait: boolean): string | undefined {
  return portrait && focus ? loopKey.get(focus) : undefined;
}
