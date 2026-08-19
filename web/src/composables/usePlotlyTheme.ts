import { computed, type ComputedRef, type Ref } from "vue";
import { useTheme, type Theme } from "./useTheme";
import type { PlotlyFigureJson } from "../lib/analysisTypes";

/**
 * Restyles Plotly figure layouts (generated for analysis.py's light-only
 * template) to the app's Deep Engine theme tokens. Only layout chrome is
 * touched — trace data and colors are semantic (group colors, script
 * palette, red/green deltas) and pass through untouched.
 */

interface ThemeColors {
  surface: string;
  surface2: string;
  fg: string;
  fgSoft: string;
  fgMute: string;
  line: string;
}

const LIGHT_FALLBACK: ThemeColors = {
  surface: "#ffffff",
  surface2: "#f1f5f9",
  fg: "#0f172a",
  fgSoft: "#334155",
  fgMute: "#64748b",
  line: "#e2e8f0",
};

const DARK_FALLBACK: ThemeColors = {
  surface: "#0f172a",
  surface2: "#1e293b",
  fg: "#f1f5f9",
  fgSoft: "#cbd5e1",
  fgMute: "#64748b",
  line: "#1e293b",
};

const FONT_FAMILY = '"Geist", "Inter", "Segoe UI", system-ui, sans-serif';

function readTokenColors(theme: Theme): ThemeColors {
  const fallback = theme === "dark" ? DARK_FALLBACK : LIGHT_FALLBACK;
  if (typeof window === "undefined" || !window.getComputedStyle) return fallback;
  const style = getComputedStyle(document.documentElement);
  const token = (name: string, fb: string) => style.getPropertyValue(name).trim() || fb;
  return {
    surface: token("--surface", fallback.surface),
    surface2: token("--surface-2", fallback.surface2),
    fg: token("--fg", fallback.fg),
    fgSoft: token("--fg-soft", fallback.fgSoft),
    fgMute: token("--fg-mute", fallback.fgMute),
    line: token("--line", fallback.line),
  };
}

/**
 * Dark-neutral remap for layout decorations (shapes/annotations). The
 * generated dashboards hardcode slate neutrals that vanish on a dark
 * surface; semantic colors are intentionally not in this map.
 */
const DARK_NEUTRAL_REMAP: Record<string, string> = {
  "#0f172a": "#e2e8f0",
  "#1e293b": "#cbd5e1",
  "#334155": "#94a3b8",
  "#475569": "#94a3b8",
  "#e2e8f0": "#334155",
  "#cbd5e1": "#475569",
  "#f8fafc": "#1e293b",
  "#ffffff": "#0f172a",
  "#fff": "#0f172a",
};

function remapNeutral(value: unknown, theme: Theme): unknown {
  if (theme !== "dark" || typeof value !== "string") return value;
  const mapped = DARK_NEUTRAL_REMAP[value.toLowerCase()];
  if (mapped) return mapped;
  const white = value.replace(/\s+/g, "").match(/^rgba\(255,255,255,([0-9.]+)\)$/);
  if (white) return `rgba(15,23,42,${white[1]})`;
  return value;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function themeAxis(axis: Record<string, unknown>, c: ThemeColors): Record<string, unknown> {
  const title = isRecord(axis.title) ? axis.title : {};
  const titleFont = isRecord(title.font) ? title.font : {};
  const tickfont = isRecord(axis.tickfont) ? axis.tickfont : {};
  return {
    ...axis,
    gridcolor: c.line,
    zerolinecolor: c.line,
    linecolor: c.line,
    tickfont: { ...tickfont, color: c.fgMute },
    title: { ...title, font: { ...titleFont, color: c.fgSoft } },
  };
}

function themeDecoration(dec: Record<string, unknown>, theme: Theme): Record<string, unknown> {
  const out: Record<string, unknown> = { ...dec };
  for (const key of ["bgcolor", "bordercolor"]) {
    if (key in out) out[key] = remapNeutral(out[key], theme);
  }
  if (isRecord(out.line) && "color" in out.line) {
    out.line = { ...out.line, color: remapNeutral(out.line.color, theme) };
  }
  if (isRecord(out.font) && "color" in out.font) {
    out.font = { ...out.font, color: remapNeutral(out.font.color, theme) };
  }
  return out;
}

/** Merge Deep Engine theme overrides into a Plotly layout (returns a clone). */
export function buildLayoutOverrides(
  theme: Theme,
  layout: Record<string, unknown>,
): Record<string, unknown> {
  const c = readTokenColors(theme);
  const out: Record<string, unknown> = { ...layout };

  out.paper_bgcolor = c.surface;
  out.plot_bgcolor = c.surface;
  const baseFont = isRecord(layout.font) ? layout.font : {};
  out.font = { ...baseFont, family: FONT_FAMILY, color: c.fgSoft };

  if (isRecord(layout.title)) {
    const titleFont = isRecord(layout.title.font) ? layout.title.font : {};
    out.title = { ...layout.title, font: { ...titleFont, color: c.fg } };
  }
  const legend = isRecord(layout.legend) ? layout.legend : {};
  const legendFont = isRecord(legend.font) ? legend.font : {};
  out.legend = {
    ...legend,
    bgcolor: "rgba(0,0,0,0)",
    bordercolor: c.line,
    font: { ...legendFont, color: c.fgSoft },
  };
  out.hoverlabel = {
    ...(isRecord(layout.hoverlabel) ? layout.hoverlabel : {}),
    bgcolor: c.surface2,
    bordercolor: c.line,
    font: { color: c.fg, family: FONT_FAMILY },
  };

  // Subplot figures carry xaxis2/yaxis2/...; cover every axis key.
  for (const key of Object.keys(layout)) {
    if (/^[xy]axis\d*$/.test(key) && isRecord(layout[key])) {
      out[key] = themeAxis(layout[key], c);
    }
  }

  if (Array.isArray(layout.shapes)) {
    out.shapes = layout.shapes.map((s) => (isRecord(s) ? themeDecoration(s, theme) : s));
  }
  if (Array.isArray(layout.annotations)) {
    out.annotations = layout.annotations.map((a) =>
      isRecord(a) ? themeDecoration(a, theme) : a,
    );
  }

  return out;
}

/** Reactive themed figure: re-derives the layout when the app theme flips. */
export function useThemedFigure(
  figure: Ref<PlotlyFigureJson> | ComputedRef<PlotlyFigureJson>,
): ComputedRef<PlotlyFigureJson> {
  const { theme } = useTheme();
  return computed(() => ({
    ...figure.value,
    layout: buildLayoutOverrides(theme.value, figure.value.layout ?? {}),
  }));
}
