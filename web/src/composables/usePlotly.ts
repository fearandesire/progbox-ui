/**
 * Lazy loader for the Plotly cartesian partial bundle.
 *
 * The bundle covers every trace type the analysis dashboards use (scatter,
 * bar, heatmap, histogram) at a fraction of the full dist size, and the
 * dynamic import keeps it out of the main chunk — only the analysis and
 * compare pages ever pay for it.
 */

export interface PlotlyLike {
  newPlot: (
    el: HTMLElement,
    data: unknown[],
    layout?: Record<string, unknown>,
    config?: Record<string, unknown>,
  ) => Promise<unknown>;
  react: (
    el: HTMLElement,
    data: unknown[],
    layout?: Record<string, unknown>,
    config?: Record<string, unknown>,
  ) => Promise<unknown>;
  purge: (el: HTMLElement) => void;
  Plots: { resize: (el: HTMLElement) => Promise<unknown> };
}

let plotlyPromise: Promise<PlotlyLike> | null = null;

export function loadPlotly(): Promise<PlotlyLike> {
  if (!plotlyPromise) {
    plotlyPromise = import("plotly.js-cartesian-dist-min")
      .then((mod) => (mod.default ?? mod) as unknown as PlotlyLike)
      .catch((err) => {
        // Don't memoize a failure: a transient chunk-load error would
        // otherwise blank every chart for the rest of the session.
        plotlyPromise = null;
        throw err;
      });
  }
  return plotlyPromise;
}

/** Test hook: replace (or reset with null) the memoized loader. */
export function setPlotlyForTesting(stub: PlotlyLike | null): void {
  plotlyPromise = stub ? Promise.resolve(stub) : null;
}
