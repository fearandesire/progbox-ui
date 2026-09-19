import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import * as analysisPython from "./services/analysisPython.js";
import { useIsolatedOutputs, makeRunDir, isolatedOutputsPath } from "./testUtils.js";

useIsolatedOutputs();

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "services",
  "__fixtures__",
);
const singleRunHtml = fs.readFileSync(
  path.join(fixturesDir, "analysis_dashboard.sample.html"),
  "utf8",
);
const comparisonHtml = fs.readFileSync(
  path.join(fixturesDir, "comparison_dashboard.sample.html"),
  "utf8",
);
const scorecardCsv = fs.readFileSync(
  path.join(fixturesDir, "comparison_scorecard.sample.csv"),
  "utf8",
);

const testApps: FastifyInstance[] = [];

async function buildTestApp() {
  const app = await buildApp({
    scheduleBackground: (task) => {
      void task();
    },
  });
  testApps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(testApps.map((a) => a.close()));
  testApps.length = 0;
  vi.restoreAllMocks();
});

describe("GET /api/sims/:build/analysis-data", () => {
  it("serves the extracted dashboard payload", async () => {
    const build = "20260101120000";
    makeRunDir(build, {
      metadata: { analysis_engine: "python" },
      extraFiles: { "analysis_dashboard.html": singleRunHtml },
    });
    const app = await buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: `/api/sims/${build}/analysis-data`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      engine: string;
      build: string;
      hero: { title: string };
      sections: { id: string }[];
      figures: Record<string, unknown>;
      playerExplorer: unknown;
      statCards: unknown[];
    };
    expect(body.engine).toBe("python");
    expect(body.build).toBe(build);
    expect(body.hero.title).toBe("Monte Carlo Tuning Dashboard");
    expect(body.sections.map((s) => s.id)).toEqual([
      "league-health",
      "player-explorer",
    ]);
    expect(Object.keys(body.figures)).toHaveLength(2);
    expect(body.playerExplorer).not.toBeNull();
    expect(body.statCards).toHaveLength(5);
  });

  it("404s when the dashboard HTML is missing", async () => {
    const build = "20260101120000";
    makeRunDir(build);
    const app = await buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: `/api/sims/${build}/analysis-data`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("409s a fallback-engine run", async () => {
    const build = "20260101120000";
    makeRunDir(build, {
      metadata: { analysis_engine: "fallback" },
      extraFiles: { "analysis_dashboard.html": "<html><body>plain</body></html>" },
    });
    const app = await buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: `/api/sims/${build}/analysis-data`,
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { detail: string }).detail).toContain("fallback");
  });

  it("409s python-engine HTML without markers", async () => {
    const build = "20260101120000";
    makeRunDir(build, {
      metadata: { analysis_engine: "python" },
      extraFiles: { "analysis_dashboard.html": "<html><body>no markers</body></html>" },
    });
    const app = await buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: `/api/sims/${build}/analysis-data`,
    });
    expect(res.statusCode).toBe(409);
  });

  it("422s an invalid build id", async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/sims/not-a-build/analysis-data",
    });
    expect(res.statusCode).toBe(422);
  });
});

describe("GET /api/sims/compare-data", () => {
  function mockComparisonGeneration() {
    return vi
      .spyOn(analysisPython, "runPythonComparison")
      .mockImplementation(async (_dirs: string[], cacheDir: string) => {
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(
          path.join(cacheDir, "comparison_dashboard.html"),
          comparisonHtml,
        );
        fs.writeFileSync(
          path.join(cacheDir, "comparison_scorecard.csv"),
          scorecardCsv,
        );
      });
  }

  it("serves the extracted comparison payload with the scorecard", async () => {
    makeRunDir("20260101120000");
    makeRunDir("20260102120000");
    const spy = mockComparisonGeneration();
    const app = await buildTestApp();
    const url = "/api/sims/compare-data?builds=20260102120000,20260101120000";

    const res = await app.inject({ method: "GET", url });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      engine: string;
      builds: string[];
      sections: { id: string }[];
      scorecard: { scripts: string[]; colors: string[] };
    };
    expect(body.engine).toBe("python");
    // Build metadata follows the requested artifact order.
    expect(body.builds).toEqual(["20260102120000", "20260101120000"]);
    expect(body.sections.map((s) => s.id)).toEqual(["scorecard", "age-curve"]);
    expect(body.scorecard.scripts).toHaveLength(2);
    expect(body.scorecard.colors).toEqual(["#2563eb", "#dc2626"]);

    // Repeat request hits the cache: no second Python run.
    const res2 = await app.inject({ method: "GET", url });
    expect(res2.statusCode).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("keeps HTML, chart traces and scorecard columns in requested order across caches", async () => {
    const ids = ["20260101120000", "20260102120000", "20260103120000", "20260104120000"];
    for (const id of ids) makeRunDir(id);
    const spy = vi.spyOn(analysisPython, "runPythonComparison").mockImplementation(async (dirs, cacheDir) => {
      const ordered = dirs.map((dir) => path.basename(dir));
      const html = comparisonHtml.replace(
        /(<script type="application\/json" id="payload-[12]">)(.*?)(<\/script>)/g,
        (_match, start: string, payload: string, end: string) => {
          const figure = JSON.parse(payload);
          if (start.includes("payload-1")) figure.data[0].header.values = ["Metric", ...ordered];
          else figure.data = ordered.map((name) => ({ type: "scatter", name, x: [25], y: [1] }));
          return start + JSON.stringify(figure) + end;
        },
      );
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(path.join(cacheDir, "comparison_scorecard.csv"), "Script,Players\n" + ordered.map((id) => `${id},2`).join("\n") + "\n");
      fs.writeFileSync(path.join(cacheDir, "comparison_dashboard.html"), html);
    });
    const app = await buildTestApp();
    const orders = [[ids[0], ids[1]], [ids[1], ids[0]], [ids[0], ids[1], ids[2]], [ids[0], ids[1], ids[3]], [ids[2], ids[1], ids[0]]];
    for (const ordered of orders) {
      const query = ordered.join(",");
      const response = await app.inject({ method: "GET", url: `/api/sims/compare-data?builds=${query}` });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.builds).toEqual(ordered);
      expect(body.scorecard.scripts).toEqual(ordered);
      expect(body.figures["payload-1"].data[0].header.values).toEqual(["Metric", ...ordered]);
      expect(body.figures["payload-2"].data.map((trace: { name: string }) => trace.name)).toEqual(ordered);
      const htmlResponse = await app.inject({ method: "GET", url: `/api/sims/compare?builds=${query}` });
      expect(htmlResponse.body).toContain(JSON.stringify(["Metric", ...ordered]));
    }
    expect(spy).toHaveBeenCalledTimes(orders.length);
    const concurrent = await Promise.all(orders.slice(0, 2).map((ordered) => app.inject({ method: "GET", url: `/api/sims/compare-data?builds=${ordered.join(",")}` })));
    concurrent.forEach((response, index) => expect(response.json().scorecard.scripts).toEqual(orders[index]));
    expect(spy).toHaveBeenCalledTimes(orders.length);
  });

  it("returns scorecard null for a legacy HTML-only cache", async () => {
    makeRunDir("20260101120000");
    makeRunDir("20260102120000");
    const cacheDir = path.join(
      isolatedOutputsPath(),
      "comparisons",
      "order-v2_20260101120000_20260102120000",
    );
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, "comparison_dashboard.html"), comparisonHtml);
    const generation = vi.spyOn(analysisPython, "runPythonComparison");
    const app = await buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/sims/compare-data?builds=20260101120000,20260102120000",
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { scorecard: unknown }).scorecard).toBeNull();
    expect(generation).not.toHaveBeenCalled();
  });

  it("mirrors /compare validation failures", async () => {
    makeRunDir("20260101120000");
    makeRunDir("20260103120000", { metadata: { status: "running" } });
    const app = await buildTestApp();

    const one = await app.inject({
      method: "GET",
      url: "/api/sims/compare-data?builds=20260101120000",
    });
    expect(one.statusCode).toBe(400);

    const invalid = await app.inject({
      method: "GET",
      url: "/api/sims/compare-data?builds=20260101120000,nope",
    });
    expect(invalid.statusCode).toBe(422);

    const missing = await app.inject({
      method: "GET",
      url: "/api/sims/compare-data?builds=20260101120000,20990101120000",
    });
    expect(missing.statusCode).toBe(404);

    const incomplete = await app.inject({
      method: "GET",
      url: "/api/sims/compare-data?builds=20260101120000,20260103120000",
    });
    expect(incomplete.statusCode).toBe(409);
  });

  it("500s when generation fails", async () => {
    makeRunDir("20260101120000");
    makeRunDir("20260102120000");
    vi.spyOn(analysisPython, "runPythonComparison").mockRejectedValue(
      new Error("boom"),
    );
    const app = await buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/sims/compare-data?builds=20260101120000,20260102120000",
    });
    expect(res.statusCode).toBe(500);
  });
});
