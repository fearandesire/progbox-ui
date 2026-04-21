"""
analysis.py · NoEyeTest Monte Carlo Analysis

8 diagnostic charts, each answering one tuning question.
Excel data dump so you can analyse it without writing code!

Charts
------
  1  Age Tier Profiles       | Are the three tiers diverging correctly?
  2  Composite Calibration   | Is the stat→prog mapping landing as intended?
  3  Physical vs Cognitive   | Are age-gated physical restrictions firing?
  4  Player Reliability      | Which players are RNG lotteries vs locked-in?
  5  Attribute Heatmap       | Which attributes is the engine actually moving?
  6  Tier Separation         | Does composite cleanly rank progression outcomes?
  7  Outcome Range           | What is each player's realistic floor and ceiling?
  8  Convergence             | Did I run enough iterations?

Usage
-----
    from analysis import generate_analysis
    generate_analysis()                  # auto-discovers latest run
    generate_analysis('outputs/DATE')    # explicit path

Prerequisite
------------
    data/input.csv must be saved WITH its index so PlayerID is preserved
"""
from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Optional

import matplotlib.patches as mpatches
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.colors import TwoSlopeNorm
from openpyxl import Workbook, load_workbook
from scipy import stats as scipy_stats
from scipy.stats import gaussian_kde

import argparse
import sys

#existing config class from python, lazy.
class Config:
    # ── OVR calculation  (DO NOT MODIFY) ─────────────────────────────────────
    OVR_CALC_ORDER = [
        'Hgt', 'Str', 'Spd', 'Jmp', 'End', 'Ins',
        'Dnk', 'FT',  '3Pt', 'oIQ', 'dIQ', 'Drb',
        'Pss', '2Pt', 'Reb',
    ]
    OVR_COEFFS = np.array(
        [0.159, 0.0777, 0.123, 0.051, 0.0632, 0.0126,
         0.0286, 0.0202, 0.0726, 0.133, 0.159, 0.059,
         0.062,  0.01,   0.01],
        dtype=float,
    )
    OVR_CENTERS = np.array(
        [47.5, 50.2, 50.8, 48.7, 39.9, 42.4,
         49.5, 47.0, 47.1, 46.8, 46.7, 54.8,
         51.3, 47.0, 51.4],
        dtype=float,
    )

    # ── Attribute layout ──────────────────────────────────────────────────────
    ALL_ATTRS: list[str] = [
        'dIQ', 'Dnk', 'Drb', 'End', '2Pt', 'FT', 'Ins',
        'Jmp', 'oIQ', 'Pss', 'Reb', 'Spd', 'Str', '3Pt', 'Hgt',
    ]
    # Height never changes. all other attrs receive a per-skill prog roll
    PROG_KEYS: frozenset[str] = frozenset(ALL_ATTRS) - {'Hgt'}
    ATTR_MIN, ATTR_MAX = 0, 100

    # ── Physical skill restriction sets (v4.1) ────────────────────────────────
    OLD_AGE_PHYS: frozenset[str] = frozenset({'Spd', 'Str', 'Jmp', 'End'})  # 30+
    MID_AGE_PHYS: frozenset[str] = frozenset({'Spd', 'Str', 'Jmp'})         # 26-29

    # ── DataFrame stat columns required as input ──────────────────────────────
    # NOTE: v4.1 uses EWA
    STAT_COLS: list[str] = ['Age', 'PER', 'DWS', 'EWA']
    NUMCOLS:   list[str] = STAT_COLS + ALL_ATTRS

    # ── Composite score weights (mirrors JS) ──────────────────────────────────
    COMPOSITE = dict(per_w=0.70, dws_scale=5.0, dws_w=0.20,
                     ewa_scale=3.0, ewa_w=0.10)

    # ── Per-age-group prog-range parameters ───────────────────────────────────
    # max1=None → no upside formula (35+ never improves on non-decline path)
    AGE_GROUP_CONFIG: dict[str, dict] = {
        '26-30': dict(min1=5, min2=7, max1=4,    max2=2,    hard_max=4),
        '31-34': dict(min1=6, min2=7, max1=4,    max2=3,    hard_max=2),
        '35+':   dict(min1=6, min2=9, max1=None, max2=None, hard_max=0),
    }

    OVR_HARD_CAP = 80

    # ── God Progression ───────────────────────────────────────────────────────
    GOD_PROG = dict(max_chance=0.02, age_limit=30, ovr_limit=60,
                    bonus_min=7, bonus_max=10)

    MIN_AGE = 26

PROG_ATTRS = [a for a in Config.ALL_ATTRS if a != 'Hgt']
PHYS_ATTRS = sorted(Config.OLD_AGE_PHYS)       # ['End', 'Jmp', 'Spd', 'Str']
COGN_ATTRS = [a for a in PROG_ATTRS if a not in Config.OLD_AGE_PHYS]
STAT_COLS  = Config.STAT_COLS[1:]               # ['PER', 'DWS', 'EWA']
AGE_LABELS = ['26-30', '31-34', '35+']
AGE_BINS   = [0, 30, 34, 999]
_W         = Config.COMPOSITE

# Chart 7
MAX_RANGE_ROWS = 100

_PAL = dict(
    pos      = '#27ae60',
    neg      = '#c0392b',
    blue     = '#2980b9',
    amber    = '#e67e22',
    dark     = '#2c3e50',
    subtle   = '#95a5a6',
    grid     = '#ecf0f1',
    bg       = '#ffffff',
    age_cols = ['#2980b9', '#e67e22', '#c0392b'],
    q_cols   = ['#c0392b', '#e67e22', '#27ae60', '#2980b9'],
)


# ── Pure utilities ─────────────────────────────────────────────────────────────

def _age_group(ages: pd.Series) -> pd.Series:
    return pd.cut(ages, bins=AGE_BINS, labels=AGE_LABELS, right=True)


def _composite(df: pd.DataFrame) -> pd.Series:
    return (df['PER'] * _W['per_w']
            + df['DWS'] * _W['dws_scale'] * _W['dws_w']
            + df['EWA'] * _W['ewa_scale'] * _W['ewa_w'])


def _qcut_within(s: pd.Series) -> pd.Series:
    """Quartile within a group. rank(method='first') avoids duplicate edge errors."""
    try:
        return pd.qcut(s.rank(method='first'), 4, labels=['Q1', 'Q2', 'Q3', 'Q4'])
    except ValueError:
        return pd.Categorical(['Q2'] * len(s), categories=['Q1', 'Q2', 'Q3', 'Q4'])


def _display_label(name: str, team: str) -> str:
    """Includes team so duplicate names are distinguishable."""
    return f'{name} ({team})'


def _theoretical_range(composite: float, ovr: int, age: int) -> tuple[float, float]:
    """
    Replicate get_prog_range() from progutils.
    Reads Config directly so it stays in sync if weights ever change.
    """
    group = '35+' if age >= 35 else ('31-34' if age >= 31 else '26-30')
    cfg   = Config.AGE_GROUP_CONFIG[group]
    min1, min2 = cfg['min1'], cfg['min2']
    max1, max2 = cfg['max1'], cfg['max2']
    hard_max   = cfg['hard_max']

    if composite <= 20 and age < 31:
        lo, hi = math.ceil(composite / 5) - 6, math.ceil(composite / 4) - 1
    else:
        lo = math.ceil(composite / min1) - min2
        hi = (math.ceil(composite / max1) - max2) if max1 else 0
        if not hard_max and hi < 0:
            hi = 0
    if hi > hard_max:
        hi = hard_max

    cap = Config.OVR_HARD_CAP
    if ovr + hi >= cap:
        if ovr >= cap:
            hi = 0
            lo = -10 if 30 < age < 35 else (-14 if age >= 35 else -2)
        else:
            hi = cap - ovr
            if ovr + lo >= cap:
                lo = 0
    return float(min(lo, hi)), float(hi)


def _save(fig: plt.Figure, path: Path) -> None:
    fig.savefig(path, bbox_inches='tight', facecolor=_PAL['bg'])
    plt.close(fig)


def _apply_style() -> None:
    plt.rcParams.update({
        'font.family': 'DejaVu Sans', 'axes.spines.top': False,
        'axes.spines.right': False, 'axes.grid': True,
        'grid.color': _PAL['grid'], 'grid.linewidth': 0.7,
        'figure.facecolor': _PAL['bg'], 'axes.facecolor': _PAL['bg'],
        'axes.labelsize': 10, 'xtick.labelsize': 9,
        'ytick.labelsize': 9, 'font.size': 10,
    })


# ── Data loading ───────────────────────────────────────────────────────────────

def _find_latest_run(base: Path = Path('../outputs/')) -> Path:
    runs = sorted(base.glob('*/raw/outputs.csv'),
                  key=lambda p: p.stat().st_mtime, reverse=True)
    if not runs:
        raise FileNotFoundError(f'No simulation outputs found under {base}/')
    return runs[0].parent.parent


def _load(raw_dir: Path) -> tuple[pd.DataFrame, pd.DataFrame]:
    df = pd.read_csv(raw_dir / 'outputs.csv')
    gp_path = raw_dir / 'godprogs.json'
    gp = pd.DataFrame()
    if gp_path.exists() and gp_path.stat().st_size > 2:
        records = json.loads(gp_path.read_text(encoding='utf-8'))
        if records:
            gp = pd.DataFrame(records)
    return df, gp


def _load_baseline(df: pd.DataFrame) -> pd.DataFrame:
    """
    Load pre-simulation attribute ratings, indexed by PlayerID.
    """
    path = Path('data/input.csv')
    if path.exists():
        base = pd.read_csv(path, index_col=0)
        base.index.name = 'PlayerID'
        return base[[a for a in PROG_ATTRS if a in base.columns]]

    print('  WARNING: data/input.csv not found. '
          'Save with data.to_csv("data/input.csv") (index=True). '
          'Falling back to run-0 values, your charts will PROBABLY BE GARBAZZO')
    return (df[df['Run'] == df['Run'].min()]
              .set_index('PlayerID')
              [[a for a in PROG_ATTRS if a in df.columns]])


def _per_player(df: pd.DataFrame) -> pd.DataFrame:
    """
    One summary row per player, keyed on PlayerID.
    Name and Team are carried as display columns only, not used as keys.
    """
    ppl = df.groupby('PlayerID', sort=True).agg(
        Name        = ('Name',     'first'),
        Team        = ('Team',     'first'),
        Age         = ('Age',      'first'),
        Baseline    = ('Baseline', 'first'),
        MeanDelta   = ('Delta',    'mean'),
        StdDelta    = ('Delta',    'std'),
        P05         = ('Ovr',      lambda s: s.quantile(0.05)),
        P25         = ('Ovr',      lambda s: s.quantile(0.25)),
        P50         = ('Ovr',      'median'),
        P75         = ('Ovr',      lambda s: s.quantile(0.75)),
        P95         = ('Ovr',      lambda s: s.quantile(0.95)),
        PctPositive = ('Delta',    lambda s: (s > 0).mean()),
        PER         = ('PER',      'first'),
        DWS         = ('DWS',      'first'),
        EWA         = ('EWA',      'first'),
    ).reset_index()
    ppl['Composite'] = _composite(ppl).round(3)
    ppl['AgeGroup']  = _age_group(ppl['Age'])
    ppl['Label']     = [_display_label(n, t) for n, t in zip(ppl['Name'], ppl['Team'])]
    # Quartile within age group. Q4 = top 25% of your tier, not the whole league.
    ppl['CompQ'] = ppl.groupby('AgeGroup', group_keys=False)['Composite'].transform(_qcut_within)
    return ppl


def _attr_delta(df: pd.DataFrame, baseline: pd.DataFrame) -> pd.DataFrame:
    """
    Per-player mean simulated attr value (across all runs) minus the original
    input attr rating. Indexed by PlayerID. Includes Age for group analysis.

    Computed once and shared by charts 3 and 5.
    """
    avail    = [a for a in PROG_ATTRS if a in baseline.columns and a in df.columns]
    mean_sim = df.groupby('PlayerID')[avail].mean()
    shared   = mean_sim.index.intersection(baseline.index)
    delta    = mean_sim.loc[shared] - baseline[avail].loc[shared]
    return delta.join(df.groupby('PlayerID')['Age'].first())


# ── Charts ─────────────────────────────────────────────────────────────────────

def _chart1(df: pd.DataFrame, out: Path) -> None:
    """
    KDE curves for each age tier.
    Green shading right of 0, red left of 0. the balance of positive vs
    negative probability mass is immediately visible.

    Expected: 26-30 right-skewed peak, 31-34 narrow near 0, 35+ left-skewed.
    Overlapping curves = age group configs are not differentiated enough.
    """
    df2 = df.assign(G=_age_group(df['Age']))
    xg  = np.linspace(df['Delta'].quantile(0.005), df['Delta'].quantile(0.995), 500)

    fig, ax = plt.subplots(figsize=(12, 6), dpi=120)
    for group, col in zip(AGE_LABELS, _PAL['age_cols']):
        vals = df2[df2['G'] == group]['Delta'].dropna().values
        if len(vals) < 10:
            continue
        kde  = gaussian_kde(vals, bw_method='scott')
        dens = kde(xg)
        ax.fill_between(xg, dens, where=(xg >= 0), color=_PAL['pos'], alpha=0.10)
        ax.fill_between(xg, dens, where=(xg  < 0), color=_PAL['neg'], alpha=0.10)
        ax.plot(xg, dens, color=col, lw=2.4, label=group)
        med = float(np.median(vals))
        ax.axvline(med, color=col, lw=1.2, ls='--', alpha=0.65)
        ax.text(med, kde([med])[0] * 1.06, f'med={med:+.1f}',
                ha='center', va='bottom', fontsize=8.5, color=col, fontweight='bold')
        rank = AGE_LABELS.index(group)
        ax.text(xg[-1] * 0.70, dens.max() * (0.95 - rank * 0.20),
                f'{group}: {(vals > 0).mean()*100:.0f}% positive',
                fontsize=9, color=col, fontweight='bold')

    ax.axvline(0, color=_PAL['dark'], lw=1.4, alpha=0.45)
    ax.set(xlabel='OVR Delta  (Simulated OVR − Baseline OVR)', ylabel='Density',
           title='Age Tier Outcome Profiles\n'
                 'Are the three tiers producing distinct progression shapes?')
    ax.set_yticks([])
    ax.legend(fontsize=9, framealpha=0.7)
    fig.tight_layout()
    _save(fig, out / '01_age_tier_profiles.png')


def _chart2(ppl: pd.DataFrame, out: Path) -> None:
    """
    Observed mean delta vs composite score, with the formula's theoretical lo/hi band.
    Dots inside the band = outcomes consistent with formula intent.
    r annotation shows how well composite actually predicts outcomes per tier.
    """
    rep_ages = {'26-30': 28, '31-34': 32, '35+': 37}
    fig, axes = plt.subplots(1, 3, figsize=(16, 6), dpi=120, sharey=True)

    for ax, group, col in zip(axes, AGE_LABELS, _PAL['age_cols']):
        sub = ppl[ppl['AgeGroup'] == group]
        if sub.empty:
            ax.set_visible(False); continue

        age     = rep_ages[group]
        med_ovr = int(sub['Baseline'].median())
        c_sweep = np.linspace(sub['Composite'].min() * 0.85,
                              sub['Composite'].max() * 1.15, 250)
        t_lo, t_hi = zip(*[_theoretical_range(c, med_ovr, age) for c in c_sweep])

        ax.fill_between(c_sweep, t_lo, t_hi, color=col, alpha=0.20,
                        label=f'Theoretical  (age={age}, OVR={med_ovr})')
        ax.plot(c_sweep, t_lo, color=col, lw=0.9, ls='--', alpha=0.55)
        ax.plot(c_sweep, t_hi, color=col, lw=0.9, ls='--', alpha=0.55)
        ax.scatter(sub['Composite'], sub['MeanDelta'],
                   color=col, s=60, alpha=0.80, edgecolors='white', lw=0.5,
                   zorder=4, label='Observed mean Δ')
        if len(sub) >= 3:
            m, b, r, *_ = scipy_stats.linregress(sub['Composite'], sub['MeanDelta'])
            xs = np.linspace(sub['Composite'].min(), sub['Composite'].max(), 200)
            ax.plot(xs, m*xs + b, color=_PAL['dark'], lw=1.8, zorder=5,
                    label=f'Trend  r={r:+.2f}')
        ax.axhline(0, color=_PAL['dark'], lw=0.8, alpha=0.4)
        ax.set(title=f'{group}  (rep. age {age})', xlabel='Composite Score')
        if ax is axes[0]:
            ax.set_ylabel('Mean OVR Delta')
        ax.legend(fontsize=7.5, framealpha=0.7)

    fig.suptitle("Composite Score Calibration\n"
                 "Shaded = formula's intended lo–hi range at median OVR  ·  "
                 "r = observed correlation",
                 fontsize=12, fontweight='bold')
    fig.tight_layout()
    _save(fig, out / '02_composite_calibration.png')


def _chart3(ad: pd.DataFrame, out: Path) -> None:
    """
    Mean attribute delta for physical vs cognitive groups per age tier.
    Error bars = ±1 SE across players.

    Physical gate: OLD_AGE_PHYS (age ≥ 30), ~3.5% gain pass rate
                   MID_AGE_PHYS (26–29), linear fade 70%→40%

    Expected:
      26-30: physical near-zero, cognitive positive
      31-34: physical negative, cognitive near zero
      35+:   both negative, physical more so
    """
    avail_phys = [a for a in PHYS_ATTRS if a in ad.columns]
    avail_cogn = [a for a in COGN_ATTRS  if a in ad.columns]

    rows = []
    for group in AGE_LABELS:
        sub = ad[_age_group(ad['Age']) == group]
        if sub.empty:
            continue
        phys = sub[avail_phys].mean(axis=1)
        cogn = sub[avail_cogn].mean(axis=1)
        rows.append({'AgeGroup': group,
                     'PhysMean': phys.mean(), 'PhysSE': phys.sem(),
                     'CognMean': cogn.mean(), 'CognSE': cogn.sem()})
    data = pd.DataFrame(rows)
    if data.empty:
        return

    x, w = np.arange(len(data)), 0.35
    fig, ax = plt.subplots(figsize=(11, 6), dpi=120)
    for offset, mean_col, se_col, col, label in [
        (-w/2, 'PhysMean', 'PhysSE', _PAL['neg'],  f'Physical  ({", ".join(avail_phys)})'),
        (+w/2, 'CognMean', 'CognSE', _PAL['blue'], 'Cognitive / Skill'),
    ]:
        bars = ax.bar(x + offset, data[mean_col], w, color=col, alpha=0.80, label=label,
                      yerr=data[se_col], capsize=5,
                      error_kw=dict(elinewidth=1.4, capthick=1.4))
        pad = data[[mean_col, se_col]].abs().max().max() * 0.05 + 0.02
        for bar in bars:
            h = bar.get_height()
            ax.text(bar.get_x() + bar.get_width() / 2,
                    h + (pad if h >= 0 else -pad * 2),
                    f'{h:+.2f}', ha='center', va='bottom',
                    fontsize=9, fontweight='bold', color=_PAL['dark'])

    ax.axhline(0, color=_PAL['dark'], lw=1.0, alpha=0.55)
    ax.set_xticks(x); ax.set_xticklabels(data['AgeGroup'], fontsize=12)
    ax.set(xlabel='Age Group',
           ylabel='Mean Attr Delta  (simulated mean − input baseline)',
           title='Physical vs Cognitive Attribute Divergence\n'
                 'Error bars = ±1 SE  ·  Physical attrs carry age-gate restrictions in the engine')
    ax.legend(fontsize=9, framealpha=0.7)
    fig.tight_layout()
    _save(fig, out / '03_phys_vs_cogn_by_age.png')


def _chart4(ppl: pd.DataFrame, out: Path) -> None:
    """
    Scatter: mean delta (x) vs std of delta (y). One dot = one player.
    Quadrant boundaries = dataset medians (relative, not absolute).

    Quadrants:
      High σ + positive μ → Boom-or-bust
      Low  σ + positive μ → Reliable Grower
      High σ + negative μ → Volatile Decliner
      Low  σ + negative μ → Reliable Decliner

    All players are labelled with their display label (Name + Team).
    """
    med_delta = ppl['MeanDelta'].median()
    med_std   = ppl['StdDelta'].median()

    fig, ax = plt.subplots(figsize=(14, 9), dpi=120)
    for group, col in zip(AGE_LABELS, _PAL['age_cols']):
        sub = ppl[ppl['AgeGroup'] == group]
        ax.scatter(sub['MeanDelta'], sub['StdDelta'],
                   color=col, s=70, alpha=0.80, edgecolors='white',
                   lw=0.5, label=group, zorder=4)

    ax.axvline(med_delta, color=_PAL['dark'], lw=1.2, ls='--', alpha=0.5,
               label=f'Median delta = {med_delta:+.2f}')
    ax.axhline(med_std,   color=_PAL['dark'], lw=1.2, ls='--', alpha=0.5,
               label=f'Median std = {med_std:.2f}')
    ax.axvline(0, color=_PAL['subtle'], lw=0.9, alpha=0.4)

    xl, xr = ax.get_xlim(); yb, yt = ax.get_ylim()
    px, py = (xr - xl) * 0.03, (yt - yb) * 0.03
    for tx, ty, ha, va, label, col in [
        (xr-px, yt-py, 'right', 'top',    'Boom-or-bust',      _PAL['amber']),
        (xl+px, yt-py, 'left',  'top',    'Volatile Decliner', _PAL['neg']),
        (xr-px, yb+py, 'right', 'bottom', 'Reliable Grower',   _PAL['pos']),
        (xl+px, yb+py, 'left',  'bottom', 'Reliable Decliner', _PAL['neg']),
    ]:
        ax.text(tx, ty, label, ha=ha, va=va, fontsize=9, color=col, fontweight='bold',
                alpha=0.65, bbox=dict(boxstyle='round,pad=0.3', fc='white', alpha=0.6, ec='none'))

    # ── Label EVERY point (with smart left/right alignment) ──────────
    for _, row in ppl.iterrows():
        # Put label on the right if dot is on the left half, and vice-versa
        x_offset = 6 if row['MeanDelta'] >= med_delta else -6
        ha_align = 'left' if row['MeanDelta'] >= med_delta else 'right'
        
        ax.annotate(
            row['Label'], 
            (row['MeanDelta'], row['StdDelta']),
            xytext=(x_offset, 3), 
            textcoords='offset points',
            fontsize=6, 
            color=_PAL['subtle'], 
            alpha=0.85,
            ha=ha_align,
            va='bottom'
        )

    ax.set(xlabel='Mean OVR Delta  (avg direction of change)',
           ylabel='Std of OVR Delta  (how variable outcomes are. higher = more RNG)',
           title='Player Outcome Reliability\n'
                 'Each dot = one player  ·  dashed lines = dataset medians  ·  colour = age group')
    ax.legend(fontsize=9, framealpha=0.7)
    
    # Slightly expand x-limits to give the edge labels room to breathe
    ax.set_xlim(xl - (xr - xl) * 0.08, xr + (xr - xl) * 0.08)
    
    fig.tight_layout()
    _save(fig, out / '04_player_reliability.png')


def _chart5(ad: pd.DataFrame, ppl: pd.DataFrame, out: Path) -> None:
    """
    Heatmap: rows = players (sorted by age then Baseline OVR descending),
    columns = attrs sorted left→right by magnitude of mean change.
    Cell = mean simulated attr - original input attr.  White = no change.

    Reveals:
      - Frozen attrs (all-white columns)
      - Physical attrs skewing red for 30+ (decline gate working)
      - Individual outliers
    """
    avail   = [a for a in PROG_ATTRS if a in ad.columns]
    # Keep Age in working frame for sorting; strip before plotting
    plot_df = ad[avail + ['Age']].copy()
    plot_df = plot_df.join(ppl.set_index('PlayerID')[['Baseline', 'Label']])
    plot_df = plot_df.sort_values(['Age', 'Baseline'], ascending=[True, False])
    labels  = plot_df['Label'].tolist()
    ages    = plot_df['Age'].tolist()
    plot_df = plot_df[avail]

    col_order = sorted(avail, key=lambda a: -plot_df[a].abs().mean())
    plot_df   = plot_df[col_order]

    abs_max = max(plot_df.abs().quantile(0.97).max(), 0.5)
    norm    = TwoSlopeNorm(vmin=-abs_max, vcenter=0, vmax=abs_max)

    fig, ax = plt.subplots(figsize=(len(avail) * 0.9 + 2, max(8, len(plot_df) * 0.28)), dpi=100)
    im = ax.imshow(plot_df.values, aspect='auto', cmap='RdYlGn', norm=norm)

    ax.set_xticks(range(len(col_order)))
    ax.set_xticklabels(
        [f'[P] {a}' if a in Config.OLD_AGE_PHYS else a for a in col_order],
        rotation=45, ha='right', fontsize=9,
    )
    ax.set_yticks(range(len(plot_df)))
    ax.set_yticklabels(
        [f'{lbl}  ({int(age)})' for lbl, age in zip(labels, ages)],
        fontsize=7.5,
    )
    # Age-group separator lines
    age_grps = [str(_age_group(pd.Series([a])).iloc[0]) for a in ages]
    for i in range(1, len(age_grps)):
        if age_grps[i] != age_grps[i - 1]:
            ax.axhline(i - 0.5, color=_PAL['dark'], lw=1.8, alpha=0.65)
            ax.text(len(col_order) - 0.45, i - 0.65, age_grps[i],
                    fontsize=8.5, color=_PAL['dark'], fontweight='bold', ha='right')

    cb = fig.colorbar(im, ax=ax, fraction=0.025, pad=0.02)
    cb.set_label('Mean Attr Delta  (simulated − input baseline)', fontsize=9)
    ax.set_title(
        'Attribute Movement Heatmap\n'
        '[P] = physical (age-gated)  ·  sorted: age → baseline OVR  ·  '
        'left = most moved  ·  white = no change from input',
        fontsize=11, fontweight='bold',
    )
    fig.tight_layout()
    _save(fig, out / '05_attribute_heatmap.png')


def _chart6(ppl: pd.DataFrame, df: pd.DataFrame, out: Path) -> None:
    """
    Violin + boxplot per within-age-group composite quartile.
    Strict upward ordering Q1→Q4 = composite cleanly drives outcomes.

    Quartiles are within-group (see _qcut_within), without this, 35+ players
    with structurally lower stats are always in Q1 regardless of performance.
    """
    full   = df.merge(ppl[['PlayerID', 'CompQ']], on='PlayerID')
    q_lbls = ['Q1', 'Q2', 'Q3', 'Q4']
    q_data = [full[full['CompQ'] == q]['Delta'].values for q in q_lbls]

    fig, ax = plt.subplots(figsize=(12, 6), dpi=120)
    parts   = ax.violinplot(q_data, positions=range(4),
                            showmedians=False, showextrema=False, widths=0.68)
    for body, col in zip(parts['bodies'], _PAL['q_cols']):
        body.set(facecolor=col, alpha=0.50, edgecolor=_PAL['dark'], linewidth=0.8)

    ax.boxplot(q_data, positions=range(4), widths=0.22, patch_artist=True,
               medianprops=dict(color=_PAL['dark'], linewidth=2.5),
               boxprops=dict(facecolor='white', alpha=0.90),
               whiskerprops=dict(linewidth=1.2), capprops=dict(linewidth=1.2),
               flierprops=dict(marker='o', markersize=2.5, alpha=0.22,
                               markerfacecolor=_PAL['subtle']))

    y_top = ax.get_ylim()[1]
    for i, (q, col) in enumerate(zip(q_lbls, _PAL['q_cols'])):
        sub   = ppl[ppl['CompQ'] == q]
        med   = full[full['CompQ'] == q]['Delta'].median()
        c_rng = f"{sub['Composite'].min():.1f}–{sub['Composite'].max():.1f}"
        ax.text(i, y_top * 0.96,
                f'med={med:+.1f}\nn={len(sub)}\n{c_rng}',
                ha='center', va='top', fontsize=8, color=col, fontweight='bold')

    ax.axhline(0, color=_PAL['dark'], lw=1.0, ls='--', alpha=0.5)
    ax.set_xticks(range(4))
    ax.set_xticklabels(['Q1\n(bottom)', 'Q2', 'Q3', 'Q4\n(top)'], fontsize=11)
    ax.set(xlabel='Composite Quartile  (assigned within age group, Q4 = top 25% of your tier)',
           ylabel='OVR Delta Distribution',
           title='Composite Score Tier Separation\n'
                 'Strict upward ordering Q1→Q4 = composite cleanly drives outcomes')
    fig.tight_layout()
    _save(fig, out / '06_composite_tier_separation.png')


def _chart7(ppl: pd.DataFrame, out: Path) -> None:
    """
    Range bars: P5/P25/P50/P75/P95 of simulated OVR per player.
    Capped at MAX_RANGE_ROWS: top half by |MeanDelta|, top half by StdDelta

    Thick bar = IQR (P25-P75)  ·  thin = P5-P95  ·  ◆ = median  ·  | = baseline
    Row labels = display Label (Name + Team) so duplicate names are distinguishable.
    """
    n_each = MAX_RANGE_ROWS // 2
    shown  = (pd.concat([ppl.nlargest(n_each, 'MeanDelta'),
                         ppl.nlargest(n_each, 'StdDelta')])
                .drop_duplicates('PlayerID')
                .sort_values('Baseline', ascending=False))

    age_col = dict(zip(AGE_LABELS, _PAL['age_cols']))
    fig, ax = plt.subplots(figsize=(12, max(8, len(shown) * 0.32)), dpi=100)

    for y, (_, row) in enumerate(shown.iterrows()):
        col = age_col.get(str(row['AgeGroup']), _PAL['blue'])
        ax.hlines(y, row['P05'], row['P95'], color=col, lw=1.0, alpha=0.40)
        ax.hlines(y, row['P25'], row['P75'], color=col, lw=4.0, alpha=0.80)
        ax.scatter(row['P50'],      y, marker='D', s=32, color=col,
                   zorder=5, edgecolors='white', lw=0.5)
        ax.scatter(row['Baseline'], y, marker='|', s=80,
                   color=_PAL['dark'], zorder=6, lw=1.8, alpha=0.75)

    ax.axvline(Config.OVR_HARD_CAP, color=_PAL['neg'], lw=1.5, ls='--', alpha=0.80,
               label=f'OVR cap ({Config.OVR_HARD_CAP})')
    ax.set_yticks(range(len(shown)))
    ax.set_yticklabels(
        [f"{row['Label']}  ({int(row['Age'])})" for _, row in shown.iterrows()],
        fontsize=7.5,
    )
    ax.set(xlabel='Simulated OVR',
           title=f'Player OVR Outcome Range  (top {len(shown)} by |delta| and volatility)\n'
                 'Thick bar = IQR (P25–P75)  ·  thin = P5–P95  ·  ◆ = median  ·  | = baseline')

    legend_items = [mpatches.Patch(color=c, label=g, alpha=0.80)
                    for g, c in age_col.items()]
    legend_items += [
        plt.Line2D([0], [0], color=_PAL['neg'], ls='--',
                   label=f'OVR cap ({Config.OVR_HARD_CAP})'),
        plt.Line2D([0], [0], color=_PAL['dark'], marker='|', ls='None',
                   markersize=10, label='Baseline OVR'),
    ]
    ax.legend(handles=legend_items, fontsize=8, framealpha=0.75, loc='lower right')
    fig.tight_layout()
    _save(fig, out / '07_player_outcome_range.png')


def _chart8(df: pd.DataFrame, out: Path) -> None:
    """
    Running mean delta ± 1 MCSE for the 6 highest-variance players.
    High-variance players are last to converge. if they've stabilised, all have.

    MCSE = s(n) / √n  where  s²(n) uses the Bessel-corrected online formula:
        var_pop(n)    = E[X²] - Ē[X]²          (running population variance)
        var_sample(n) = var_pop(n) x n/(n-1)    (Bessel correction)
        SE(n)         = sqrt(var_sample(n) / n)

    Band still wide at right edge → need more runs.
    MCSE > 0.3 at the final run → estimate is not yet reliable.
    """
    by_variance = df.groupby('PlayerID')['Delta'].std().dropna()
    if by_variance.empty:
        return

    # Get display labels for the panel titles
    pid_to_label = df.groupby('PlayerID').apply(
        lambda g: _display_label(g['Name'].iloc[0], g['Team'].iloc[0])
    )

    top_pids = by_variance.nlargest(min(6, len(by_variance))).index.tolist()
    ncols    = min(3, len(top_pids))
    nrows    = math.ceil(len(top_pids) / ncols)

    fig, axes = plt.subplots(nrows, ncols, figsize=(5*ncols, 4*nrows),
                             dpi=120, sharex=True, squeeze=False)

    for idx, (ax, pid) in enumerate(zip(axes.flat, top_pids)):
        vals = df[df['PlayerID'] == pid].sort_values('Run')['Delta'].values
        n    = len(vals)
        if n < 2:
            ax.set_visible(False); continue

        runs        = np.arange(1, n + 1)
        cum_mean    = np.cumsum(vals) / runs
        cum_mean_sq = np.cumsum(vals ** 2) / runs
        # np.where evaluates both branches, suppress the harmless n=1 divide warning
        with np.errstate(invalid='ignore', divide='ignore'):
            var_sample = np.where(runs > 1,
                                  (cum_mean_sq - cum_mean ** 2) * runs / (runs - 1),
                                  0.0)
        mcse = np.sqrt(np.maximum(var_sample, 0.0) / runs)

        ax.fill_between(runs, cum_mean - mcse, cum_mean + mcse,
                        color=_PAL['blue'], alpha=0.18, label='±1 MCSE')
        ax.plot(runs, cum_mean, color=_PAL['blue'], lw=1.3, label='Running mean')
        ax.axhline(vals.mean(), color=_PAL['dark'], ls='--', lw=0.9, alpha=0.5,
                   label=f'Final mean = {vals.mean():+.2f}')
        ax.text(0.97, 0.03, f'MCSE = {mcse[-1]:.3f}',
                transform=ax.transAxes, ha='right', va='bottom', fontsize=8,
                color=_PAL['subtle'],
                bbox=dict(boxstyle='round,pad=0.3', fc='white', alpha=0.7, ec='none'))
        ax.set_title(pid_to_label.get(pid, str(pid)), fontsize=9, fontweight='bold')
        if idx % ncols == 0:
            ax.set_ylabel('Running Mean Δ', fontsize=8)

    for ax in axes.flat[len(top_pids):]:
        ax.set_visible(False)
    for ax in axes[-1]:
        if ax.get_visible():
            ax.set_xlabel('Cumulative Runs', fontsize=9)
    axes.flat[0].legend(fontsize=7, framealpha=0.7, loc='upper right')

    fig.suptitle(
        'Convergence Check: Running Mean Delta  (±1 MCSE)\n'
        '6 highest-variance players  ·  band should narrow to the right  ·  '
        'MCSE > 0.3 at right edge = need more runs',
        fontsize=12, fontweight='bold',
    )
    fig.tight_layout()
    _save(fig, out / '08_convergence.png')


# ── Excel workbook ─────────────────────────────────────────────────────────────

def _col_letter(n: int) -> str:
    """Convert 1-based column number to Excel letter(s): 1→A, 27→AA, etc."""
    result = ''
    while n:
        n, rem = divmod(n - 1, 26)
        result = chr(65 + rem) + result
    return result


def _write_xlsx(xlsx_path: Path, ppl: pd.DataFrame, dataraw: pd.DataFrame,
                ad: pd.DataFrame, age_summary: pd.DataFrame,
                corr: pd.DataFrame, gp: pd.DataFrame) -> None:
    """
    Write sheets into analysis.xlsx, preserving the template's formatting.
    Cell values are cleared and rewritten; table refs are updated to avoid
    the Excel repair warning.

    Sheets (in order)
    -----------------
    Players       - One row per player. The primary working sheet for a tuner.
                    Outcome ranges, formula inputs, composite tier within age group.
    Attributes    - Per-player attribute delta from input baseline (most changed
                    on left), then mean final attribute values.
    Team Summary  - Mean and std of OVR delta per team, sorted by mean delta.
                    Reveals which franchises benefit most from this prog config.
    Age Summary   - Delta statistics by age tier. Are the three tiers diverging?
    Stat Leverage - Pearson r between each input stat and mean OVR delta.
    God Progs     - Every god-prog event (omitted if none occurred).
    All Runs      - Every run x every player. Every column.
                    Filter by PlayerID in Excel to inspect any individual player.
    """
    template = Path('../outputs/analysis.xlsx')
    if not xlsx_path.exists() and template.exists():
        import shutil
        shutil.copy(template, xlsx_path)

    wb = load_workbook(xlsx_path) if xlsx_path.exists() else Workbook()
    if 'Sheet' in wb.sheetnames and len(wb.sheetnames) == 1:
        del wb['Sheet']

    def _write_sheet(name: str, df: pd.DataFrame) -> None:
        """Clear values, write df, update table refs."""
        df = df.copy().round(4)
        if name not in wb.sheetnames:
            wb.create_sheet(name)
        ws = wb[name]
        for row in ws.iter_rows():
            for cell in row:
                cell.value = None
        for ci, col in enumerate(df.columns, 1):
            ws.cell(row=1, column=ci, value=col)
        for ri, row_vals in enumerate(df.itertuples(index=False), 2):
            for ci, val in enumerate(row_vals, 1):
                ws.cell(row=ri, column=ci,
                        value=None if (isinstance(val, float) and np.isnan(val)) else val)
        nrows, ncols = len(df) + 1, len(df.columns)
        new_ref = f"A1:{_col_letter(ncols)}{nrows}"
        for tbl in ws._tables.values():
            tbl.ref = new_ref
            from openpyxl.worksheet.table import TableColumn
            tbl.tableColumns = [TableColumn(id=i+1, name=str(c))
                                 for i, c in enumerate(df.columns)]

    # ── Sheet 1: Players ──────────────────────────────────────────────────────
    # One row per player. Sorted by Team, then Baseline OVR descending.
    # Column names avoid parentheses (break Excel formula refs).
    # CompTier = quartile within the player's own age group.
    players = ppl[[
        'PlayerID', 'Name', 'Team', 'Age', 'AgeGroup', 'CompQ',
        'Baseline',
        'P25', 'P50', 'P75',    # likely outcome range
        'P05', 'P95',             # floor / ceiling
        'MeanDelta', 'StdDelta', 'PctPositive',
        'Composite', 'PER', 'DWS', 'EWA',
    ]].rename(columns={
        'AgeGroup':    'Age_Tier',
        'CompQ':       'Comp_Tier',
        'P05':         'OVR_Floor',
        'P25':         'OVR_P25',
        'P50':         'OVR_Median',
        'P75':         'OVR_P75',
        'P95':         'OVR_Ceil',
        'MeanDelta':   'Mean_Delta',
        'StdDelta':    'Std_Delta',
        'PctPositive': 'Pct_Improved',
    }).sort_values(['Team', 'Baseline'], ascending=[True, False])
    _write_sheet('Players', players)

    # ── Sheet 2: Attributes ───────────────────────────────────────────────────
    # Delta columns (Δ prefix) first
    # Then mean final attribute values for reference.
    # Sorted by age tier then baseline OVR.
    attr_deltas = (ad[[c for c in ad.columns if c != 'Age']]
                   .round(2)
                   .rename(columns=lambda c: f'D_{c}'))   # D_ prefix avoids Greek char issues
    mean_attrs = dataraw.groupby('PlayerID')[PROG_ATTRS].mean().round(2)

    attributes = (
        ppl[['PlayerID', 'Name', 'Team', 'Age', 'Baseline']]
        .set_index('PlayerID')
        .join(attr_deltas)        # deltas first
        .join(mean_attrs)         # then mean final values
        .reset_index()
        .sort_values(['Age', 'Baseline'], ascending=[True, False])
    )
    _write_sheet('Attributes', attributes)

    # ── Sheet 3: Team Summary ─────────────────────────────────────────────────
    # Which franchises benefit most from this progression config?
    # Wide box = inconsistent player ages/quality on that team.
    team_summary = (
        ppl.groupby('Team')['MeanDelta']
           .agg(Players='count',
                Mean_Delta='mean',
                Std_Delta='std',
                Min_Delta='min',
                Max_Delta='max',
                Pct_Improved=lambda s: (s > 0).mean())
           .round(3)
           .sort_values('Mean_Delta', ascending=False)
           .reset_index()
    )
    _write_sheet('Team Summary', team_summary)

    # ── Sheet 4: Age Summary ──────────────────────────────────────────────────
    _write_sheet('Age Summary', age_summary.reset_index())

    # ── Sheet 5: Stat Leverage ────────────────────────────────────────────────
    _write_sheet('Stat Leverage', corr)

    # ── Sheet 6: God Progs (conditional) ─────────────────────────────────────
    if not gp.empty:
        _write_sheet('God Progs', gp)
    elif 'God Progs' in wb.sheetnames:
        ws = wb['God Progs']
        for row in ws.iter_rows():
            for cell in row: cell.value = None
        ws.cell(1, 1, 'No god progressions occurred in this run.')

    # ── Sheet 7: All Runs ─────────────────────────────────────────────────────
    # Complete dump, no aggregation.
    # Sorted by PlayerID then Run. Filter by PlayerID in Excel to drill into
    # any individual player without writing code.
    all_runs_cols = (
        ['PlayerID', 'Name', 'Team', 'Age', 'Run', 'RunSeed',
         'Baseline', 'Ovr', 'Delta', 'PctChange', 'AboveBaseline',
         'Composite', 'PER', 'DWS', 'EWA']
        + [c for c in PROG_ATTRS if c in dataraw.columns]
        + [c for c in dataraw.columns if c not in
           ['PlayerID','Name','Team','Age','Run','RunSeed',
            'Baseline','Ovr','Delta','PctChange','AboveBaseline',
            'Composite','PER','DWS','EWA'] + PROG_ATTRS]
    )
    all_runs = (dataraw
                .reindex(columns=[c for c in all_runs_cols if c in dataraw.columns])
                .sort_values(['PlayerID', 'Run'])
                .reset_index(drop=True))
    _write_sheet('All Runs', all_runs)

    # Players sheet is first and active
    if 'Players' in wb.sheetnames:
        wb.active = wb['Players']
        wb.move_sheet('Players', offset=-wb.sheetnames.index('Players'))

    wb.save(xlsx_path)
    print(f'  → {xlsx_path}  ({len(wb.sheetnames)} sheets)')


# ── Entry point ────────────────────────────────────────────────────────────────

def generate_analysis(run_dir: Optional[str] = None) -> None:
    """
    Full post-simulation analysis pipeline.

    Parameters
    ----------
    run_dir : Path to outputs/{RUN_TS}/.
              None = auto-discovers the most recently written run.

    Reads
    -----
    {run_dir}/raw/outputs.csv      - long-format simulation results (required)
    {run_dir}/raw/godprogs.json    - god-prog event log (optional)
    data/input.csv                 - original input ratings, must include index:
                                     use data.to_csv('data/input.csv'), NOT index=False

    Writes
    ------
    {run_dir}/analysis.xlsx        - styled workbook
    {run_dir}/charts/0N_*.png      - 8 diagnostic charts
    """
    base       = Path(run_dir) if run_dir else _find_latest_run()
    raw_dir    = base / 'raw'
    charts_dir = base / 'charts'
    charts_dir.mkdir(parents=True, exist_ok=True)

    sep = '─' * 58
    print(f'\n{sep}\n  NoEyeTest - Tuner Analysis\n{sep}')

    df, gp    = _load(raw_dir)
    n_runs    = df['Run'].nunique()
    n_players = df['PlayerID'].nunique()   # keyed on PlayerID, not Name
    print(f'  {n_runs} runs  ×  {n_players} players  =  {len(df):,} rows\n')

    baseline = _load_baseline(df)
    ppl      = _per_player(df)
    ad       = _attr_delta(df, baseline)   # computed once, shared by charts 3 and 5

    age_summary = (
        df.assign(AgeGroup=_age_group(df['Age']))
          .groupby('AgeGroup', observed=True)['Delta']
          .agg(Count='count', Mean='mean', Median='median', Std='std',
               Q25=lambda s: s.quantile(0.25), Q75=lambda s: s.quantile(0.75),
               PctPositive=lambda s: (s > 0).mean())
          .round(3)
    )
    corr = pd.DataFrame([
        {'Stat': col,
         'PearsonR': round(scipy_stats.pearsonr(ppl[col], ppl['MeanDelta'])[0], 3),
         'PValue':   round(scipy_stats.pearsonr(ppl[col], ppl['MeanDelta'])[1], 4)}
        for col in ['Composite'] + STAT_COLS
    ])

    print('Writing workbook…')
    _write_xlsx(base / 'analysis.xlsx', ppl, df, ad, age_summary, corr, gp)

    print(f'Generating charts → {charts_dir}')
    _apply_style()

    chart_steps = [
        ('Age Tier Profiles',         lambda: _chart1(df,         charts_dir)),
        ('Composite Calibration',     lambda: _chart2(ppl,        charts_dir)),
        ('Physical vs Cognitive',     lambda: _chart3(ad,         charts_dir)),
        ('Player Reliability',        lambda: _chart4(ppl,        charts_dir)),
        ('Attribute Heatmap',         lambda: _chart5(ad, ppl,    charts_dir)),
        ('Composite Tier Separation', lambda: _chart6(ppl, df,    charts_dir)),
        ('Player Outcome Range',      lambda: _chart7(ppl,        charts_dir)),
        ('Convergence',               lambda: _chart8(df,         charts_dir)),
    ]
    for i, (label, fn) in enumerate(chart_steps, 1):
        fn()
        print(f'  [{i}/{len(chart_steps)}] {label}')

    print(f'\nDone.  {len(chart_steps)} charts  ·  {n_players} players  ·  {n_runs} runs')
    print(f'{sep}\n')

def main():
    """CLI entry point for the analysis post-processor."""
    parser = argparse.ArgumentParser(
        description="Post-simulation analysis: generates Excel workbook and diagnostic charts."
    )
    parser.add_argument(
        "run_dir",
        nargs="?",
        default=None,
        help="Path to the specific run directory (e.g., outputs/20241115143022). "
             "If omitted, auto-discovers the most recently written run."
    )
    
    args = parser.parse_args()

    try:
        generate_analysis(args.run_dir)
    except Exception as e:
        print(f"[analysis.py] Fatal error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()