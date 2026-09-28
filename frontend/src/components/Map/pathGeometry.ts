/**
 * Minimal SVG path geometry for edge rendering.
 *
 * Handles the absolute M / L / Q / C commands produced by @xyflow/react's
 * getStraightPath / getSmoothStepPath / getBezierPath and by our own waypoint
 * builders, so the edge can place labels, orient arrows and split the in/out
 * colours along the path that is actually drawn (not the straight
 * source→target chord). Pure functions: no DOM measurement, correct on the
 * first render.
 */

export type Pt = { x: number; y: number };

type Seg =
  | { kind: "L"; p0: Pt; p1: Pt }
  | { kind: "Q"; p0: Pt; c: Pt; p1: Pt }
  | { kind: "C"; p0: Pt; c1: Pt; c2: Pt; p1: Pt };

interface MeasuredSeg {
  seg: Seg;
  /** Arc-length lookup: ts[i] ↔ cum[i] (cum[0] = 0, cum[last] = segment length). */
  ts: number[];
  cum: number[];
  length: number;
}

export interface PathGeometry {
  total: number;
  pointAt: (frac: number) => Pt;
  /** Unit tangent (direction of travel source → target) at the given length fraction. */
  tangentAt: (frac: number) => Pt;
  /** Split the path at a length fraction into two path strings. */
  splitAt: (frac: number) => [string, string];
}

const TOKEN_RE = /[MLQCmlqc]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
const CURVE_SAMPLES = 32;

const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);

function parse(d: string): Seg[] | null {
  const tokens = d.match(TOKEN_RE);
  if (!tokens) return null;
  const segs: Seg[] = [];
  let cur: Pt | null = null;
  let i = 0;
  const num = (): number | null => {
    const t = tokens[i];
    if (t === undefined || /^[A-Za-z]$/.test(t)) return null;
    i++;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };
  const pt = (): Pt | null => {
    const x = num();
    const y = num();
    return x === null || y === null ? null : { x, y };
  };
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd === "M") {
      const p = pt();
      if (!p || segs.length > 0) return null; // single sub-path only
      cur = p;
    } else if (cmd === "L" && cur) {
      const p1 = pt();
      if (!p1) return null;
      segs.push({ kind: "L", p0: cur, p1 });
      cur = p1;
    } else if (cmd === "Q" && cur) {
      const c = pt();
      const p1 = pt();
      if (!c || !p1) return null;
      segs.push({ kind: "Q", p0: cur, c, p1 });
      cur = p1;
    } else if (cmd === "C" && cur) {
      const c1 = pt();
      const c2 = pt();
      const p1 = pt();
      if (!c1 || !c2 || !p1) return null;
      segs.push({ kind: "C", p0: cur, c1, c2, p1 });
      cur = p1;
    } else {
      // Relative commands / implicit repeats aren't produced by our builders.
      return null;
    }
  }
  return segs.length ? segs : null;
}

function evalSeg(s: Seg, t: number): Pt {
  if (s.kind === "L") return lerp(s.p0, s.p1, t);
  if (s.kind === "Q") return lerp(lerp(s.p0, s.c, t), lerp(s.c, s.p1, t), t);
  const a = lerp(s.p0, s.c1, t);
  const b = lerp(s.c1, s.c2, t);
  const c = lerp(s.c2, s.p1, t);
  return lerp(lerp(a, b, t), lerp(b, c, t), t);
}

function derivSeg(s: Seg, t: number): Pt {
  if (s.kind === "L") return { x: s.p1.x - s.p0.x, y: s.p1.y - s.p0.y };
  if (s.kind === "Q") {
    const a = lerp(s.p0, s.c, t);
    const b = lerp(s.c, s.p1, t);
    return { x: 2 * (b.x - a.x), y: 2 * (b.y - a.y) };
  }
  const a = lerp(s.p0, s.c1, t);
  const b = lerp(s.c1, s.c2, t);
  const c = lerp(s.c2, s.p1, t);
  const ab = lerp(a, b, t);
  const bc = lerp(b, c, t);
  return { x: 3 * (bc.x - ab.x), y: 3 * (bc.y - ab.y) };
}

/** De Casteljau split of a segment at parameter t. */
function splitSeg(s: Seg, t: number): [Seg, Seg] {
  if (s.kind === "L") {
    const m = lerp(s.p0, s.p1, t);
    return [{ kind: "L", p0: s.p0, p1: m }, { kind: "L", p0: m, p1: s.p1 }];
  }
  if (s.kind === "Q") {
    const a = lerp(s.p0, s.c, t);
    const b = lerp(s.c, s.p1, t);
    const m = lerp(a, b, t);
    return [{ kind: "Q", p0: s.p0, c: a, p1: m }, { kind: "Q", p0: m, c: b, p1: s.p1 }];
  }
  const a = lerp(s.p0, s.c1, t);
  const b = lerp(s.c1, s.c2, t);
  const c = lerp(s.c2, s.p1, t);
  const ab = lerp(a, b, t);
  const bc = lerp(b, c, t);
  const m = lerp(ab, bc, t);
  return [
    { kind: "C", p0: s.p0, c1: a, c2: ab, p1: m },
    { kind: "C", p0: m, c1: bc, c2: c, p1: s.p1 },
  ];
}

function measure(seg: Seg): MeasuredSeg {
  if (seg.kind === "L") {
    const length = dist(seg.p0, seg.p1);
    return { seg, ts: [0, 1], cum: [0, length], length };
  }
  const ts = [0];
  const cum = [0];
  let prev = seg.p0;
  let acc = 0;
  for (let k = 1; k <= CURVE_SAMPLES; k++) {
    const t = k / CURVE_SAMPLES;
    const p = evalSeg(seg, t);
    acc += dist(prev, p);
    ts.push(t);
    cum.push(acc);
    prev = p;
  }
  return { seg, ts, cum, length: acc };
}

const fmt = (n: number) => Number(n.toFixed(3));

function segsToD(segs: Seg[]): string {
  if (!segs.length) return "";
  let d = `M ${fmt(segs[0].p0.x)},${fmt(segs[0].p0.y)}`;
  for (const s of segs) {
    if (s.kind === "L") d += ` L ${fmt(s.p1.x)},${fmt(s.p1.y)}`;
    else if (s.kind === "Q") d += ` Q ${fmt(s.c.x)},${fmt(s.c.y)} ${fmt(s.p1.x)},${fmt(s.p1.y)}`;
    else d += ` C ${fmt(s.c1.x)},${fmt(s.c1.y)} ${fmt(s.c2.x)},${fmt(s.c2.y)} ${fmt(s.p1.x)},${fmt(s.p1.y)}`;
  }
  return d;
}

/** Parse and measure a path. Returns null for unsupported or zero-length paths. */
export function analyzePath(d: string): PathGeometry | null {
  const segs = parse(d);
  if (!segs) return null;
  const measured = segs.map(measure);
  const total = measured.reduce((acc, m) => acc + m.length, 0);
  if (!(total > 0)) return null;

  /** Locate (segment index, parameter t) for a length fraction. */
  const locate = (frac: number): { idx: number; t: number } => {
    let target = Math.min(Math.max(frac, 0), 1) * total;
    for (let idx = 0; idx < measured.length; idx++) {
      const m = measured[idx];
      if (target <= m.length || idx === measured.length - 1) {
        if (m.length === 0) return { idx, t: 0 };
        target = Math.min(target, m.length);
        for (let k = 1; k < m.cum.length; k++) {
          if (target <= m.cum[k]) {
            const span = m.cum[k] - m.cum[k - 1] || 1;
            const local = (target - m.cum[k - 1]) / span;
            return { idx, t: m.ts[k - 1] + (m.ts[k] - m.ts[k - 1]) * local };
          }
        }
        return { idx, t: 1 };
      }
      target -= m.length;
    }
    return { idx: measured.length - 1, t: 1 };
  };

  const pointAt = (frac: number): Pt => {
    const { idx, t } = locate(frac);
    return evalSeg(measured[idx].seg, t);
  };

  const tangentAt = (frac: number): Pt => {
    const { idx, t } = locate(frac);
    const s = measured[idx].seg;
    let v = derivSeg(s, t);
    // Degenerate derivative (e.g. control point == end point): use the chord.
    if (Math.hypot(v.x, v.y) < 1e-9) v = { x: s.p1.x - s.p0.x, y: s.p1.y - s.p0.y };
    const len = Math.hypot(v.x, v.y);
    return len > 0 ? { x: v.x / len, y: v.y / len } : { x: 1, y: 0 };
  };

  const splitAt = (frac: number): [string, string] => {
    const { idx, t } = locate(frac);
    const [a, b] = splitSeg(measured[idx].seg, t);
    const first = [...segs.slice(0, idx), a];
    const second = [b, ...segs.slice(idx + 1)];
    return [segsToD(first), segsToD(second)];
  };

  return { total, pointAt, tangentAt, splitAt };
}
