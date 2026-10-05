/** What the `effects` input may name. */
export const EFFECTS = ["crt", "typing"] as const;
export type Effect = (typeof EFFECTS)[number];

export interface Palette {
  fg: string;
  muted: string;
  accent: string;
  /** Pane borders: structure, not text. */
  border: string;
  /** Text on an accent fill: the status bar. */
  onAccent: string;
  /** Ink for contribution levels 0 to 4, as GitHub buckets them. */
  levels: readonly [string, string, string, string, string];
  /** Phosphor bloom around the year's shape. Ink on paper does not glow. */
  glow: boolean;
  /** Opacity of a year frame one and two slots after it was drawn. */
  afterglow: readonly [number, number];
  /** Opt-in motion from the `effects` input, carried here because every image is drawn from a palette. */
  effects?: ReadonlySet<Effect>;
}

export interface Theme {
  dark: Palette;
  light: Palette;
}

/**
 * Named after the phosphors CRTs were coated with. Text tones clear 4.5:1 on
 * GitHub's own grounds, #0d1117 in dark mode and #ffffff in light, because
 * every image here sits on a transparent ground. Light ramps keep level 0 at
 * 2:1 and level 1 at 3:1 on white, so the quiet half of the year still reads.
 */
export const THEMES: Record<string, Theme> = {
  // P1 green, in koray.dev's Phosphor palette.
  phosphor: {
    dark: {
      fg: "#d9dedb",
      muted: "#8f9c97",
      accent: "#b6ff3d",
      border: "#34403b",
      onAccent: "#08090a",
      levels: ["#55605b", "#6f9a2a", "#94cf36", "#b6ff3d", "#eaffc4"],
      glow: true,
      afterglow: [0.3, 0.12],
    },
    light: {
      fg: "#171c1a",
      muted: "#5c6662",
      accent: "#4c7100",
      border: "#c9d2ce",
      onAccent: "#ffffff",
      levels: ["#a9b4af", "#7c9a3e", "#5e861a", "#4c7100", "#263a00"],
      glow: false,
      afterglow: [0.18, 0.07],
    },
  },
  // P3 amber: the warm monochrome terminals.
  amber: {
    dark: {
      fg: "#eadfcf",
      muted: "#a39580",
      accent: "#ffb000",
      border: "#3d3528",
      onAccent: "#0d0a05",
      levels: ["#5b5246", "#8a6212", "#c28a10", "#ffb000", "#ffe0a0"],
      glow: true,
      afterglow: [0.3, 0.12],
    },
    light: {
      fg: "#1f1a13",
      muted: "#6b5e4c",
      accent: "#8f5b00",
      border: "#ddd3c4",
      onAccent: "#ffffff",
      levels: ["#b9ab97", "#b0831a", "#9c6a00", "#8f5b00", "#4d3000"],
      glow: false,
      afterglow: [0.18, 0.07],
    },
  },
  // P4 blue-white: the radar and oscilloscope screens.
  ice: {
    dark: {
      fg: "#dce6ec",
      muted: "#8c9ca6",
      accent: "#7cd4ff",
      border: "#2e3a42",
      onAccent: "#06121a",
      levels: ["#4d5a63", "#2c5f7a", "#3f94bf", "#7cd4ff", "#d4f1ff"],
      glow: true,
      afterglow: [0.3, 0.12],
    },
    light: {
      fg: "#14202a",
      muted: "#56656f",
      accent: "#075985",
      border: "#cbd6dd",
      onAccent: "#ffffff",
      levels: ["#a8b6bf", "#4a93bb", "#2f7aa6", "#075985", "#04324b"],
      glow: false,
      afterglow: [0.18, 0.07],
    },
  },
  // GitHub's own contribution greens.
  github: {
    dark: {
      fg: "#d1d9e0",
      muted: "#9198a1",
      accent: "#3fb950",
      border: "#3d444d",
      onAccent: "#0d1117",
      levels: ["#3d444d", "#0e4429", "#006d32", "#26a641", "#39d353"],
      glow: true,
      afterglow: [0.3, 0.12],
    },
    light: {
      fg: "#1f2328",
      muted: "#59636e",
      accent: "#1a7f37",
      border: "#d1d9e0",
      onAccent: "#ffffff",
      levels: ["#aeb8c2", "#3f9f55", "#2c8a43", "#1a7f37", "#0f5323"],
      glow: false,
      afterglow: [0.18, 0.07],
    },
  },
};

/** GitHub's page grounds: every image here is transparent and sits on one. */
const GROUND = { dark: "#0d1117", light: "#ffffff" } as const;

/**
 * A theme with its accent swapped for `hex` and the contribution ramp rebuilt
 * around it. The accent is lightened or darkened until it reads at 4.5:1 on
 * GitHub's ground in each mode, the bar the built-in themes clear.
 */
export function withAccent(theme: Theme, hex: string): Theme {
  return { dark: accented(theme.dark, hex, "dark"), light: accented(theme.light, hex, "light") };
}

function accented(palette: Palette, hex: string, mode: "dark" | "light"): Palette {
  const ground = GROUND[mode];
  const away = mode === "dark" ? "#ffffff" : "#000000"; // the way contrast grows
  const accent = readable(hex, ground, away, 4.5);
  const [base] = palette.levels;
  return {
    ...palette,
    accent,
    onAccent: contrast(accent, "#000000") >= contrast(accent, "#ffffff") ? "#000000" : "#ffffff",
    // Shaped like the built-in ramps: level 3 is the accent, level 4 one step past it.
    levels:
      mode === "dark"
        ? [base, mix(base, accent, 0.5), mix(base, accent, 0.75), accent, mix(accent, "#ffffff", 0.65)]
        : [base, readable(mix(accent, "#ffffff", 0.35), ground, away, 3), mix(accent, "#ffffff", 0.15), accent, mix(accent, "#000000", 0.5)],
  };
}

/** `hex` moved toward `away` until it reads at `ratio` on `ground`. */
function readable(hex: string, ground: string, away: string, ratio: number): string {
  let color = hex;
  for (let step = 1; contrast(color, ground) < ratio && step <= 20; step++) color = mix(hex, away, step / 20);
  return color;
}

/** WCAG contrast ratio of two `#rrggbb` colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = rgb(hex).map((v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function mix(a: string, b: string, t: number): string {
  const from = rgb(a);
  const to = rgb(b);
  return `#${from.map((v, i) => Math.round(v + (to[i]! - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}
