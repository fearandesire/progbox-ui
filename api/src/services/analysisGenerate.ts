import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { parse } from "csv-parse/sync";

/**
 * Generates analysis.xlsx and analysis_dashboard.html from raw/outputs.csv.
 * Simpler than vendored Python plotly pipeline; satisfies smoke + download + iframe.
 */
export async function generateAnalysis(canonicalRunDir: string): Promise<void> {
  const rawCsv = path.join(canonicalRunDir, "raw", "outputs.csv");
  if (!fs.existsSync(rawCsv)) {
    console.warn(`generateAnalysis: missing ${rawCsv}`);
    return;
  }
  const text = fs.readFileSync(rawCsv, "utf8");
  let rows: Record<string, string>[] = [];
  try {
    rows = parse(text, { columns: true, skip_empty_lines: true }) as Record<string, string>[];
  } catch {
    return;
  }

  const xlsxPath = path.join(canonicalRunDir, "analysis.xlsx");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "progbox-ui";
  const sheet = workbook.addWorksheet("Outputs");
  if (rows.length > 0) {
    const headers = Object.keys(rows[0]!);
    sheet.addRow(headers);
    for (const r of rows) {
      sheet.addRow(headers.map((h) => r[h] ?? ""));
    }
  }
  await workbook.xlsx.writeFile(xlsxPath);

  const htmlPath = path.join(canonicalRunDir, "analysis_dashboard.html");
  const safeJson = JSON.stringify(rows.slice(0, 500)).replace(/</g, "\\u003c");
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Progbox analysis</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 1rem; background: #f8fafc; color: #0f172a; }
    h1 { font-size: 1.25rem; }
    table { border-collapse: collapse; width: 100%; background: #fff; }
    th, td { border: 1px solid #e2e8f0; padding: 0.35rem 0.5rem; font-size: 0.85rem; }
    th { background: #e2e8f0; text-align: left; }
  </style>
</head>
<body>
  <h1>Monte Carlo outputs (sample)</h1>
  <p>Rows loaded: ${rows.length}</p>
  <div id="tbl"></div>
  <script>
    const rows = ${safeJson};
    if (rows.length) {
      const keys = Object.keys(rows[0]);
      const tbl = document.createElement('table');
      const thead = document.createElement('thead');
      const theadTr = document.createElement('tr');
      for (const k of keys) {
        const th = document.createElement('th');
        th.textContent = k;
        theadTr.appendChild(th);
      }
      thead.appendChild(theadTr);
      tbl.appendChild(thead);
      const tbody = document.createElement('tbody');
      for (const r of rows.slice(0, 200)) {
        const tr = document.createElement('tr');
        for (const k of keys) {
          const td = document.createElement('td');
          td.textContent = r[k] ?? '';
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      tbl.appendChild(tbody);
      document.getElementById('tbl').appendChild(tbl);
    }
  </script>
</body>
</html>`;
  fs.writeFileSync(htmlPath, html, "utf8");
}
