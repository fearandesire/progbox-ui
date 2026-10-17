import fs from "node:fs";
import path from "node:path";

/**
 * A self-contained, data-only HTML page for one saved run: charts with axis titles and units,
 * the checks and KPI tables, and the run details. No verdicts or summary prose, so the page reads
 * the same for any script, baseline or future Lab version. `pnpm lab export-html <runId>`.
 */

type Stat = { mean: number; se: number };
type Season = { season: number } & Record<string, Stat | number>;
type Side = { seasons: Season[]; ageCurve?: Record<string, number>; ageCurveSe?: Record<string, number> };
type AgeBand = { n: number; meanDelta: number; se: number };
type Kpis = Record<string, unknown> & { deltaByAge?: Record<string, AgeBand> };
type CheckSide = { display: string; pass: boolean | null } | null;
type CheckItem = {
  name: string;
  unit: string;
  rule: string;
  basis: string;
  script: CheckSide;
  baseline: CheckSide;
  noScript: { display: string } | null;
};
type Point = { mean: number; se: number } | null;
type Chart = { title: string; yTitle: string; note: string; x: string[]; series: Record<"script" | "baseline" | "noScript", Point[] | null> };
export type ExportableReport = {
  mode: string;
  lab: { version: string; commit?: string | null; checks: { version: number; rulesSha256: string }; statgen?: string | null };
  runDetails: Record<string, unknown> & { scripts?: { id: string; sha256: string }[]; pre?: { id: string; sha256: string } | null };
  league: { id: string; name: string; credit?: string };
  script: { id: string; kpis: Kpis };
  baseline?: { id: string; kpis: Kpis } | null;
  checks?: { items: CheckItem[] } | null;
  deep?: { start?: Record<string, number>; script: Side; baseline?: Side | null; noScript?: Side | null } | null;
};

const BASIS: Record<string, string> = {
  "multi-season": "every offseason of the run",
  "file-stats": "the file's own stats, many seeds",
  "simulated-season": "NET's run after one simulated season",
};

/** Charts drawn from `deep.*.seasons`: key, title, y-axis title, one-line definition. */
const SEASON_CHARTS = [
  ["leagueMeanOvr", "League average OVR", "OVR", "Mean OVR of every rostered player after that offseason's NET run."],
  ["count75", "Players at 75+ OVR", "Players", "Rostered players at 75 OVR or higher after NET."],
  ["count80", "Players at 80+ OVR", "Players", "Rostered players at 80 OVR or higher after NET."],
  ["maxOvr", "Best player OVR", "OVR", "Highest OVR in the league after NET."],
  ["god", "God progs per offseason", "God progs", "Players with at least 11 of 14 non-height ratings up 7 or more in one offseason."],
  ["meanDelta", "Mean OVR change from NET", "ΔOVR per player", "Average OVR change NET applied that offseason, all progressed players."],
] as const;

const KPI_ROWS: [string, string, (v: number) => string][] = [
  ["progressedPerRun", "Players progressed per offseason", (v) => v.toFixed(0)],
  ["meanDelta", "Mean ΔOVR", (v) => signed(v, 2)],
  ["sdDelta", "ΔOVR SD (all player-runs)", (v) => v.toFixed(2)],
  ["medianPlayerSd", "Median per-player SD of ΔOVR", (v) => v.toFixed(2)],
  ["pctPositive", "Share of progs above 0", (v) => `${(v * 100).toFixed(0)}%`],
  ["pctNegative", "Share of progs below 0", (v) => `${(v * 100).toFixed(0)}%`],
  ["godProgsPerRun", "God progs per offseason", (v) => v.toFixed(2)],
  ["p99OvrAfter", "99th percentile OVR after", (v) => v.toFixed(1)],
  ["perEffect", "PER effect (ΔOVR per 1 SD of PER)", (v) => signed(v, 2)],
  ["bpmEffect", "BPM effect (ΔOVR per 1 SD of BPM)", (v) => signed(v, 2)],
];

function signed(v: number, digits: number): string {
  const s = Math.abs(v).toFixed(digits);
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s;
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function series(side: Side | null | undefined, key: string, start: number | undefined): Point[] | null {
  if (!side?.seasons?.length) return null;
  const pts = side.seasons.map((s) => {
    const v = s[key] as Stat | undefined;
    return v ? { mean: v.mean, se: v.se } : null;
  });
  return start === undefined ? pts : [{ mean: start, se: 0 }, ...pts];
}

function bandSeries(k: Kpis | undefined, bands: string[]): Point[] | null {
  const by = k?.deltaByAge;
  return by ? bands.map((b) => (by[b] ? { mean: by[b].meanDelta, se: by[b].se } : null)) : null;
}

function curveSeries(side: Side | null | undefined, bands: string[]): Point[] | null {
  const c = side?.ageCurve;
  return c ? bands.map((b) => (c[b] === undefined ? null : { mean: c[b], se: side?.ageCurveSe?.[b] ?? 0 })) : null;
}

export function buildChartData(report: ExportableReport) {
  const deep = report.deep;
  const names = { script: report.script.id, baseline: report.baseline?.id ?? null, noScript: deep?.noScript ? "No script" : null };
  const seasonCharts: Chart[] = !deep
    ? []
    : SEASON_CHARTS.map(([key, title, yTitle, note]) => {
        const start = deep.start?.[key];
        const years = deep.script.seasons.map((s) => String(s.season));
        return {
          title,
          yTitle,
          note,
          x: start === undefined ? years : ["Start", ...years],
          series: {
            script: series(deep.script, key, start),
            baseline: series(deep.baseline, key, start),
            noScript: key === "meanDelta" || key === "god" ? null : series(deep.noScript, key, start),
          },
        };
      });
  const ageCharts: Chart[] = [];
  if (deep?.script.ageCurve) {
    const bands = Object.keys(deep.script.ageCurve);
    ageCharts.push({
      title: "Mean OVR change by age, all seasons",
      yTitle: "ΔOVR per player per offseason",
      note: "Average OVR change NET applied, by the player's age that offseason, pooled over every season of the run.",
      x: bands,
      series: { script: curveSeries(deep.script, bands), baseline: curveSeries(deep.baseline, bands), noScript: null },
    });
  }
  if (report.script.kpis.deltaByAge) {
    const bands = Object.keys(report.script.kpis.deltaByAge);
    ageCharts.push({
      title: "Mean OVR change by age, first offseason",
      yTitle: "ΔOVR per player",
      note: "One NET run on the file's own stats, repeated over many seeds.",
      x: bands,
      series: { script: bandSeries(report.script.kpis, bands), baseline: bandSeries(report.baseline?.kpis, bands), noScript: null },
    });
  }
  return { names, seasonCharts, ageCharts };
}

function checksTable(report: ExportableReport): string {
  const items = report.checks?.items ?? [];
  if (!items.length) return "";
  const mark = (p: boolean | null) => (p === true ? "✓ " : p === false ? "✗ " : "");
  const cls = (p: boolean | null) => (p === true ? " pass" : p === false ? " fail" : "");
  const cell = (c: CheckSide) => (c ? `<td class="num${cls(c.pass)}">${mark(c.pass)}${esc(c.display)}</td>` : "<td>n/a</td>");
  const base = !!report.baseline;
  const none = items.some((i) => i.noScript);
  const head = `<tr><th>Check</th><th>Unit</th><th>Passes when</th><th>Data</th><th>${esc(report.script.id)}</th>${base ? `<th>${esc(report.baseline!.id)}</th>` : ""}${none ? "<th>No script</th>" : ""}</tr>`;
  const rows = items
    .map(
      (i) =>
        `<tr><td>${esc(i.name)}</td><td>${esc(i.unit)}</td><td>${esc(i.rule)}</td><td>${esc(BASIS[i.basis] ?? i.basis)}</td>${cell(i.script)}${base ? cell(i.baseline) : ""}${none ? `<td class="num">${esc(i.noScript?.display ?? "n/a")}</td>` : ""}</tr>`,
    )
    .join("");
  return `<h2>Checks</h2>
<div class="tablewrap"><table><thead>${head}</thead><tbody>${rows}</tbody></table></div>
<p class="note">✓ meets the rule, ✗ does not. Gaps under 2 standard errors count as ties. Rules: lab/src/verdict.ts.</p>`;
}

function kpiTable(report: ExportableReport): string {
  const k = report.script.kpis;
  const b = report.baseline?.kpis;
  const rows = KPI_ROWS.filter(([key]) => typeof k[key] === "number");
  if (!rows.length) return "";
  const body = rows
    .map(
      ([key, label, f]) =>
        `<tr><td>${esc(label)}</td><td class="num">${f(k[key] as number)}</td>${b ? `<td class="num">${typeof b[key] === "number" ? f(b[key] as number) : "n/a"}</td>` : ""}</tr>`,
    )
    .join("");
  return `<h2>First offseason</h2>
<p class="note">One NET run on the file's own stats, repeated over ${esc(k.runs)} seeds.</p>
<div class="tablewrap"><table><thead><tr><th>Measure</th><th>${esc(report.script.id)}</th>${b ? `<th>${esc(report.baseline!.id)}</th>` : ""}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function detailsTable(report: ExportableReport): string {
  const d = report.runDetails;
  const rows: [string, unknown][] = [
    ["League", `${report.league.name}${report.league.credit ? ` (${report.league.credit})` : ""}`],
    ["NET runs", d.netRuns],
    ["Games simulated", d.gamesSimulated === undefined ? undefined : d.gamesSimulated ? "Yes (StatGen, fit to BBGM output)" : "No"],
    ["Stats NET read", d.statsRead],
    ["Runs", d.runs],
    ["Seed", d.seed],
    ["Scripts", (d.scripts ?? []).map((s) => `${s.id} (${s.sha256.slice(0, 8)})`).join(", ")],
    ["Pre-progs hook", d.pre ? `${d.pre.id} (${d.pre.sha256.slice(0, 8)})` : "none"],
    ["NET Lab", `${report.lab.version}${report.lab.commit ? `, commit ${report.lab.commit}` : ""}`],
    ["Checks", `v${report.lab.checks.version}, rules ${report.lab.checks.rulesSha256.slice(0, 8)}`],
    ["StatGen", report.lab.statgen ?? "n/a"],
  ];
  const body = rows
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`)
    .join("");
  return `<h2>Run details</h2><div class="tablewrap"><table><tbody>${body}</tbody></table></div>`;
}

const CSS = `:root{color-scheme:light;--bg:#fcfcfb;--panel:#f3f2ee;--line:#e2e0d9;--ink:#0b0b0b;--ink-2:#52514e;--ink-3:#7a7974;--script:#2a78d6;--baseline:#eb6834;--noScript:#9a9891;--good:#1d7a3a;--bad:#b8322f}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;--bg:#1a1a19;--panel:#242422;--line:#3a3936;--ink:#f0efec;--ink-2:#c3c2b7;--ink-3:#96958c;--script:#3987e5;--baseline:#d95926;--noScript:#807f78;--good:#5cc27a;--bad:#e66767}}
:root[data-theme="dark"]{color-scheme:dark;--bg:#1a1a19;--panel:#242422;--line:#3a3936;--ink:#f0efec;--ink-2:#c3c2b7;--ink-3:#96958c;--script:#3987e5;--baseline:#d95926;--noScript:#807f78;--good:#5cc27a;--bad:#e66767}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1200px;margin:0 auto;padding:32px 16px 56px}h1{font-size:26px;margin:0 0 4px}h2{font-size:19px;margin:40px 0 10px}
.meta,.note{color:var(--ink-3);font-size:13px;margin:4px 0 10px}a{color:var(--script)}
.legend{display:flex;gap:18px;flex-wrap:wrap;font-size:14px;color:var(--ink-2);margin:6px 0 12px}
.legend span::before{content:"";display:inline-block;width:16px;height:3px;border-radius:2px;margin-right:6px;vertical-align:middle;background:var(--c)}
.charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(460px,1fr));gap:16px}
@media (max-width:520px){.charts{grid-template-columns:1fr}}
figure{margin:0;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px 14px 10px}
figure h3{margin:0;font-size:15px}figure .note{margin:2px 0 6px}
svg{width:100%;height:auto;display:block;overflow:visible}svg text{fill:var(--ink-3);font-size:11px}svg text.axis{fill:var(--ink-2);font-size:12px}
.tablewrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--ink-3);font-weight:600;font-size:13px}td.num{font-variant-numeric:tabular-nums;white-space:nowrap}.pass{color:var(--good)}.fail{color:var(--bad)}
.tip{position:fixed;pointer-events:none;background:var(--ink);color:var(--bg);font-size:13px;padding:6px 9px;border-radius:6px;opacity:0;white-space:nowrap;z-index:5}
footer{margin-top:48px;font-size:13px;color:var(--ink-3);border-top:1px solid var(--line);padding-top:14px}`;

/** Draws every chart from the embedded JSON: line charts by season, grouped bars by age band. */
const SCRIPT = `
const D=JSON.parse(document.getElementById("data").textContent),ns="http://www.w3.org/2000/svg",tip=document.getElementById("tip");
const KEYS=["noScript","baseline","script"].filter(k=>D.names[k]);
const el=(t,a,p)=>{const e=document.createElementNS(ns,t);for(const k in a)e.setAttribute(k,a[k]);p&&p.appendChild(e);return e};
const fmt=v=>Math.abs(v)>=100?v.toFixed(0):Math.abs(v)>=10?v.toFixed(1):v.toFixed(2);
const show=(ev,h)=>{tip.innerHTML=h;tip.style.opacity=1;tip.style.left=Math.min(ev.clientX+12,innerWidth-tip.offsetWidth-8)+"px";tip.style.top=(ev.clientY-40)+"px"};
const hide=()=>{tip.style.opacity=0};
const W=560,H=300,L=58,R=12,T=10,B=44;
function axes(svg,c,lo,hi){const y=v=>T+(hi-v)*(H-T-B)/(hi-lo||1);
 for(let t=0;t<=5;t++){const v=lo+(hi-lo)*t/5;el("line",{x1:L,x2:W-R,y1:y(v),y2:y(v),stroke:"var(--line)"},svg);el("text",{x:L-6,y:y(v)+4,"text-anchor":"end"},svg).textContent=fmt(v)}
 if(lo<0&&hi>0)el("line",{x1:L,x2:W-R,y1:y(0),y2:y(0),stroke:"var(--ink-3)"},svg);
 el("text",{class:"axis",x:(L+W-R)/2,y:H-4,"text-anchor":"middle"},svg).textContent=c.xTitle;
 el("text",{class:"axis",transform:"translate(14 "+((T+H-B)/2)+") rotate(-90)","text-anchor":"middle"},svg).textContent=c.yTitle;return y}
function bounds(c){const v=KEYS.flatMap(k=>(c.series[k]||[]).filter(Boolean).flatMap(p=>[p.mean-p.se,p.mean+p.se]));let lo=Math.min(...v),hi=Math.max(...v);const pad=(hi-lo)*0.08||1;lo-=pad;hi+=pad;if(c.bars){lo=Math.min(lo,0);hi=Math.max(hi,0)}return[lo,hi]}
const h=s=>String(s).replace(/[&<>"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[ch]);
function tipText(c,i){return "<b>"+h(c.x[i])+"</b><br>"+KEYS.filter(k=>c.series[k]&&c.series[k][i]).map(k=>h(D.names[k])+": "+fmt(c.series[k][i].mean)+(c.series[k][i].se?" ± "+fmt(c.series[k][i].se):"")).join("<br>")}
function line(svg,c){const[lo,hi]=bounds(c),n=c.x.length,x=i=>L+i*(W-L-R)/(n-1||1),y=axes(svg,c,lo,hi);
 c.x.forEach((lab,i)=>{if(n<=12||i%2===0)el("text",{x:x(i),y:H-B+16,"text-anchor":"middle"},svg).textContent=lab});
 for(const k of KEYS){const s=c.series[k];if(!s)continue;
  el("path",{d:s.map((p,i)=>p?(i&&s[i-1]?"L":"M")+x(i)+" "+y(p.mean):"").join(" "),fill:"none",stroke:"var(--"+k+")","stroke-width":2,"stroke-linejoin":"round","stroke-linecap":"round"},svg)}
 const cross=el("line",{y1:T,y2:H-B,stroke:"var(--ink-3)",opacity:0},svg),dots=KEYS.map(k=>el("circle",{r:4,fill:"var(--"+k+")",stroke:"var(--panel)","stroke-width":2,opacity:0},svg));
 const hit=el("rect",{x:L,y:T,width:W-L-R,height:H-T-B,fill:"transparent"},svg);
 hit.addEventListener("pointermove",ev=>{const p=svg.createSVGPoint();p.x=ev.clientX;p.y=ev.clientY;const q=p.matrixTransform(svg.getScreenCTM().inverse());const i=Math.max(0,Math.min(n-1,Math.round((q.x-L)/((W-L-R)/(n-1||1)))));
  cross.setAttribute("x1",x(i));cross.setAttribute("x2",x(i));cross.setAttribute("opacity",1);
  KEYS.forEach((k,j)=>{const s=c.series[k],d=dots[j];if(s&&s[i]){d.setAttribute("cx",x(i));d.setAttribute("cy",y(s[i].mean));d.setAttribute("opacity",1)}else d.setAttribute("opacity",0)});
  show(ev,tipText(c,i))});
 hit.addEventListener("pointerleave",()=>{hide();cross.setAttribute("opacity",0);dots.forEach(d=>d.setAttribute("opacity",0))})}
function bars(svg,c){const[lo,hi]=bounds(c),y=axes(svg,c,lo,hi),ks=KEYS.filter(k=>c.series[k]),band=(W-L-R)/c.x.length,bw=Math.min(34,band/(ks.length+1));
 c.x.forEach((lab,i)=>{const cx=L+band*i+band/2;el("text",{x:cx,y:H-B+16,"text-anchor":"middle"},svg).textContent=lab;
  ks.forEach((k,j)=>{const p=c.series[k][i];if(!p)return;const bx=cx+(j-(ks.length-1)/2)*(bw+2)-bw/2,y0=y(0),y1=y(p.mean);
   el("rect",{x:bx,y:Math.min(y0,y1),width:bw,height:Math.max(1,Math.abs(y1-y0)),rx:3,fill:"var(--"+k+")"},svg)});
  const hit=el("rect",{x:cx-band/2,y:T,width:band,height:H-T-B,fill:"transparent"},svg);
  hit.addEventListener("pointermove",ev=>show(ev,tipText(c,i)));hit.addEventListener("pointerleave",hide)})}
document.querySelectorAll("svg[data-chart]").forEach(svg=>{const[g,i]=svg.dataset.chart.split(":"),age=g==="ageCharts";(age?bars:line)(svg,Object.assign({xTitle:age?"Age band":"Season",bars:age},D[g][+i]))});`;

export function renderRunHtml(report: ExportableReport, runId: string): string {
  const data = buildChartData(report);
  const title = report.baseline ? `${report.script.id} vs ${report.baseline.id}` : report.script.id;
  const legend = (["script", "baseline", "noScript"] as const)
    .filter((k) => data.names[k])
    .map((k) => `<span style="--c:var(--${k})">${esc(data.names[k])}</span>`)
    .join("");
  const figure = (group: string, i: number, c: Chart) =>
    `<figure><h3>${esc(c.title)}</h3><p class="note">${esc(c.note)}</p><svg data-chart="${group}:${i}" viewBox="0 0 560 300" role="img" aria-label="${esc(c.title)}, ${esc(c.yTitle)}"></svg></figure>`;
  const seasons = data.seasonCharts.length
    ? `<h2>Season by season</h2><p class="note">Mean of ${esc(report.runDetails.runs)} runs; hover for values and ± one standard error. "No script" is the same league with BBGM-style development only.</p>
<div class="legend">${legend}</div><div class="charts">${data.seasonCharts.map((c, i) => figure("seasonCharts", i, c)).join("")}</div>`
    : "";
  const ages = data.ageCharts.length
    ? `<h2>By age</h2><div class="legend">${legend}</div><div class="charts">${data.ageCharts.map((c, i) => figure("ageCharts", i, c)).join("")}</div>`
    : "";
  const files = [`<a href="report.json">report.json</a>`, `<a href="manifest.json">manifest.json</a>`, `<a href="players.csv">players.csv</a>`];
  if (report.baseline) files.push(`<a href="players.baseline.csv">players.baseline.csv</a>`);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="NET Lab run ${esc(runId)}: ${esc(title)} on ${esc(report.league.name)}.">
<style>${CSS}</style></head>
<body><main>
<h1>${esc(title)}</h1>
<p class="meta">NET Lab run ${esc(runId)} · ${esc(report.runDetails.netRuns ?? report.mode)} · ${esc(report.league.name)}</p>
${seasons}
${ages}
${kpiTable(report)}
${checksTable(report)}
${detailsTable(report)}
<footer>Data: ${files.join(" · ")} · Replay with <code>pnpm lab replay manifest.json</code></footer>
</main><div class="tip" id="tip"></div>
<script type="application/json" id="data">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>
<script>${SCRIPT}</script>
</body></html>
`;
}

/** Writes index.html plus the run's data files into `outDir`. Returns the page path. */
export function exportRunHtml(runDir: string, outDir: string): string {
  const report = JSON.parse(fs.readFileSync(path.join(runDir, "report.json"), "utf8")) as ExportableReport;
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of ["report.json", "manifest.json", "players.csv", "players.baseline.csv"]) {
    const src = path.join(runDir, f);
    if (fs.existsSync(src) && path.resolve(src) !== path.resolve(outDir, f)) fs.copyFileSync(src, path.join(outDir, f));
  }
  const page = path.join(outDir, "index.html");
  fs.writeFileSync(page, renderRunHtml(report, path.basename(runDir)));
  return page;
}
