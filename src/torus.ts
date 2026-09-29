import type { Profile } from "./github";

/** donut.c's luminance ramp, darkest first. */
export const RAMP = ".,-~:;=!*#$@";

export interface TorusOptions {
  cols: number;
  rows: number;
  frames: number;
  /** Width of one character cell divided by its height. */
  cellAspect: number;
}

export interface TorusFrame {
  /** Row-major, `cols * rows`: an index into RAMP, or -1 where the ray missed. */
  glyph: Int8Array;
  /** Contribution level of the calendar day under each lit cell. */
  level: Uint8Array;
}

const TAU = Math.PI * 2;
const MAJOR = 1; // ring radius
const MINOR = 0.4; // tube radius on a day with no contributions
const RELIEF = 0.08; // how far the busiest day lifts the tube
const BOUND = MAJOR + MINOR + RELIEF + 0.02;
const EYE = 6; // camera distance on +z
const HALF_VIEW = 1.74; // half the frame height, in world units at z = 0
const LIGHT = normalize([-0.45, 0.72, 0.53]); // toward the light, in view space

/**
 * Wraps the contribution calendar around a torus, one lap of weeks around the
 * ring and one lap of weekdays around the tube, pushes each day outward by its
 * count, and ray-marches the result into a looping ASCII turntable. Both ends of
 * the grid are glued: the year closes on itself.
 */
export function renderTorus(profile: Profile, options: TorusOptions): TorusFrame[] {
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

  // Bilinear across neighbouring days, eased so each day reads as a raised
  // tile with a bevelled edge rather than a smooth hill.
  const relief = (wc: number, dc: number): number => {
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

  const sdf = (x: number, y: number, z: number): number => {
    const ring = Math.hypot(x, z) - MAJOR;
    const wc = (Math.atan2(z, x) / TAU + 1) * weeks;
    const dc = (Math.atan2(y, ring) / TAU + 1) * 7;
    return Math.hypot(ring, y) - (MINOR + RELIEF * relief(wc % weeks, dc % 7));
  };

  const { cols, rows, frames, cellAspect } = options;
  const cellH = (HALF_VIEW * 2) / rows;
  const cellW = cellH * cellAspect;
  const out: TorusFrame[] = [];

  for (let f = 0; f < frames; f++) {
    const t = f / frames;
    const m = rotation(t);
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
        const disc = b * b - (ox * ox + oy * oy + oz * oz - BOUND * BOUND);
        if (disc <= 0) continue;
        let dist = -b - Math.sqrt(disc);
        const far = -b + Math.sqrt(disc);

        for (let step = 0; step < 160 && dist < far; step++) {
          const px = ox + dx * dist;
          const py = oy + dy * dist;
          const pz = oz + dz * dist;
          const d = sdf(px, py, pz);
          if (d < 1e-3) {
            const e = 1e-3;
            const nx = sdf(px + e, py, pz) - sdf(px - e, py, pz);
            const ny = sdf(px, py + e, pz) - sdf(px, py - e, pz);
            const nz = sdf(px, py, pz + e) - sdf(px, py, pz - e);
            const nl = Math.hypot(nx, ny, nz) || 1;
            // Normal back into view space, then lit like donut.c: a surface
            // turned away from the light prints nothing.
            const lx = (m[0]! * nx + m[1]! * ny + m[2]! * nz) / nl;
            const ly = (m[3]! * nx + m[4]! * ny + m[5]! * nz) / nl;
            const lz = (m[6]! * nx + m[7]! * ny + m[8]! * nz) / nl;
            const lum = lx * LIGHT[0] + ly * LIGHT[1] + lz * LIGHT[2];
            if (lum > 0) {
              const i = r * cols + c;
              glyph[i] = Math.min(RAMP.length - 1, Math.floor(lum * RAMP.length));
              const ring = Math.hypot(px, pz) - MAJOR;
              const w = mod(Math.floor((Math.atan2(pz, px) / TAU + 1) * weeks), weeks);
              const day = mod(Math.floor((Math.atan2(py, ring) / TAU + 1) * 7), 7);
              levels[i] = level[w * 7 + day]!;
            }
            break;
          }
          dist += d * 0.4;
        }
      }
    }
    out.push({ glyph, level: levels });
  }
  return out;
}

/**
 * Object-to-view rotation at loop position t in [0, 1), row-major 3x3. The
 * ring turns once about its own axis, so the year scrolls past, while the whole
 * donut tumbles once; both close at t = 1, so the loop has no seam.
 */
function rotation(t: number): Float64Array {
  const spin = -TAU * t;
  const tumble = TAU * t + 0.6;
  const roll = TAU * t;
  return multiply(multiply(rotZ(roll), rotX(tumble)), rotY(spin));
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

