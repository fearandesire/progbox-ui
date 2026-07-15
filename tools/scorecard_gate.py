#!/usr/bin/env python3
"""Quality-gate script for progression-script benchmark scorecards.

Reads a `comparison_scorecard.csv` produced by
api/vendor/progbox_cpp/tools/analysis.py (comparison mode) and asserts a
fixed set of acceptance targets comparing an OLD progression script
(e.g. v4.1) against a NEW one (e.g. v4.3). Prints a PASS/FAIL table and
exits non-zero if any REQUIRED target fails.

Pure stdlib (csv, argparse, sys, math). Runs under Windows `python` and
WSL/Linux `python3`.

Exit codes:
    0  all required targets PASS
    1  at least one required target FAILS
    2  could not locate the old/new rows in the CSV
    3  no FAILs, but at least one required target is INCONCLUSIVE
"""

from __future__ import annotations

import argparse
import csv
import math
import sys

EPS = 1e-6

REQUIRED_COLUMNS = [
    "Script",
    "Players",
    "Runs",
    "PeakAge",
    "PrimeSep",
    "PrimeSep(OVRadj)",
    "DeclineSlope",
    "Drift",
    "MedianσΔ",
    "ICC(Ovr)",
    "KendallW",
    "P99 Ovr",
    "%>cap",
    "GodProg/run",
]

NUMERIC_COLUMNS = [
    "PeakAge",
    "PrimeSep",
    "PrimeSep(OVRadj)",
    "DeclineSlope",
    "Drift",
    "MedianσΔ",
    "ICC(Ovr)",
    "KendallW",
    "P99 Ovr",
    "%>cap",
    "GodProg/run",
]


def parse_args(argv):
    parser = argparse.ArgumentParser(
        description=(
            "Assert v4.1-vs-v4.3 (or other labeled) progression-script "
            "acceptance targets against a comparison_scorecard.csv."
        )
    )
    parser.add_argument("csv_path", help="Path to comparison_scorecard.csv")
    parser.add_argument(
        "--old-label",
        default="v4.1",
        help="Substring (case-insensitive) identifying the OLD script's Script column (default: v4.1)",
    )
    parser.add_argument(
        "--new-label",
        default="v4.3",
        help="Substring (case-insensitive) identifying the NEW script's Script column (default: v4.3)",
    )
    return parser.parse_args(argv)


def _fallback_substrings(label: str):
    """Generate fallback substrings for a label, e.g. 'v4.1' -> also try 'v41'."""
    candidates = [label]
    stripped = label.replace(".", "")
    if stripped != label:
        candidates.append(stripped)
    return candidates


def load_rows(csv_path: str):
    try:
        with open(csv_path, "r", newline="", encoding="utf-8-sig") as fh:
            reader = csv.DictReader(fh)
            rows = list(reader)
            fieldnames = reader.fieldnames or []
    except OSError as exc:
        print(f"ERROR: could not read CSV '{csv_path}': {exc}", file=sys.stderr)
        sys.exit(2)

    missing = [c for c in REQUIRED_COLUMNS if c not in fieldnames]
    if missing:
        print(
            f"ERROR: CSV '{csv_path}' is missing required columns: {missing}\n"
            f"Found columns: {fieldnames}",
            file=sys.stderr,
        )
        sys.exit(2)

    return rows


def find_row(rows, label: str):
    candidates = _fallback_substrings(label)
    label_lower_list = [c.lower() for c in candidates]
    for row in rows:
        script_val = (row.get("Script") or "").lower()
        for cand in label_lower_list:
            if cand.lower() in script_val:
                return row
    return None


def parse_number(raw):
    """Parse a numeric cell. Returns float, or None if missing/undefined."""
    if raw is None:
        return None
    val = str(raw).strip()
    if val == "" or val == "-" or val.lower() == "nan":
        return None
    # Strip a trailing '%' just in case the CSV encodes percentages as strings.
    if val.endswith("%"):
        val = val[:-1].strip()
        try:
            return float(val) / 100.0
        except ValueError:
            return None
    try:
        f = float(val)
    except ValueError:
        return None
    if math.isnan(f):
        return None
    return f


def get_numeric(row, column):
    return parse_number(row.get(column))


class Target:
    __slots__ = ("name", "old", "new", "verdict", "reason", "required")

    def __init__(self, name, old, new, verdict, reason, required):
        self.name = name
        self.old = old
        self.new = new
        self.verdict = verdict
        self.reason = reason
        self.required = required


def fmt(value, decimals=3, percent=False):
    if value is None:
        return "-"
    if percent:
        return f"{value * 100:.{decimals}f}%"
    return f"{value:.{decimals}f}"


def evaluate(old_row, new_row):
    targets = []

    # --- T1 PEAK (REQUIRED) ---
    old_peak = get_numeric(old_row, "PeakAge")
    new_peak = get_numeric(new_row, "PeakAge")
    if old_peak is None or new_peak is None:
        verdict = "INCONCLUSIVE"
        reason = "PeakAge missing for old and/or new script"
    else:
        in_range = 26.0 <= new_peak <= 28.0
        improved = new_peak < old_peak
        verdict = "PASS" if (in_range and improved) else "FAIL"
        reason = (
            f"new={new_peak:.2f} in [26,28]={in_range}, "
            f"new<old ({new_peak:.2f}<{old_peak:.2f})={improved}"
        )
    targets.append(
        Target("T1 PEAK", fmt(old_peak, 2), fmt(new_peak, 2), verdict, reason, True)
    )

    # --- T2 DECLINE (REQUIRED) ---
    old_decline = get_numeric(old_row, "DeclineSlope")
    new_decline = get_numeric(new_row, "DeclineSlope")
    if old_decline is None or new_decline is None:
        verdict = "INCONCLUSIVE"
        reason = "DeclineSlope missing for old and/or new script"
    else:
        steeper = new_decline < old_decline
        in_range = -2.0 <= new_decline <= -0.75
        verdict = "PASS" if (steeper and in_range) else "FAIL"
        reason = (
            f"new<old (steeper) ({new_decline:.3f}<{old_decline:.3f})={steeper}, "
            f"new in [-2.0,-0.75]={in_range}"
        )
    targets.append(
        Target(
            "T2 DECLINE",
            fmt(old_decline, 3),
            fmt(new_decline, 3),
            verdict,
            reason,
            True,
        )
    )

    # --- T3 CEILING (REQUIRED) ---
    old_pct_cap = get_numeric(old_row, "%>cap")
    new_pct_cap = get_numeric(new_row, "%>cap")
    old_p99 = get_numeric(old_row, "P99 Ovr")
    new_p99 = get_numeric(new_row, "P99 Ovr")
    if new_pct_cap is None or new_p99 is None:
        verdict = "INCONCLUSIVE"
        reason = "%>cap and/or P99 Ovr missing for new script"
    else:
        cap_ok = new_pct_cap < 0.005
        p99_ok = new_p99 <= 82.0
        verdict = "PASS" if (cap_ok and p99_ok) else "FAIL"
        reason = (
            f"new %>cap<0.5% ({new_pct_cap * 100:.3f}%)={cap_ok}, "
            f"new P99<=82.0 ({new_p99:.2f})={p99_ok}"
        )
    targets.append(
        Target(
            "T3 CEILING",
            f"{fmt(old_pct_cap, 3, percent=True)} / {fmt(old_p99, 2)}",
            f"{fmt(new_pct_cap, 3, percent=True)} / {fmt(new_p99, 2)}",
            verdict,
            reason,
            True,
        )
    )

    # --- T4 SEPARATION (REQUIRED) ---
    old_sep = get_numeric(old_row, "PrimeSep")
    new_sep = get_numeric(new_row, "PrimeSep")
    old_sep_adj = get_numeric(old_row, "PrimeSep(OVRadj)")
    new_sep_adj = get_numeric(new_row, "PrimeSep(OVRadj)")
    if new_sep is None or new_sep_adj is None:
        verdict = "INCONCLUSIVE"
        reason = "PrimeSep and/or PrimeSep(OVRadj) missing for new script"
    else:
        sep_ok = new_sep > 0
        sep_adj_ok = new_sep_adj > 0
        verdict = "PASS" if (sep_ok and sep_adj_ok) else "FAIL"
        reason = (
            f"new PrimeSep>0 ({new_sep:.3f})={sep_ok}, "
            f"new PrimeSep(OVRadj)>0 ({new_sep_adj:.3f})={sep_adj_ok}"
        )
    targets.append(
        Target(
            "T4 SEPARATION",
            f"{fmt(old_sep, 3)} / {fmt(old_sep_adj, 3)}",
            f"{fmt(new_sep, 3)} / {fmt(new_sep_adj, 3)}",
            verdict,
            reason,
            True,
        )
    )

    # --- T5 DEFENSE (INFO) ---
    targets.append(
        Target(
            "T5 DEFENSE",
            "-",
            "-",
            "INCONCLUSIVE",
            "verified separately via defender spot-check (see verdict doc)",
            False,
        )
    )

    # --- T6 NOISE (REQUIRED) ---
    old_icc = get_numeric(old_row, "ICC(Ovr)")
    new_icc = get_numeric(new_row, "ICC(Ovr)")
    old_kw = get_numeric(old_row, "KendallW")
    new_kw = get_numeric(new_row, "KendallW")
    if None in (old_icc, new_icc, old_kw, new_kw):
        verdict = "INCONCLUSIVE"
        reason = "ICC(Ovr) and/or KendallW missing for old and/or new script"
    else:
        icc_ok = new_icc >= old_icc - EPS
        kw_ok = new_kw >= old_kw - EPS
        verdict = "PASS" if (icc_ok and kw_ok) else "FAIL"
        reason = (
            f"new ICC>=old ({new_icc:.3f}>={old_icc:.3f})={icc_ok}, "
            f"new KendallW>=old ({new_kw:.3f}>={old_kw:.3f})={kw_ok}"
        )
    targets.append(
        Target(
            "T6 NOISE",
            f"{fmt(old_icc, 3)} / {fmt(old_kw, 3)}",
            f"{fmt(new_icc, 3)} / {fmt(new_kw, 3)}",
            verdict,
            reason,
            True,
        )
    )

    # --- T7 SANITY (REQUIRED) ---
    new_drift = get_numeric(new_row, "Drift")
    old_drift = get_numeric(old_row, "Drift")
    new_god = get_numeric(new_row, "GodProg/run")
    if new_drift is None:
        verdict = "INCONCLUSIVE"
        reason = "Drift missing for new script"
    else:
        drift_ok = abs(new_drift) <= 0.5
        verdict = "PASS" if drift_ok else "FAIL"
        reason = f"abs(new Drift)<=0.5 (|{new_drift:.3f}|)={drift_ok}"
    god_note = "n/a" if new_god is None else fmt(new_god, 3)
    reason = f"{reason}; GodProg/run(new)={god_note} [INFO]"
    targets.append(
        Target(
            "T7 SANITY",
            fmt(old_drift, 3),
            fmt(new_drift, 3),
            verdict,
            reason,
            True,
        )
    )

    return targets


def print_table(targets):
    headers = ["Target", "Old", "New", "Verdict", "Reason"]
    col_widths = {
        "Target": max(len(headers[0]), max(len(t.name) for t in targets)),
        "Old": max(len(headers[1]), max(len(t.old) for t in targets)),
        "New": max(len(headers[2]), max(len(t.new) for t in targets)),
        "Verdict": max(len(headers[3]), max(len(t.verdict) for t in targets)),
        "Reason": max(len(headers[4]), max(len(t.reason) for t in targets)),
    }

    def row_line(cols):
        return "  ".join(
            str(c).ljust(col_widths[h]) for c, h in zip(cols, headers)
        )

    print(row_line(headers))
    print(
        "  ".join("-" * col_widths[h] for h in headers)
    )
    for t in targets:
        print(row_line([t.name, t.old, t.new, t.verdict, t.reason]))


def main(argv=None):
    args = parse_args(argv if argv is not None else sys.argv[1:])
    rows = load_rows(args.csv_path)

    old_row = find_row(rows, args.old_label)
    new_row = find_row(rows, args.new_label)

    if old_row is None or new_row is None:
        print("ERROR: could not locate old and/or new script row in CSV.", file=sys.stderr)
        print(f"  old-label='{args.old_label}' found={old_row is not None}", file=sys.stderr)
        print(f"  new-label='{args.new_label}' found={new_row is not None}", file=sys.stderr)
        print("Available Script labels:", file=sys.stderr)
        for row in rows:
            print(f"  - {row.get('Script')}", file=sys.stderr)
        sys.exit(2)

    targets = evaluate(old_row, new_row)

    print_table(targets)

    required_targets = [t for t in targets if t.required]
    passed = [t for t in required_targets if t.verdict == "PASS"]
    failed = [t for t in required_targets if t.verdict == "FAIL"]
    inconclusive = [t for t in required_targets if t.verdict == "INCONCLUSIVE"]

    print()
    print(f"GATE: {len(passed)}/{len(required_targets)} required targets passed")

    if failed:
        print("OVERALL: FAIL")
        sys.exit(1)
    elif inconclusive:
        print("OVERALL: INCONCLUSIVE")
        sys.exit(3)
    else:
        print("OVERALL: PASS")
        sys.exit(0)


if __name__ == "__main__":
    main()
