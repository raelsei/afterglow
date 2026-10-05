import type { Profile } from "./github";

/** donut.c's luminance ramp, darkest first. */
export const RAMP = ".,-~:;=!*#$@";

export interface ShapeOptions {
  cols: number;
  rows: number;
  frames: number;
  /** Width of one character cell divided by its height. */
  cellAspect: number;
}

export interface Frame {
  /** Row-major, `cols * rows`: an index into RAMP, or -1 where the ray missed. */
  glyph: Int8Array;
  /** Contribution level of the calendar day under each lit cell. */
  level: Uint8Array;
}

/** The calendar as a solid reads it: seven slots a week, oldest week first. */
interface Calendar {
  weeks: number;
  /** Square root of each day's count over the busiest day's, so 0 to 1. */
  height: Float64Array;
  level: Uint8Array;
}

/** A surface drawn from the calendar, in object space with y up. */
interface Solid {
  /** Radius of a sphere about the origin that holds the whole solid. */
  bound: number;
  /** Half the width and height a frame must show, in world units at z = 0. */
  half: readonly [number, number];
  /** Distance to the surface at loop position t, or less; the marcher advances `step` of it at a time. */
  distance(x: number, y: number, z: number, t: number): number;
  step: number;
  /** Contribution level at a point on the surface. */
  level(x: number, y: number, z: number): number;
  /** Object-to-view rotation at loop position t in [0, 1). It closes at t = 1, so the loop has no seam. */
  rotation(t: number): Float64Array;
  /** Toward the light, in view space, where it is not donut.c's upper left. */
  light?: readonly [number, number, number];
}

/** Every shape, with what its alt text says: `${title} made of <login>'s contributions over <period>: ${how}.` */
export const SHAPES = {
  torus: { title: "A spinning ASCII torus", how: "weeks around the ring, days around the tube, busier days raised and brighter", solid: torus },
  planet: {
    title: "A spinning ASCII planet",
    how: "weeks around the equator, days from pole to pole, each week's busiest day on the ring, busier days raised and brighter",
    solid: planet,
  },
  mobius: { title: "A spinning ASCII Möbius strip", how: "weeks along the band, days across it, one half twist, busier days raised and brighter", solid: mobius },
  coil: { title: "A spinning ASCII coil", how: "weeks along the spring end to end, days around its wire, busier days raised and brighter", solid: coil },
  twist: {
    title: "A spinning ASCII twisted ring",
    how: "weeks around the ring, a flat face a weekday, twisted so the seven faces run into one, busier days raised and brighter",
    solid: twist,
  },
  moon: { title: "A spinning ASCII moon", how: "weeks around the equator, days from pole to pole, a crater a day, busier days deeper and brighter", solid: moon },
  knot: { title: "A spinning ASCII trefoil knot", how: "weeks along the knot, days around its tube, busier days raised and brighter", solid: knot },
  flag: {
    title: "A waving ASCII flag",
    how: "weeks from left to right, days from Sunday at the top to Saturday at the bottom, busier days raised and brighter",
    solid: flag,
  },
} satisfies Record<string, { title: string; how: string; solid: (calendar: Calendar) => Solid }>;

export type Shape = keyof typeof SHAPES;

const TAU = Math.PI * 2;
const EYE = 6; // camera distance on +z
const LIGHT = normalize([-0.45, 0.72, 0.53]); // toward the light, in view space

/**
 * Ray-marches a shape made of the contribution calendar into a looping ASCII
 * turntable, shaded like donut.c: a surface turned away from the light prints
 * nothing.
 */
export function renderShape(shape: Shape, profile: Profile, options: ShapeOptions): Frame[] {
  const solid = SHAPES[shape].solid(calendar(profile));
  const { cols, rows, frames, cellAspect } = options;
  // The scale that shows the solid's whole width and height.
  const cellH = Math.max((solid.half[1] * 2) / rows, (solid.half[0] * 2) / (cols * cellAspect));
  const cellW = cellH * cellAspect;
  const light = solid.light ?? LIGHT;
  const out: Frame[] = [];

  for (let f = 0; f < frames; f++) {
    const t = f / frames;
    const m = solid.rotation(t);
    const glyph = new Int8Array(cols * rows).fill(-1);
    const levels = new Uint8Array(cols * rows);
    // Camera origin in object space: the transpose undoes the rotation.
    const ox = m[6]! * EYE;
    const oy = m[7]! * EYE;
    const oz = m[8]! * EYE;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const vx = (c + 0.5 - cols / 2) * cellW;
        const vy = (rows / 2 - r - 0.5) * cellH;
        const len = Math.hypot(vx, vy, EYE);
        const ex = vx / len;
        const ey = vy / len;
        const ez = -EYE / len;
        const dx = m[0]! * ex + m[3]! * ey + m[6]! * ez;
        const dy = m[1]! * ex + m[4]! * ey + m[7]! * ez;
        const dz = m[2]! * ex + m[5]! * ey + m[8]! * ez;

        const b = ox * dx + oy * dy + oz * dz;
        const disc = b * b - (ox * ox + oy * oy + oz * oz - solid.bound * solid.bound);
        if (disc <= 0) continue;
        let dist = -b - Math.sqrt(disc);
        const far = -b + Math.sqrt(disc);

        for (let step = 0; step < 160 && dist < far; step++) {
          const px = ox + dx * dist;
          const py = oy + dy * dist;
          const pz = oz + dz * dist;
          const d = solid.distance(px, py, pz, t);
          if (d < 1e-3) {
            const e = 1e-3;
            const nx = solid.distance(px + e, py, pz, t) - solid.distance(px - e, py, pz, t);
            const ny = solid.distance(px, py + e, pz, t) - solid.distance(px, py - e, pz, t);
            const nz = solid.distance(px, py, pz + e, t) - solid.distance(px, py, pz - e, t);
            const nl = Math.hypot(nx, ny, nz) || 1;
            // Normal back into view space, then lit like donut.c.
            const lx = (m[0]! * nx + m[1]! * ny + m[2]! * nz) / nl;
            const ly = (m[3]! * nx + m[4]! * ny + m[5]! * nz) / nl;
            const lz = (m[6]! * nx + m[7]! * ny + m[8]! * nz) / nl;
            const lum = lx * light[0] + ly * light[1] + lz * light[2];
            if (lum > 0) {
              const i = r * cols + c;
              glyph[i] = Math.min(RAMP.length - 1, Math.floor(lum * RAMP.length));
              levels[i] = solid.level(px, py, pz);
            }
            break;
          }
          dist += d * solid.step;
        }
      }
    }
    out.push({ glyph, level: levels });
  }
  return out;
}

function calendar(profile: Profile): Calendar {
  const weeks = profile.weeks.length;
  const max = Math.max(1, ...profile.weeks.flat().map((day) => day?.count ?? 0));
  const height = new Float64Array(weeks * 7);
  const level = new Uint8Array(weeks * 7);
  profile.weeks.forEach((week, w) =>
    week.forEach((day, d) => {
      height[w * 7 + d] = day ? Math.sqrt(day.count / max) : 0;
      level[w * 7 + d] = day?.level ?? 0;
    }),
  );
  return { weeks, height, level };
}

/** Height at week and day coordinates: bilinear across neighbouring days, eased
 *  so each day reads as a raised tile with a bevelled edge. Both wrap around. */
function tiles({ weeks, height }: Calendar): (wc: number, dc: number) => number {
  return (wc, dc) => {
    const x = wc - 0.5;
    const y = dc - 0.5;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = ease(x - x0);
    const ty = ease(y - y0);
    const w0 = mod(x0, weeks);
    const w1 = mod(x0 + 1, weeks);
    const d0 = mod(y0, 7);
    const d1 = mod(y0 + 1, 7);
    const top = height[w0 * 7 + d0]! + (height[w1 * 7 + d0]! - height[w0 * 7 + d0]!) * tx;
    const bottom = height[w0 * 7 + d1]! + (height[w1 * 7 + d1]! - height[w0 * 7 + d1]!) * tx;
    return top + (bottom - top) * ty;
  };
}

/** donut.c's torus: one lap of weeks around the ring, one lap of weekdays
 *  around the tube, so both ends of the year are glued and it closes on itself. */
function torus(calendar: Calendar): Solid {
  const { weeks, level } = calendar;
  const relief = tiles(calendar);
  const MAJOR = 1; // ring radius
  const MINOR = 0.4; // tube radius on a day with no contributions
  const RELIEF = 0.08; // how far the busiest day lifts the tube
  return {
    bound: MAJOR + MINOR + RELIEF + 0.02,
    half: [1.74, 1.74],
    step: 0.4,
    distance: (x, y, z) => {
      const ring = Math.hypot(x, z) - MAJOR;
      const wc = (Math.atan2(z, x) / TAU + 1) * weeks;
      const dc = (Math.atan2(y, ring) / TAU + 1) * 7;
      return Math.hypot(ring, y) - (MINOR + RELIEF * relief(wc % weeks, dc % 7));
    },
    level: (x, y, z) => {
      const ring = Math.hypot(x, z) - MAJOR;
      const w = mod(Math.floor((Math.atan2(z, x) / TAU + 1) * weeks), weeks);
      const day = mod(Math.floor((Math.atan2(y, ring) / TAU + 1) * 7), 7);
      return level[w * 7 + day]!;
    },
    // The ring turns once about its own axis, so the year scrolls past, while the whole donut tumbles once.
    rotation: (t) => multiply(multiply(rotZ(TAU * t), rotX(TAU * t + 0.6)), rotY(-TAU * t)),
  };
}

/** A ringed planet: weeks around the equator, days from Sunday at the south
 *  pole to Saturday at the north, and each week's busiest day on its arc of the ring. */
function planet(calendar: Calendar): Solid {
  const { weeks, level } = calendar;
  const relief = tiles(calendar);
  const RADIUS = 1;
  const RELIEF = 0.07;
  const INNER = 1.35; // the ring's inner edge
  const OUTER = 1.9;
  const THICK = 0.012;
  const busiest = Array.from({ length: weeks }, (_, w) => Math.max(...level.subarray(w * 7, w * 7 + 7)));
  const week = (x: number, z: number) => (Math.atan2(z, x) / TAU + 1) * weeks;
  // Held inside Sunday and Saturday, so they do not blend into each other across a pole.
  const day = (y: number, r: number) => Math.min(6.5, Math.max(0.5, (Math.asin(y / (r || 1)) / Math.PI + 0.5) * 7));
  const sphere = (x: number, y: number, z: number) => {
    const r = Math.hypot(x, y, z);
    return r - (RADIUS + RELIEF * relief(week(x, z) % weeks, day(y, r)));
  };
  const ring = (x: number, y: number, z: number) => {
    const r = Math.hypot(x, z);
    return Math.max(Math.abs(y) - THICK, INNER - r, r - OUTER);
  };
  return {
    bound: OUTER + 0.02,
    half: [2.18, 1.32],
    step: 0.5,
    distance: (x, y, z) => Math.min(sphere(x, y, z), ring(x, y, z)),
    level: (x, y, z) => {
      const w = mod(Math.floor(week(x, z)), weeks);
      if (ring(x, y, z) < sphere(x, y, z)) return busiest[w]!;
      return level[w * 7 + Math.min(6, Math.floor(day(y, Math.hypot(x, y, z))))]!;
    },
    // Spins once about its axis, tilted toward the eye so the ring opens.
    rotation: (t) => multiply(multiply(rotZ(0.32), rotX(0.38)), rotY(-TAU * t)),
  };
}

/** A Möbius strip: weeks along the band, days across it, and one half twist,
 *  so the year's last week runs into its first upside down. */
function mobius(calendar: Calendar): Solid {
  const { weeks, level } = calendar;
  const relief = tiles(calendar);
  const RADIUS = 1.1; // of the band's centre line
  const WIDTH = 0.84;
  const THICK = 0.035;
  const RELIEF = 0.07;
  // The point in the band's own frame: how far along (0 to 1), across (u) and through (v) it.
  const frame = (x: number, y: number, z: number) => {
    const along = (Math.atan2(z, x) / TAU + 1) % 1;
    const radial = Math.hypot(x, z) - RADIUS;
    const c = Math.cos(along * Math.PI);
    const s = Math.sin(along * Math.PI);
    return { along, u: radial * c + y * s, v: y * c - radial * s };
  };
  // Held inside Sunday and Saturday, so they do not blend into each other across the band's edges.
  const day = (u: number) => Math.min(6.5, Math.max(0.5, (u / WIDTH + 0.5) * 7));
  return {
    bound: RADIUS + WIDTH / 2 + 0.02,
    half: [1.74, 1.74],
    step: 0.5,
    distance: (x, y, z) => {
      const { along, u, v } = frame(x, y, z);
      const qu = Math.abs(u) - WIDTH / 2;
      const qv = Math.abs(v) - (THICK + RELIEF * relief(along * weeks, day(u)));
      return Math.hypot(Math.max(qu, 0), Math.max(qv, 0)) + Math.min(Math.max(qu, qv), 0);
    },
    level: (x, y, z) => {
      const { along, u } = frame(x, y, z);
      return level[Math.min(weeks - 1, Math.floor(along * weeks)) * 7 + Math.min(6, Math.floor(day(u)))]!;
    },
    // Turns along itself, so the year runs past, while the whole strip tumbles once.
    rotation: (t) => multiply(multiply(rotZ(TAU * t), rotX(TAU * t + 0.9)), rotY(-TAU * t)),
  };
}

/** A coiled spring: weeks along the wire from one end to the other, a turn a
 *  quarter, and days around the wire. */
function coil(calendar: Calendar): Solid {
  const { weeks, level } = calendar;
  const relief = tiles(calendar);
  const RADIUS = 0.8; // of the coil
  const PITCH = 0.55; // rise per turn
  const TURNS = 4;
  const WIRE = 0.18;
  const RELIEF = 0.06;
  const BOTTOM = (-PITCH * TURNS) / 2;
  const END = TURNS * TAU;
  // The nearest point of the wire's centre line, as its angle along the coil, and the
  // offset from it: one candidate per neighbouring turn, held to the wire's ends.
  const wire = (x: number, y: number, z: number) => {
    const angle = mod(Math.atan2(z, x), TAU);
    const turn = Math.round((y - BOTTOM) / PITCH - angle / TAU);
    let best = { along: 0, d2: Infinity, u: 0, v: 0 };
    for (let k = turn - 1; k <= turn + 1; k++) {
      const along = Math.min(END, Math.max(0, angle + TAU * k));
      const c = Math.cos(along);
      const s = Math.sin(along);
      const qx = x - RADIUS * c;
      const qy = y - (BOTTOM + (PITCH * along) / TAU);
      const qz = z - RADIUS * s;
      const d2 = qx * qx + qy * qy + qz * qz;
      if (d2 < best.d2) best = { along, d2, u: qx * c + qz * s, v: qy };
    }
    return best;
  };
  // Held inside the first and last weeks, so the ends do not blend into each other.
  const week = (along: number) => Math.min(weeks - 0.5, Math.max(0.5, (along / END) * weeks));
  const day = (u: number, v: number) => (Math.atan2(v, u) / TAU + 1) * 7;
  return {
    bound: Math.hypot(RADIUS, (PITCH * TURNS) / 2) + WIRE + RELIEF + 0.02,
    half: [1.76, 1.59],
    step: 0.5,
    distance: (x, y, z) => {
      const { along, d2, u, v } = wire(x, y, z);
      return Math.sqrt(d2) - (WIRE + RELIEF * relief(week(along), day(u, v) % 7));
    },
    level: (x, y, z) => {
      const { along, u, v } = wire(x, y, z);
      return level[Math.min(weeks - 1, Math.floor(week(along))) * 7 + (Math.floor(day(u, v)) % 7)]!;
    },
    // Spins about its own axis, so the year runs along it, laid on its side and tilted toward the eye.
    rotation: (t) => multiply(multiply(rotZ(1.2), rotX(0.35)), rotY(-TAU * t)),
  };
}

/** A ring whose tube is a heptagon, one flat face a weekday, twisted a seventh
 *  of a turn a lap so each face runs into the next and all seven are one face. */
function twist(calendar: Calendar): Solid {
  const { weeks, level } = calendar;
  const relief = tiles(calendar);
  const RADIUS = 1; // of the ring
  const APOTHEM = 0.42; // the tube's, centre to face
  const RELIEF = 0.05;
  const FACE = TAU / 7;
  // How far along the ring (0 to 1), and the point's angle and reach in the twisted cross-section.
  const frame = (x: number, y: number, z: number) => {
    const along = mod(Math.atan2(z, x) / TAU, 1);
    const radial = Math.hypot(x, z) - RADIUS;
    return { along, angle: Math.atan2(y, radial) - along * FACE, reach: Math.hypot(radial, y) };
  };
  return {
    bound: RADIUS + APOTHEM / Math.cos(Math.PI / 7) + RELIEF + 0.02,
    half: [1.74, 1.74],
    step: 0.5,
    distance: (x, y, z) => {
      const { along, angle, reach } = frame(x, y, z);
      const off = angle - Math.round(angle / FACE) * FACE;
      return reach * Math.cos(off) - (APOTHEM + RELIEF * relief(along * weeks, mod(angle / FACE + 0.5, 7)));
    },
    level: (x, y, z) => {
      const { along, angle } = frame(x, y, z);
      return level[Math.min(weeks - 1, Math.floor(along * weeks)) * 7 + mod(Math.round(angle / FACE), 7)]!;
    },
    // Turns along itself, so the year runs past, while the whole ring tumbles once.
    rotation: (t) => multiply(multiply(rotZ(TAU * t), rotX(TAU * t + 0.6)), rotY(-TAU * t)),
  };
}

/** A cratered moon lit from the side: weeks around the equator, days from
 *  Sunday at the south pole to Saturday at the north, and a crater a day, deeper the busier. */
function moon({ weeks, height, level }: Calendar): Solid {
  const RADIUS = 1;
  const DEPTH = 0.035;
  const CRATER = 0.42; // radius, in a day's cell
  // The day's cell under a point and where in it the point lies, from 0 to 1 each way.
  const cell = (x: number, y: number, z: number) => {
    const wc = mod((Math.atan2(z, x) / TAU) * weeks, weeks);
    const dc = (Math.asin(y / (Math.hypot(x, y, z) || 1)) / Math.PI + 0.5) * 7;
    const w = Math.min(weeks - 1, Math.floor(wc));
    const d = Math.min(6, Math.max(0, Math.floor(dc)));
    return { i: w * 7 + d, u: wc - w - 0.5, v: dc - d - 0.5 };
  };
  return {
    bound: RADIUS + 0.02,
    half: [1.1, 1.1],
    step: 0.6,
    distance: (x, y, z) => {
      const { i, u, v } = cell(x, y, z);
      const s = (u * u + v * v) / (CRATER * CRATER);
      return Math.hypot(x, y, z) - (RADIUS - (s < 1 ? DEPTH * height[i]! * (1 - s) * (1 - s) : 0));
    },
    level: (x, y, z) => level[cell(x, y, z).i]!,
    // Turns slowly about its axis, tipped a little toward the eye.
    rotation: (t) => multiply(multiply(rotZ(0.2), rotX(0.3)), rotY(-TAU * t)),
    light: normalize([0.95, 0.3, 0.3]),
  };
}

/** A trefoil knot: weeks along the knot, so the year closes on itself, and days around its tube. */
function knot(calendar: Calendar): Solid {
  const { weeks, level } = calendar;
  const relief = tiles(calendar);
  const RADIUS = 1; // of the torus the knot winds on
  const WIND = 0.45; // and of its tube
  const TUBE = 0.17;
  const RELIEF = 0.05;
  // The knot's centre line at s in [0, 2π): twice around the axis, three times around the torus's tube.
  const curve = (s: number) => {
    const ca = Math.cos(2 * s);
    const sa = Math.sin(2 * s);
    const cb = Math.cos(3 * s);
    const sb = Math.sin(3 * s);
    const r = RADIUS + WIND * cb;
    const dr = -3 * WIND * sb;
    return {
      p: [r * ca, WIND * sb, r * sa],
      dp: [dr * ca - 2 * r * sa, 3 * WIND * cb, dr * sa + 2 * r * ca],
      out: [cb * ca, sb, cb * sa], // from the torus's core circle to the knot
    };
  };
  // The nearest point of the centre line: the knot crosses each half-plane about the axis twice,
  // at s = (θ + 2πk) / 2, so start from both and settle each with a few Gauss-Newton steps.
  const nearest = (x: number, y: number, z: number) => {
    const theta = Math.atan2(z, x);
    let best = { s: 0, d2: Infinity };
    for (let k = 0; k < 2; k++) {
      let s = (theta + TAU * k) / 2;
      for (let i = 0; i < 3; i++) {
        const { p, dp } = curve(s);
        const g = (p[0]! - x) * dp[0]! + (p[1]! - y) * dp[1]! + (p[2]! - z) * dp[2]!;
        s -= g / (dp[0]! * dp[0]! + dp[1]! * dp[1]! + dp[2]! * dp[2]!);
      }
      const { p } = curve(s);
      const d2 = (x - p[0]!) ** 2 + (y - p[1]!) ** 2 + (z - p[2]!) ** 2;
      if (d2 < best.d2) best = { s, d2 };
    }
    return best;
  };
  // Week and day coordinates of a point near the knot.
  const coords = (x: number, y: number, z: number) => {
    const { s, d2 } = nearest(x, y, z);
    const { p, dp, out } = curve(s);
    const q = [x - p[0]!, y - p[1]!, z - p[2]!];
    // A frame across the tube that turns with the knot, so it closes when the knot does.
    const tl = Math.hypot(dp[0]!, dp[1]!, dp[2]!);
    const tn = [dp[0]! / tl, dp[1]! / tl, dp[2]! / tl];
    const along = out[0]! * tn[0]! + out[1]! * tn[1]! + out[2]! * tn[2]!;
    const n = [out[0]! - along * tn[0]!, out[1]! - along * tn[1]!, out[2]! - along * tn[2]!];
    const b = [tn[1]! * n[2]! - tn[2]! * n[1]!, tn[2]! * n[0]! - tn[0]! * n[2]!, tn[0]! * n[1]! - tn[1]! * n[0]!];
    const u = q[0]! * n[0]! + q[1]! * n[1]! + q[2]! * n[2]!;
    const v = q[0]! * b[0]! + q[1]! * b[1]! + q[2]! * b[2]!;
    return { d: Math.sqrt(d2), wc: mod((s / TAU) * weeks, weeks), dc: mod((Math.atan2(v, u) / TAU) * 7, 7) };
  };
  return {
    bound: RADIUS + WIND + TUBE + RELIEF + 0.02,
    half: [1.84, 1.77],
    step: 0.5,
    distance: (x, y, z) => {
      const { d, wc, dc } = coords(x, y, z);
      return d - (TUBE + RELIEF * relief(wc, dc));
    },
    level: (x, y, z) => {
      const { wc, dc } = coords(x, y, z);
      return level[Math.floor(wc) * 7 + Math.floor(dc)]!;
    },
    // Seen from above its axis and turning about it, so the year runs along the knot.
    rotation: (t) => multiply(rotX(1.1), rotY(-TAU * t)),
  };
}

/** The contribution graph as a banner in a travelling wave: weeks from left to
 *  right and Sunday on top, as GitHub draws it. */
function flag(calendar: Calendar): Solid {
  const { weeks, level } = calendar;
  const relief = tiles(calendar);
  const WIDTH = 1.6; // half of each
  const HEIGHT = 0.6;
  const THICK = 0.025;
  const RELIEF = 0.04;
  const SWING = 0.32; // the wave's height at the fly, the free edge; the hoist stays still
  const K = (1.5 * TAU) / (2 * WIDTH); // a wave and a half across
  // Held inside the grid, so its edges do not blend into the opposite ones.
  const week = (x: number) => Math.min(weeks - 0.5, Math.max(0.5, ((x + WIDTH) / (2 * WIDTH)) * weeks));
  const day = (y: number) => Math.min(6.5, Math.max(0.5, ((HEIGHT - y) / (2 * HEIGHT)) * 7));
  return {
    bound: Math.hypot(WIDTH, HEIGHT) + 0.05,
    half: [1.91, 0.98],
    step: 0.5,
    distance: (x, y, z, t) => {
      // The wave travels one length a loop, so it closes at t = 1.
      const from = x + WIDTH;
      const reach = SWING * (from / (2 * WIDTH));
      const phase = K * from - TAU * t;
      const slope = (SWING / (2 * WIDTH)) * Math.sin(phase) + reach * K * Math.cos(phase);
      const sheet = Math.abs(z - reach * Math.sin(phase)) / Math.sqrt(1 + slope * slope) - (THICK + RELIEF * relief(week(x), day(y)));
      return Math.max(sheet, Math.abs(x) - WIDTH, Math.abs(y) - HEIGHT);
    },
    level: (x, y) => level[Math.floor(week(x)) * 7 + Math.floor(day(y))]!,
    // Turned a little away, so the wave shows its depth.
    rotation: () => multiply(rotX(0.3), rotY(-0.3)),
    // Lit nearly head on: a flat banner under donut.c's light reads dim, and the wave's slopes carry the shading.
    light: normalize([-0.4, 0.35, 0.85]),
  };
}

function rotX(a: number): Float64Array {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return Float64Array.of(1, 0, 0, 0, c, -s, 0, s, c);
}

function rotY(a: number): Float64Array {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return Float64Array.of(c, 0, s, 0, 1, 0, -s, 0, c);
}

function rotZ(a: number): Float64Array {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return Float64Array.of(c, -s, 0, s, c, 0, 0, 0, 1);
}

function multiply(a: Float64Array, b: Float64Array): Float64Array {
  const out = new Float64Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) out[i * 3 + j] = a[i * 3]! * b[j]! + a[i * 3 + 1]! * b[3 + j]! + a[i * 3 + 2]! * b[6 + j]!;
  return out;
}

function normalize(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Smoothstep: flattens the middle of a tile and steepens its edge. */
function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}
