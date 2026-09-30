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
  /** Phosphor bloom around the torus. Ink on paper does not glow. */
  glow: boolean;
  /** Opacity of a torus frame one and two slots after it was drawn. */
  afterglow: readonly [number, number];
}

export interface Theme {
  dark: Palette;
  light: Palette;
}

/**
 * Named after the phosphors CRTs were coated with. Text tones clear 4.5:1 on
 * GitHub's own grounds, #0d1117 in dark mode and #ffffff in light, because
 * every image here sits on a transparent ground. Light ramps keep level 0 at
 * 2:1 and level 1 at 3:1 on white, so the quiet half of the torus still reads.
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
