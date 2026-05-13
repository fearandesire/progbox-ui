"""
analysis.py · Progbox, Monte Carlo Analysis

Generates an interactive, standalone HTML dashboard and a comprehensive Excel
workbook from Monte Carlo simulation outputs. Architected as a tuning instrument: rigorous multivariate statistics, variance decomposition,
and actionable visualizations for system tuners.
No longer relies on a hardcoded configuration class! yippee!!

Usage
-----
    from analysis import generate_analysis
    generate_analysis()                  # auto-discovers latest run
    generate_analysis('outputs/DATE')    # explicit path

    CLI:
    python analysis.py [run_dir]
"""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
import plotly.graph_objects as go
from plotly.offline import get_plotlyjs
from plotly.subplots import make_subplots
from scipy import stats as scipy_stats
from scipy.optimize import curve_fit
from scipy.stats import gaussian_kde
from openpyxl import Workbook
from openpyxl.utils import get_column_letter
from openpyxl.utils.dataframe import dataframe_to_rows


# ═══════════════════════════════════════════════════════════════════════════════
# LOGGING
# ═══════════════════════════════════════════════════════════════════════════════

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION : Immutable engine constants shared across all analysis runs.
# ═══════════════════════════════════════════════════════════════════════════════

class Config:
    """Engine constants that never change between simulation configs."""

    # OVR calculation order and coefficients (game engine formula)
    OVR_CALC_ORDER: List[str] = [
        'Hgt', 'Str', 'Spd', 'Jmp', 'End', 'Ins',
        'Dnk', 'FT',  '3Pt', 'oIQ', 'dIQ', 'Drb',
        'Pss', '2Pt', 'Reb',
    ]
    OVR_COEFFS: np.ndarray = np.array(
        [0.159, 0.0777, 0.123, 0.051, 0.0632, 0.0126,
         0.0286, 0.0202, 0.0726, 0.133, 0.159, 0.059,
         0.062,  0.01,   0.01], dtype=float,
    )
    OVR_CENTERS: np.ndarray = np.array(
        [47.5, 50.2, 50.8, 48.7, 39.9, 42.4,
         49.5, 47.0, 47.1, 46.8, 46.7, 54.8,
         51.3, 47.0, 51.4], dtype=float,
    )

    # Non-attribute metadata columns excluded from stat discovery
    META_COLS: List[str] = [
        'Run', 'RunSeed', 'Name', 'Team', 'Age', 'PlayerID',
        'Baseline', 'Ovr', 'Delta', 'PctChange', 'AboveBaseline',
    ]

    # Thresholds and limits
    MAX_HEATMAP_ROWS: int = 80
    MAX_RANGE_ROWS: int = 100
    MIN_KDE_SAMPLES: int = 10
    MIN_OLS_SAMPLES: int = 8
    MCSE_CONVERGENCE_THRESHOLD: float = 0.5  # OVR points


# ═══════════════════════════════════════════════════════════════════════════════
# AESTHETICS : Centralized colour palette and Plotly template.
# ═══════════════════════════════════════════════════════════════════════════════

AGE_COLORS = {'Youngest': '#2563eb', 'Middle': '#f97316', 'Oldest': '#dc2626'}
Q_COLORS   = {'Q1': '#dc2626', 'Q2': '#f97316', 'Q3': '#16a34a', 'Q4': '#2563eb'}
DIVERGING_CMAP = [
    '#0d47a1', '#42a5f5', '#e3f2fd', '#ffffff',
    '#fce4ec', '#ef5350', '#b71c1c',
]

_PLOTLY_TEMPLATE = go.layout.Template(layout=go.Layout(
    font=dict(
        family='Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        color='#1e293b',
    ),
    paper_bgcolor='#ffffff',
    plot_bgcolor='#f8fafc',
    margin=dict(l=80, r=40, t=100, b=80),
    hoverlabel=dict(
        bgcolor='rgba(255,255,255,0.95)', bordercolor='#cbd5e1',
        font_size=13, font_color='#0f172a', font_family='Inter, Roboto, sans-serif',
    ),
    xaxis=dict(
        gridcolor='#e2e8f0', zerolinecolor='#94a3b8',
        title=dict(standoff=15, font=dict(size=13, color='#334155')),
        tickfont=dict(size=11, color='#64748b'), automargin=True,
    ),
    yaxis=dict(
        gridcolor='#e2e8f0', zerolinecolor='#94a3b8',
        title=dict(standoff=15, font=dict(size=13, color='#334155')),
        tickfont=dict(size=11, color='#64748b'), automargin=True,
    ),
    legend=dict(
        bgcolor='rgba(255,255,255,0.8)', bordercolor='#e2e8f0', borderwidth=1,
        font=dict(size=12, color='#1e293b'),
    ),
    title=dict(font=dict(size=20, color='#0f172a'), x=0.05, pad=dict(t=20, b=20)),
))


# ═══════════════════════════════════════════════════════════════════════════════
# PURE UTILITIES : Stateless helper functions with no side effects.
# ═══════════════════════════════════════════════════════════════════════════════

def hex_to_rgba(hex_color: str, alpha: float) -> str:
    """Convert a hex colour string to an RGBA string for Plotly fills."""
    h = hex_color.lstrip('#')
    r, g, b = (int(h[i:i+2], 16) for i in (0, 2, 4))
    return f"rgba({r},{g},{b},{alpha})"


def display_label(name: str, team: object) -> str:
    """Format a player name and team into a human-readable label."""
    team_str = str(team) if pd.notna(team) else "FA"
    return f"{name} ({team_str})"


def qcut_within(s: pd.Series) -> pd.Categorical:
    """Safely compute quartile labels within a group, handling ties.

    Uses rank(method='first') to break ties, guaranteeing equal-sized bins
    when enough distinct values exist.  Falls back to all-Q2 on failure.
    """
    if len(s) < 4:
        return pd.Categorical(['Q2'] * len(s), categories=['Q1', 'Q2', 'Q3', 'Q4'])
    try:
        return pd.qcut(s.rank(method='first'), 4, labels=['Q1', 'Q2', 'Q3', 'Q4'])
    except ValueError:
        return pd.Categorical(['Q2'] * len(s), categories=['Q1', 'Q2', 'Q3', 'Q4'])


def zscore(s: pd.Series) -> pd.Series:
    """Z-score standardisation.  Returns zeros when standard deviation is zero."""
    std = s.std()
    if std == 0 or pd.isna(std):
        return pd.Series(0.0, index=s.index, dtype=float)
    return (s - s.mean()) / std


def logistic(x: np.ndarray, b0: float, b1: float) -> np.ndarray:
    """Standard logistic function for curve-fitting survival probabilities."""
    return 1.0 / (1.0 + np.exp(-(b0 + b1 * x)))


def ols_fit(X: np.ndarray, y: np.ndarray) -> Tuple[np.ndarray, np.ndarray, float]:
    """Ordinary Least Squares via QR decomposition with homoskedastic SEs.

    Numerically stable: avoids forming X'X explicitly.  Returns
    (beta, standard_errors, r_squared).

    Raises ValueError when n <= p (insufficient degrees of freedom).
    Raises np.linalg.LinAlgError when X is rank-deficient.
    """
    n, p = X.shape
    if n <= p:
        raise ValueError(f"Insufficient df: n={n} <= p={p}")

    Q, R = np.linalg.qr(X)
    beta = np.linalg.solve(R, Q.T @ y)

    residuals = y - X @ beta
    rss = np.sum(residuals ** 2)
    tss = np.sum((y - y.mean()) ** 2)
    r_squared = 1.0 - rss / tss if tss > 0 else 0.0

    sigma2 = rss / (n - p)
    R_inv = np.linalg.solve(R, np.eye(p))
    var_beta = sigma2 * (R_inv @ R_inv.T)
    se = np.sqrt(np.maximum(np.diag(var_beta), 0.0))

    return beta, se, r_squared


def _empty_fig(title: str) -> go.Figure:
    """Return a placeholder figure with an explanatory title."""
    return go.Figure().update_layout(
        title=f"{title} :-> INSUFFICIENT DATA", template=_PLOTLY_TEMPLATE,
    )

def bootstrap_ci(data: np.ndarray, statistic=np.mean,
                 n_boot: int = 5000, ci: float = 0.95) -> Tuple[float, float, float]:
    """Bootstrap confidence interval. Returns (point_estimate, lower, upper)."""
    n = len(data)
    point = float(statistic(data))
    boots = np.array([statistic(np.random.choice(data, n, replace=True))
                      for _ in range(n_boot)])
    alpha = (1 - ci) / 2
    return point, float(np.percentile(boots, 100 * alpha)), float(np.percentile(boots, 100 * (1 - alpha)))


def cohens_d(g1: np.ndarray, g2: np.ndarray) -> float:
    """Cohen's d effect size (pooled std, Hedges' correction for small samples)."""
    n1, n2 = len(g1), len(g2)
    if n1 + n2 < 3:
        return 0.0
    var1, var2 = np.var(g1, ddof=1), np.var(g2, ddof=1)
    pooled_std = np.sqrt(((n1 - 1) * var1 + (n2 - 1) * var2) / (n1 + n2 - 2))
    if pooled_std == 0:
        return 0.0
    d = (np.mean(g1) - np.mean(g2)) / pooled_std
    # Hedges' correction
    correction = 1 - 3 / (4 * (n1 + n2) - 9)
    return d * correction


def partial_corr(x: np.ndarray, y: np.ndarray,
                 Z: np.ndarray) -> Tuple[float, float]:
    """Partial Pearson correlation of x,y controlling for columns of Z.
    Returns (r_partial, p_value).
    """
    from scipy.stats import pearsonr
    if Z.shape[1] == 0:
        return pearsonr(x, y)
    try:
        Q, R = np.linalg.qr(np.column_stack([np.ones(len(Z)), Z]))
        coef_x = np.linalg.solve(R, Q.T @ x)
        coef_y = np.linalg.solve(R, Q.T @ y)
        res_x = x - np.column_stack([np.ones(len(Z)), Z]) @ coef_x
        res_y = y - np.column_stack([np.ones(len(Z)), Z]) @ coef_y
        return pearsonr(res_x, res_y)
    except np.linalg.LinAlgError:
        return 0.0, 1.0


def mahalanobis_distance(X: np.ndarray) -> np.ndarray:
    """Mahalanobis distance of each row from the multivariate centroid."""
    cov = np.cov(X, rowvar=False)
    try:
        cov_inv = np.linalg.inv(cov)
    except np.linalg.LinAlgError:
        cov_inv = np.linalg.pinv(cov)
    centroid = X.mean(axis=0)
    diff = X - centroid
    return np.sqrt(np.einsum('ij,jk,ik->i', diff, cov_inv, diff))


def benjamini_hochberg(p_values: np.ndarray, alpha: float = 0.05) -> np.ndarray:
    """BH FDR correction. Returns boolean mask of significant results."""
    n = len(p_values)
    if n == 0:
        return np.array([], dtype=bool)
    order = np.argsort(p_values)
    sorted_p = p_values[order]
    thresholds = alpha * np.arange(1, n + 1) / n
    sig = np.zeros(n, dtype=bool)
    # Find largest k where p_(k) <= alpha * k / n
    below = np.where(sorted_p <= thresholds)[0]
    if len(below) > 0:
        sig[order[:below[-1] + 1]] = True
    return sig


def sharpe_ratio(mean_delta: pd.Series, std_delta: pd.Series,
                 benchmark: float = 0.0) -> pd.Series:
    """Sharpe-analogue: risk-adjusted OVR progression."""
    return pd.Series(
        np.where(std_delta > 0, (mean_delta - benchmark) / std_delta, 0.0),
        index=mean_delta.index, dtype=float,
    )


def kendalls_w(rank_matrix: np.ndarray) -> float:
    """Kendall's W coefficient of concordance for rank stability."""
    n_items, n_judges = rank_matrix.shape
    if n_items < 2 or n_judges < 2:
        return np.nan
    R = rank_matrix.sum(axis=1)
    S = np.sum((R - R.mean()) ** 2)
    return 12 * S / (n_judges ** 2 * (n_items ** 3 - n_items))


# ═══════════════════════════════════════════════════════════════════════════════
# DATA LOADER -> Single responsibility: read files and validate structure.
# ═══════════════════════════════════════════════════════════════════════════════

class DataLoader:
    """Loads and validates simulation inputs and outputs from disk."""

    def __init__(self, base: Path = Path('../outputs/')):
        self._base = base

    def find_latest_run(self) -> Path:
        """Return the most recently modified run directory."""
        candidates = sorted(
            self._base.glob('*/raw/outputs.csv'),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if not candidates:
            raise FileNotFoundError(f"No simulation outputs found under {self._base}/")
        run_dir = candidates[0].parent.parent
        logger.info(f"Auto-discovered run: {run_dir}")
        return run_dir

    @staticmethod
    def load_sim_data(raw_dir: Path) -> pd.DataFrame:
        """Load the post-simulation outputs.csv."""
        path = raw_dir / 'outputs.csv'
        if not path.exists():
            raise FileNotFoundError(f"Missing output file: {path}")
        df = pd.read_csv(path)
        logger.info(f"Loaded {len(df):,} post-simulation rows from {path}")
        return df

    @staticmethod
    def load_baseline() -> pd.DataFrame:
        """Load pre-simulation baseline attributes from data/input.csv."""
        path = Path('data/input.csv')
        if path.exists():
            base = pd.read_csv(path, index_col=0)
            base.index.name = 'PlayerID'
            logger.info(f"Loaded PRE-SIM baselines for {len(base)} players from {path}")
            return base
        logger.error("CRITICAL: data/input.csv not found, attribute deltas will be inaccurate!")
        return pd.DataFrame()


# ═══════════════════════════════════════════════════════════════════════════════
# DATA PROCESSOR : Transforms raw data into analysis-ready aggregations.
#
# All heavy computation is done once (lazy properties are cached).
# Each public property produces one well-defined output from the raw inputs.
# ═══════════════════════════════════════════════════════════════════════════════

class DataProcessor:
    """Computes all derived datasets from raw simulation data."""

    def __init__(self, df: pd.DataFrame, baseline: pd.DataFrame):
        self._df = df
        self._baseline = baseline

        # Column classification
        self.varying_attrs: List[str] = []
        self.fixed_attrs: List[str] = []
        self.input_stats: List[str] = []
        self._discover_columns()

        # Cached aggregates
        self._ppl: Optional[pd.DataFrame] = None
        self._attr_deltas: Optional[pd.DataFrame] = None
        self._age_summary: Optional[pd.DataFrame] = None
        self._icc_data: Optional[pd.DataFrame] = None
        self._top_drivers: Optional[List[str]] = None
        self._convergence: Optional[Dict] = None

    # ── Column Discovery ──────────────────────────────────────────────────

    def _discover_columns(self) -> None:
        """Classify numeric columns into varying attrs, fixed attrs, and input stats."""
        numeric_cols = self._df.select_dtypes(include=[np.number]).columns.tolist()
        potential = [c for c in numeric_cols if c not in Config.META_COLS]

        for col in potential:
            per_player_std = self._df.groupby('PlayerID')[col].std()
            if per_player_std.mean() > 0.01:
                self.varying_attrs.append(col)
            elif col in Config.OVR_CALC_ORDER:
                self.fixed_attrs.append(col)
            elif self._df[col].std() > 0.01:
                self.input_stats.append(col)

        logger.info(
            f"Discovered {len(self.varying_attrs)} varying, "
            f"{len(self.fixed_attrs)} fixed, {len(self.input_stats)} input stats."
        )

    # ── Age Tier Assignment ───────────────────────────────────────────────

    @staticmethod
    def assign_age_tiers(ages: pd.Series) -> pd.Series:
        """Bin ages into 3 quantile-based tiers: Youngest, Middle, Oldest.

        Falls back to a single tier when there are fewer than 3 distinct ages.
        """
        if ages.nunique() < 3:
            return pd.Series(['Single Tier'] * len(ages), index=ages.index)
        try:
            return pd.qcut(ages, q=3, labels=['Youngest', 'Middle', 'Oldest'], duplicates='drop')
        except ValueError:
            return pd.Series(['Single Tier'] * len(ages), index=ages.index)

    # ── Per-Player Summary (cached) ──────────────────────────────────────

    @property
    def per_player(self) -> pd.DataFrame:
        """One summary row per player: mean, std, quantiles of OVR Delta."""
        if self._ppl is not None:
            return self._ppl

        df = self._df
        agg_map = {
            'Name':        ('Name', 'first'),
            'Team':        ('Team', 'first'),
            'Age':         ('Age', 'first'),
            'Baseline':    ('Baseline', 'first'),
            'MeanDelta':   ('Delta', 'mean'),
            'StdDelta':    ('Delta', 'std'),
            'P05_Delta':   ('Delta', lambda s: s.quantile(0.05)),
            'P25_Delta':   ('Delta', lambda s: s.quantile(0.25)),
            'P50_Delta':   ('Delta', 'median'),
            'P75_Delta':   ('Delta', lambda s: s.quantile(0.75)),
            'P95_Delta':   ('Delta', lambda s: s.quantile(0.95)),
            'PctPositive': ('Delta', lambda s: (s > 0).mean()),
            'MeanOvr':     ('Ovr', 'mean'),
        }
        # Carry forward any input stats for downstream analysis
        for col in self.input_stats:
            if col in df.columns and col not in agg_map:
                agg_map[col] = (col, 'first')

        ppl = df.groupby('PlayerID', sort=True).agg(**agg_map).reset_index()
        ppl['AgeTier'] = self.assign_age_tiers(ppl['Age'])
        ppl['Label'] = [display_label(n, t) for n, t in zip(ppl['Name'], ppl['Team'])]

        # Age-adjusted Z-score: performance relative to tier mean
        tier_mu_sigma = ppl.groupby('AgeTier')['MeanDelta'].agg(['mean', 'std'])
        ppl = ppl.merge(tier_mu_sigma, left_on='AgeTier', right_index=True,
                        how='left', suffixes=('', '_tier'))
        ppl['AgeAdjZ'] = np.where(
            ppl['std'] > 0,
            (ppl['MeanDelta'] - ppl['mean']) / ppl['std'],
            0.0,
        )
        ppl.drop(columns=['mean', 'std'], inplace=True)

        self._ppl = ppl
        return ppl

    # ── Top Drivers (cached) ─────────────────────────────────────────────

    @property
    def top_drivers(self) -> List[str]:
        """Top N baseline stats most directionally correlated with MeanDelta."""
        if self._top_drivers is not None:
            return self._top_drivers

        ppl = self.per_player
        candidates = ['Age', 'Baseline'] + self.input_stats
        scored = []
        for col in candidates:
            if col in ppl.columns and ppl[col].nunique() > 1:
                r, _ = scipy_stats.spearmanr(ppl[col], ppl['MeanDelta'])
                scored.append((col, abs(r), r))

        scored.sort(key=lambda x: x[1], reverse=True)
        self._top_drivers = [s[0] for s in scored[:3]]
        logger.info(f"Top progression drivers: {self._top_drivers}")
        return self._top_drivers

    # ── Attribute Deltas vs Baseline (cached) ─────────────────────────────

    @property
    def attr_deltas(self) -> pd.DataFrame:
        """Mean simulated attribute delta vs pre-simulation baseline."""
        if self._attr_deltas is not None:
            return self._attr_deltas
        if self._baseline.empty:
            self._attr_deltas = pd.DataFrame()
            return self._attr_deltas

        avail = [c for c in self.varying_attrs
                 if c in self._baseline.columns and c in self._df.columns]
        mean_sim = self._df.groupby('PlayerID')[avail].mean()
        shared = mean_sim.index.intersection(self._baseline.index)
        delta = mean_sim.loc[shared] - self._baseline[avail].loc[shared]
        delta = delta.join(self._df.groupby('PlayerID')['Age'].first())
        self._attr_deltas = delta
        return delta

    # ── Age Summary (cached) ─────────────────────────────────────────────

    @property
    def age_summary(self) -> pd.DataFrame:
        """OVR Delta statistics by dynamic age tier."""
        if self._age_summary is not None:
            return self._age_summary

        tmp = self._df.assign(AgeTier=self.assign_age_tiers(self._df['Age']))
        self._age_summary = (
            tmp.groupby('AgeTier', observed=True)['Delta']
            .agg(
                Count='count', Mean='mean', Median='median', Std='std',
                Q25=lambda s: s.quantile(0.25), Q75=lambda s: s.quantile(0.75),
                PctPositive=lambda s: (s > 0).mean(),
            )
            .round(3)
        )
        return self._age_summary

    # ── Variance Decomposition / ICC (cached) ────────────────────────────

    @property
    def icc_data(self) -> pd.DataFrame:
        """Intraclass Correlation Coefficient per varying attribute.

        ICC(1) = σ²_between / (σ²_between + σ²_within)

        High ICC → outcomes determined by player identity (low RNG).
        Low  ICC → outcomes dominated by simulation noise (high RNG).
        Critical for a system tuner to know which attributes are "under control"
        versus "purely random."
        """
        if self._icc_data is not None:
            return self._icc_data

        rows = []
        for attr in self.varying_attrs:
            if attr not in self._df.columns:
                continue
            grp = self._df.groupby('PlayerID')[attr]
            player_means = grp.mean()
            player_vars  = grp.var()

            var_between = player_means.var()
            var_within  = player_vars.mean()
            total_var   = var_between + var_within
            icc = var_between / total_var if total_var > 0 else np.nan

            rows.append({
                'Attribute': attr,
                'Var_Between': var_between,
                'Var_Within': var_within,
                'Total_Var': total_var,
                'ICC': icc,
            })

        self._icc_data = pd.DataFrame(rows).sort_values('ICC', ascending=True)
        return self._icc_data

    # ── Convergence Diagnostics ───────────────────────────────────────────

    @property
    def convergence(self) -> Dict:
        """MCSE and convergence diagnostics per player.

        MCSE = σ_within / √N  (Monte Carlo Standard Error of the mean Delta).

        Returns dict with:
          max_mcse       - largest MCSE across all players
          pct_converged  - fraction with MCSE < threshold
          top_volatile   - PlayerIDs with highest StdDelta (for charting)
          player_stats   - DataFrame of per-player mean, std, N, MCSE
        """
        if self._convergence is not None:
            return self._convergence

        grp = self._df.groupby('PlayerID')['Delta']
        stats = grp.agg(Mean='mean', Std='std', N='count')
        stats['MCSE'] = stats['Std'] / np.sqrt(stats['N'])
        stats['MCSE'].replace([np.inf, np.nan], 0, inplace=True)

        self._convergence = {
            'max_mcse':      stats['MCSE'].max(),
            'pct_converged': (stats['MCSE'] < Config.MCSE_CONVERGENCE_THRESHOLD).mean(),
            'top_volatile':  stats.nlargest(6, 'Std').index.tolist(),
            'player_stats':  stats,
        }
        return self._convergence

    # ── Attribute Progression by Age Tier ─────────────────────────────────

    @property
    def attr_progression_by_age(self) -> pd.DataFrame:
        """Mean attribute delta per age tier (requires baseline data)."""
        ad = self.attr_deltas
        if ad.empty:
            return pd.DataFrame()
        avail = [c for c in self.varying_attrs if c in ad.columns and c != 'Age']
        ad_c = ad.copy()
        ad_c['AgeTier'] = self.assign_age_tiers(ad_c['Age'])

        rows = []
        for tier in ad_c['AgeTier'].unique():
            sub = ad_c[ad_c['AgeTier'] == tier]
            for attr in avail:
                vals = sub[attr].dropna()
                if len(vals) == 0:
                    continue
                rows.append({
                    'AgeTier': tier, 'Attribute': attr,
                    'MeanDelta': vals.mean(), 'SE': vals.sem(),
                })
        return pd.DataFrame(rows)
    
    @property
    def effect_sizes(self) -> pd.DataFrame:
        """Pairwise Cohen's d and Mann-Whitney U between age tiers."""
        df = self._df.assign(AgeTier=self.assign_age_tiers(self._df['Age']))
        tiers = [t for t in AGE_COLORS if t in df['AgeTier'].values]
        rows = []
        for i, t1 in enumerate(tiers):
            for t2 in tiers[i + 1:]:
                g1 = df[df['AgeTier'] == t1]['Delta'].dropna().values
                g2 = df[df['AgeTier'] == t2]['Delta'].dropna().values
                d = cohens_d(g1, g2)
                _, p_mw = scipy_stats.mannwhitneyu(g1, g2, alternative='two-sided')
                ks_stat, p_ks = scipy_stats.ks_2samp(g1, g2)
                _, ci_lo, ci_hi = bootstrap_ci(g1 - g2.mean(), n_boot=2000)
                rows.append({
                    'Comparison': f"{t1} vs {t2}", 'Cohen_d': d,
                    'MannWhitney_p': p_mw, 'KS_stat': ks_stat, 'KS_p': p_ks,
                    'MeanDiff': g1.mean() - g2.mean(),
                    'Boot_CI_lo': ci_lo, 'Boot_CI_hi': ci_hi,
                })
        return pd.DataFrame(rows)


    @property
    def rank_stability(self) -> Dict:
        """Kendall's W + per-player rank coefficient of variation."""
        pivot = self._df.pivot_table(index='PlayerID', columns='Run', values='Ovr')
        pivot = pivot.dropna()
        if pivot.shape[1] < 2 or pivot.shape[0] < 3:
            return {'W': np.nan, 'rank_cv': pd.Series(dtype=float)}

        rank_matrix = pivot.rank(axis=0).values
        W = kendalls_w(rank_matrix)

        ranks = pivot.rank(axis=0)
        rank_cv = (ranks.std(axis=1) / ranks.mean(axis=1)).rename('RankCV')
        return {'W': W, 'rank_cv': rank_cv, 'n_players': pivot.shape[0],
                'n_runs': pivot.shape[1]}


    @property
    def risk_adjusted(self) -> pd.DataFrame:
        """Sharpe analogue, certainty equivalents, conditional probabilities."""
        ppl = self.per_player.copy()
        ppl['Sharpe'] = sharpe_ratio(ppl['MeanDelta'], ppl['StdDelta'])

        # Certainty equivalent (CARA utility, A=1): CE = μ − 0.5·σ²
        ppl['CertEquiv'] = ppl['MeanDelta'] - 0.5 * ppl['StdDelta'] ** 2

        # P(Δ > 2) and P(Δ < −2) under normal approximation
        from scipy.stats import norm
        sigma = ppl['StdDelta'].replace(0, np.nan)
        ppl['P_Gain2'] = 1 - norm.cdf(2, loc=ppl['MeanDelta'], scale=sigma)
        ppl['P_Loss2'] = norm.cdf(-2, loc=ppl['MeanDelta'], scale=sigma)
        ppl['OddsRatio'] = ppl['P_Gain2'] / ppl['P_Loss2'].replace(0, np.nan)
        return ppl


    @property
    def outlier_players(self) -> pd.DataFrame:
        """Mahalanobis distance outlier detection in (MeanΔ, StdΔ) space."""
        ppl = self.per_player
        cols = ['MeanDelta', 'StdDelta']
        valid = ppl.dropna(subset=cols)
        if len(valid) < 4:
            return pd.DataFrame()
        X = valid[cols].values
        dists = mahalanobis_distance(X)
        p_vals = 1 - scipy_stats.chi2.cdf(dists ** 2, df=2)

        result = valid.copy()
        result['MahalDist'] = dists
        result['Outlier_p'] = p_vals
        return result.sort_values('MahalDist', ascending=False)


    @property
    def compression_analysis(self) -> pd.DataFrame:
        """OVR ceiling compression: how much variance narrows at high baselines."""
        ppl = self.per_player
        if len(ppl) < 10:
            return pd.DataFrame()

        ppl_sorted = ppl.sort_values('Baseline')
        window = max(10, len(ppl) // 5)
        rows = []
        for start in range(0, len(ppl_sorted) - window + 1, window // 2):
            chunk = ppl_sorted.iloc[start:start + window]
            rows.append({
                'BaselineMid': chunk['Baseline'].mean(),
                'StdDelta': chunk['StdDelta'].mean(),
                'MeanDelta': chunk['MeanDelta'].mean(),
                'Range': chunk['P95_Delta'].mean() - chunk['P05_Delta'].mean(),
                'Sharpe': chunk['MeanDelta'].mean() / chunk['StdDelta'].mean()
                        if chunk['StdDelta'].mean() > 0 else 0,
                'N': len(chunk),
            })
        return pd.DataFrame(rows)


# ═══════════════════════════════════════════════════════════════════════════════
# CHART BUILDER - Generates Plotly figures from processed data.
#
# Each method produces one self-contained figure.  All methods are stateless:
# they read from the DataProcessor and return go.Figure objects.
# ═══════════════════════════════════════════════════════════════════════════════

class ChartBuilder:
    """Generates Plotly figures from processed data."""

    def __init__(self, proc: DataProcessor, df: pd.DataFrame):
        self._proc = proc
        self._df = df

    # Convenience accessors
    @property
    def ppl(self) -> pd.DataFrame:
        return self._proc.per_player

    @property
    def ad(self) -> pd.DataFrame:
        return self._proc.attr_deltas

    @property
    def varying(self) -> List[str]:
        return self._proc.varying_attrs

    @property
    def input_stats(self) -> List[str]:
        return self._proc.input_stats

    @property
    def top_drivers(self) -> List[str]:
        return self._proc.top_drivers

    # ── Build All ─────────────────────────────────────────────────────────

    def build_all(self) -> Dict[str, go.Figure]:
        import time
        
        chart_methods = {
            "1. Age Tier Outcome Profiles":       self.chart_age_tiers,
            "2. Multi-Driver Calibration":        self.chart_multi_driver,
            "3. Top Attribute Divergence":        self.chart_attr_divergence,
            "4. Player Outcome Reliability":      self.chart_reliability,
            "5. Attribute Movement Heatmap":      self.chart_attr_heatmap,
            "6. Tier Separation by Top Driver":   self.chart_tier_separation,
            "7. Player OVR Outcome Range":        self.chart_outcome_range,
            "8. Convergence Diagnostics":         self.chart_convergence,
            "9. Variance Decomposition (ICC)":    self.chart_icc,
            "10. Multivariate True Leverage":     self.chart_ols_leverage,
            "11. Volatility Landscape":           self.chart_volatility_landscape,
            "12. Attribute Delta Co-movement":    self.chart_attr_comovement,
            "13. Per-Attribute Progression":      self.chart_attr_progression,
            "14. Cap Ceiling & Probability":      self.chart_cap_survival,
            "15. Age-Adjusted Over/Under":        self.chart_age_adjusted,
            "16. Tail Risk Analysis":             self.chart_tail_risk,
            "17. Interaction Surface":            self.chart_interaction,
            "18. Effect Size Forest Plot":        self.chart_effect_sizes,
            "19. Risk-Adjusted Efficiency":       self.chart_risk_adjusted,
            "20. Rank Stability (Kendall's W)":   self.chart_rank_stability,
            "21. Outlier Detection (Mahalanobis)": self.chart_outlier_detection,
            "22. Funnel Plot (Heteroscedasticity)": self.chart_funnel,
            "23. Conditional Probability Map":    self.chart_conditional_prob,
            "24. Full Input Driver Ranking":      self.chart_full_driver_importance,
            "25. Partial Dependence (Nonlinearity)": self.chart_partial_dependence,
            "26. Input→Output Sensitivity Matrix": self.chart_input_sensitivity_matrix,
            "27. Incremental R² Waterfall":        self.chart_incremental_r2,
            "28. Pairwise Interaction Strength":    self.chart_interaction_strength,
        }
        
        charts = {}
        total = len(chart_methods)
        
        for i, (title, method) in enumerate(chart_methods.items(), 1):
            start_time = time.time()
            logger.info(f"Generating chart [{i}/{total}]: {title}...")
            try:
                fig = method()
                elapsed = time.time() - start_time
                # Check if it returned an empty placeholder
                is_placeholder = "INSUFFICIENT DATA" in (fig.layout.title.text or "")
                status = "SKIPPED (Insufficient Data)" if is_placeholder else f"DONE ({elapsed:.2f}s)"
                charts[title] = fig
                logger.info(f"  -> {status}")
            except Exception as e:
                elapsed = time.time() - start_time
                logger.error(f"  -> FAILED ({elapsed:.2f}s): {type(e).__name__}: {e}")
                charts[title] = _empty_fig(f"{title} - ERROR")
                
        return charts

    # ── 1. Age Tier Outcome Profiles (KDE) ───────────────────────────────

    def chart_age_tiers(self) -> go.Figure:
        """KDE of OVR Delta by age tier - the core distributional view."""
        df = self._df.assign(AgeTier=DataProcessor.assign_age_tiers(self._df['Age']))
        fig = go.Figure()

        for group, color in AGE_COLORS.items():
            vals = df[df['AgeTier'] == group]['Delta'].dropna().values
            if len(vals) < Config.MIN_KDE_SAMPLES:
                continue
            if np.std(vals) < 1e-10:
                # Degenerate: constant delta - mark with vertical line
                fig.add_vline(x=vals[0], line_dash="dash", line_color=color,
                              annotation_text=f"{group}: const {vals[0]:.1f}")
                continue

            kde = gaussian_kde(vals, bw_method='scott')
            x_grid = np.linspace(vals.min() - 3, vals.max() + 3, 300)
            density = kde(x_grid)

            fig.add_trace(go.Scatter(
                x=x_grid, y=density, name=group, mode='lines',
                fill='tozeroy', fillcolor=hex_to_rgba(color, 0.15),
                line=dict(color=color, width=3, shape='spline'),
                hovertemplate=f'<b>{group}</b><br>Δ: %{{x:.1f}}<br>Density: %{{y:.4f}}<extra></extra>',
            ))
            mean_val = float(np.mean(vals))
            fig.add_vline(
                x=mean_val, line_dash="dash", line_color=color, line_width=1.5,
                annotation_text=f"μ={mean_val:.1f}",
                annotation_position="top left", annotation_font_color=color,
            )
        
        # Pairwise KS tests between tiers
        ks_annotations = []
        tier_groups = {
            g: df[df['AgeTier'] == g]['Delta'].dropna().values
            for g in AGE_COLORS if len(df[df['AgeTier'] == g]['Delta'].dropna()) >= Config.MIN_KDE_SAMPLES
        }
        tier_names = list(tier_groups.keys())
        for i in range(len(tier_names)):
            for j in range(i + 1, len(tier_names)):
                ks_stat, ks_p = scipy_stats.ks_2samp(
                    tier_groups[tier_names[i]], tier_groups[tier_names[j]])
                d = cohens_d(tier_groups[tier_names[i]], tier_groups[tier_names[j]])
                sig = "***" if ks_p < 0.001 else "**" if ks_p < 0.01 else "*" if ks_p < 0.05 else ""
                ks_annotations.append(
                    f"{tier_names[i]} vs {tier_names[j]}: KS={ks_stat:.3f} "
                    f"(p={ks_p:.4f}){sig}, d={d:.2f}"
                )
        if ks_annotations:
            fig.add_annotation(
                text="<br>".join(ks_annotations),
                xref="paper", yref="paper", x=0.98, y=0.98,
                showarrow=False, font=dict(size=10, color='#64748b', family="monospace"),
                bgcolor='rgba(255,255,255,0.9)', bordercolor='#e2e8f0', borderwidth=1,
                align='left', xanchor='right', yanchor='top',
            )

        fig.add_vline(x=0, line_width=2, line_color="#1e293b")
        fig.update_layout(
            template=_PLOTLY_TEMPLATE,
            title="1. Age Tier Outcome Profiles",
            xaxis_title="OVR Delta", yaxis_title="Probability Density",
            hovermode='x unified',
        )
        return fig

    # ── 2. Multi-Driver Calibration ──────────────────────────────────────

    def chart_multi_driver(self) -> go.Figure:
        """Scatter of top drivers vs MeanDelta with OLS trend lines."""
        drivers = self.top_drivers
        n = len(drivers)
        if n == 0:
            return _empty_fig("2. Multi-Driver Calibration")

        fig = make_subplots(
            rows=1, cols=n,
            subplot_titles=[f"<b>{d}</b>" for d in drivers],
            horizontal_spacing=0.12,
        )
        ppl = self.ppl

        for i, driver in enumerate(drivers):
            col_idx = i + 1
            for group, color in AGE_COLORS.items():
                sub = ppl[ppl['AgeTier'] == group]
                if sub.empty or driver not in sub.columns:
                    continue

                fig.add_trace(go.Scatter(
                    x=sub[driver], y=sub['MeanDelta'], mode='markers', name=group,
                    marker=dict(color=color, size=7, line=dict(width=1, color='white'), opacity=0.75),
                    customdata=sub[['Label', 'Age', 'Baseline']],
                    hovertemplate=(
                        f"<b>%{{customdata[0]}}</b><br>Age: %{{customdata[1]}}"
                        f"<br>Base: %{{customdata[2]}}<br>{driver}: %{{x:.1f}}"
                        f"<br>Mean Δ: %{{y:.1f}}<extra></extra>"
                    ),
                    showlegend=(i == 0),
                ), row=1, col=col_idx)

                # OLS trend line with r² annotation
                if len(sub) >= Config.MIN_OLS_SAMPLES and sub[driver].std() > 0:
                    # Partial correlation controlling for age and other drivers
                    other_drivers = [d for d in drivers if d != driver]
                    Z_controls = sub[['Age'] + [d for d in other_drivers if d in sub.columns]].values
                    r_partial, p_partial = partial_corr(
                        sub[driver].values, sub['MeanDelta'].values, Z_controls
                    )
                    r_sq_partial = r_partial ** 2

                    # Still plot the simple OLS line for visual reference
                    res = scipy_stats.linregress(sub[driver], sub['MeanDelta'])
                    x_t = np.linspace(sub[driver].min(), sub[driver].max(), 100)
                    fig.add_trace(go.Scatter(
                        x=x_t, y=res.intercept + res.slope * x_t,
                        mode='lines', line=dict(color=color, width=2, dash='dash'),
                        showlegend=False, hoverinfo='skip',
                    ), row=1, col=col_idx)
                    # Annotate with PARTIAL r², not simple r²
                    fig.add_annotation(
                        x=sub[driver].quantile(0.95),
                        y=res.intercept + res.slope * sub[driver].quantile(0.95),
                        text=f"r²<sub>partial</sub>={r_sq_partial:.2f}",
                        showarrow=False, font=dict(color=color, size=11, family="Inter"),
                        xanchor='left', yanchor='bottom', row=1, col=col_idx,
                    )

        fig.update_yaxes(title_text="Mean OVR Delta", row=1, col=1)
        fig.add_hline(y=0, line_width=1, line_color="#94a3b8", row=1, col="all")
        fig.update_layout(
            template=_PLOTLY_TEMPLATE,
            title_text="2. Multi-Driver Calibration", height=500,
        )
        return fig

    # ── 3. Top Attribute Divergence ──────────────────────────────────────

    def chart_attr_divergence(self) -> go.Figure:
        """Mean attribute delta by age tier (top 6 by absolute divergence, ±95% CI)."""
        ad = self.ad
        if ad.empty:
            return _empty_fig("3. Attribute Divergence")

        avail = [c for c in self.varying if c in ad.columns and c != 'Age']
        if not avail:
            return _empty_fig("3. Attribute Divergence")

        top_cols = ad[avail].abs().mean().sort_values(ascending=False).head(6).index.tolist()

        ad_c = ad.copy()
        ad_c['AgeTier'] = DataProcessor.assign_age_tiers(ad_c['Age'])

        rows = []
        for group in AGE_COLORS:
            sub = ad_c[ad_c['AgeTier'] == group]
            if sub.empty:
                continue
            for col in top_cols:
                vals = sub[col].dropna()
                if len(vals) == 0:
                    continue
                sem = vals.sem()
                _, ci_lo, ci_hi = bootstrap_ci(vals.values, n_boot=2000)
                rows.append({
                    'AgeTier': group, 'Attribute': col,
                    'MeanDelta': vals.mean(),
                    'CI_lo': ci_lo - vals.mean(),  # symmetric error bar offsets
                    'CI_hi': ci_hi - vals.mean(),
                })

        data = pd.DataFrame(rows)
        if data.empty:
            return _empty_fig("3. Attribute Divergence")

        fig = go.Figure()
        for group, color in AGE_COLORS.items():
            sub = data[data['AgeTier'] == group]
            fig.add_trace(go.Bar(
                x=sub['Attribute'], y=sub['MeanDelta'], name=group,
                marker_color=color, marker_line_width=0, opacity=0.9,
                error_y=dict(
                    type='data', symmetric=False,
                    array=sub['CI_hi'].values, arrayminus=sub['CI_lo'].abs().values,
                    visible=True, thickness=2, width=4,
                ),
            ))
        fig.add_hline(y=0, line_width=1, line_color="#1e293b")
        fig.update_layout(
            template=_PLOTLY_TEMPLATE,
            title="3. Top Attribute Divergence (±95% CI)",
            xaxis_title="Attribute", yaxis_title="Mean Attr Delta",
            barmode='group', bargap=0.2, bargroupgap=0.1,
        )
        return fig

    # ── 4. Player Outcome Reliability (Risk-Return) ──────────────────────
    def chart_reliability(self) -> go.Figure:
        """Risk-return scatter with Baseline OVR as colour gradient."""
        ppl = self.ppl

        # Colour by Baseline OVR decile, shape by tier
        fig = go.Figure()

        # Single trace with continuous color - much more informative
        fig.add_trace(go.Scatter(
            x=ppl['MeanDelta'], y=ppl['StdDelta'], mode='markers',
            marker=dict(
                color=ppl['Baseline'],
                colorscale='RdYlBu_r',  # Red=high OVR, Blue=low OVR
                size=10, line=dict(width=1, color='white'), opacity=0.85,
                colorbar=dict(title="Baseline OVR", thickness=15, len=0.7),
                showscale=True,
            ),
            customdata=np.column_stack([
                ppl['Label'].values, ppl['Age'].values,
                ppl['Baseline'].values, ppl['PctPositive'].values,
                ppl['AgeTier'].values,
            ]),
            hovertemplate=(
                "<b>%{customdata[0]}</b><br>"
                "Age: %{customdata[1]} | Base: %{customdata[2]:.0f} | Tier: %{customdata[4]}<br>"
                "Mean Δ: %{x:.1f} | Std Δ: %{y:.1f}<br>"
                "Improve %: %{customdata[3]:.0%}<extra></extra>"
            ),
        ))

        med_delta = ppl['MeanDelta'].median()
        med_std = ppl['StdDelta'].median()

        # Quadrant dividers
        fig.add_hline(y=med_std, line_dash="dash", line_color="#94a3b8",
                      annotation_text=f"Median σ: {med_std:.1f}")
        fig.add_vline(x=med_delta, line_dash="dash", line_color="#94a3b8",
                      annotation_text=f"Median Δ: {med_delta:.1f}")
        fig.add_vline(x=0, line_width=2, line_color="#1e293b")

        # Quadrant labels (meaningful for system tuners)
        x_hi = ppl['MeanDelta'].quantile(0.85)
        x_lo = ppl['MeanDelta'].quantile(0.15)
        y_lo = ppl['StdDelta'].quantile(0.15)
        y_hi = ppl['StdDelta'].quantile(0.85)

        for (x, y, txt) in [
            (x_hi, y_lo, "STAR: High gain, Low risk"),
            (x_hi, y_hi, "VOLATILE: High gain, High risk"),
            (x_lo, y_lo, "STABLE: Low gain, Low risk"),
            (x_lo, y_hi, "DANGER: Low gain, High risk"),
        ]:
            fig.add_annotation(x=x, y=y, text=txt, showarrow=False,
                               font=dict(size=9, color='#64748b'),
                               bgcolor='rgba(255,255,255,0.7)')

        fig.update_layout(
            template=_PLOTLY_TEMPLATE,
            title="4. Player Outcome Reliability (Colour = Baseline OVR)",
            xaxis_title="Mean OVR Delta (Direction)",
            yaxis_title="Std OVR Delta (Volatility)",
            hovermode='closest',
        )
        return fig

    # ── 5. Attribute Movement Heatmap ────────────────────────────────────

    def chart_attr_heatmap(self) -> go.Figure:
        """Full attribute-delta heatmap (players × attributes)."""
        ad = self.ad
        if ad.empty:
            return _empty_fig("5. Attribute Heatmap")

        ppl = self.ppl
        avail = [c for c in self.varying if c in ad.columns]
        if not avail:
            return _empty_fig("5. Attribute Heatmap")

        plot_df = ad[avail + ['Age']].copy()
        plot_df = plot_df.join(ppl.set_index('PlayerID')[['Baseline', 'Label']])
        plot_df = plot_df.dropna(subset=['Label'])
        plot_df = plot_df.sort_values('Baseline', ascending=False)  # was: ['Age', 'Baseline']

        # Enforce row limit for performance
        if len(plot_df) > Config.MAX_HEATMAP_ROWS:
            plot_df = plot_df.head(Config.MAX_HEATMAP_ROWS)

        y_labels = [f"{lbl} ({int(age)})" for lbl, age in zip(plot_df['Label'], plot_df['Age'])]
        col_order = sorted(avail, key=lambda a: -plot_df[a].abs().mean())
        z_data = plot_df[col_order].fillna(0).values

        abs_max = max(np.nanpercentile(np.abs(z_data), 97), 0.5)

        fig = go.Figure(data=go.Heatmap(
            z=z_data.tolist(), x=col_order, y=y_labels,
            colorscale=DIVERGING_CMAP, zmid=0, zmin=-abs_max, zmax=abs_max,
            hovertemplate="Attr: %{x}<br>Player: %{y}<br>Delta: %{z:.2f}<extra></extra>",
            xgap=2, ygap=2,
        ))
        fig.update_layout(
            template=_PLOTLY_TEMPLATE,
            title="5. Attribute Movement Heatmap",
            height=max(600, len(plot_df) * 18),
            yaxis_autorange='reversed', yaxis_showgrid=False, xaxis_showgrid=False,
        )
        return fig

    # ── 6. Tier Separation by Top Driver ─────────────────────────────────

    def chart_tier_separation(self) -> go.Figure:
        """Box plots of OVR Delta by top-driver quartile within each age tier."""
        driver = self.top_drivers[0] if self.top_drivers else None
        if not driver or driver not in self.ppl.columns:
            return _empty_fig("6. Tier Separation")

        # Compute quartile labels without mutating the cached ppl
        local_ppl = self.ppl.copy()
        local_ppl['DriverQ'] = (
            local_ppl.groupby('AgeTier', group_keys=False)[driver]
            .transform(qcut_within)
        )
        full = self._df.merge(local_ppl[['PlayerID', 'DriverQ']], on='PlayerID')

        fig = go.Figure()
        for q, color in Q_COLORS.items():
            q_data = full[full['DriverQ'] == q]['Delta'].dropna().values
            if len(q_data) == 0:
                continue
            fig.add_trace(go.Box(
                y=q_data, name=q, marker_color=color, boxmean='sd',
                boxpoints='outliers', marker_opacity=0.7,
                line_width=2, fillcolor=hex_to_rgba(color, 0.3),
            ))
        fig.add_hline(y=0, line_width=1, line_dash="dash", line_color="#1e293b")
        fig.update_layout(
            template=_PLOTLY_TEMPLATE,
            title=f"6. Tier Separation by {driver} Quartile",
            yaxis_title="OVR Delta", xaxis_title="Quartile (Within Age Tier)",
        )
        return fig

    # ── 7. Player OVR Outcome Range (Optimised) ─────────────────────────
    def chart_outcome_range(self) -> go.Figure:
        """Simulation Force Field: mean pull (vector) and RNG wobble (cone)
        by Baseline OVR and Age Tier.

        Interprets the MC sim as a physical system:
        - The Y-axis is the OVR Delta (force exerted by the sim).
        - Arrows show the direction and magnitude of the average pull.
        - The cone/width around the arrow shows the RNG wobble (1σ).
        A tuner can instantly see where the sim pushes players up/down,
        and where the RNG dwarfs the deterministic trend.
        """
        ppl = self.ppl
        df = self._df

        baselines = ppl.set_index('PlayerID')['Baseline']
        age_tiers = ppl.set_index('PlayerID')['AgeTier']
        df_b = df.copy()
        df_b['Baseline'] = df_b['PlayerID'].map(baselines)
        df_b['AgeTier']  = df_b['PlayerID'].map(age_tiers)

        # Create OVR bins for the vector field
        n_bins = min(15, max(5, len(ppl) // 8))
        try:
            df_b['BaseBin'] = pd.qcut(df_b['Baseline'], q=n_bins, duplicates='drop')
        except ValueError:
            return _empty_fig("7. Simulation Force Field")

        # Compute vectors (Mean Delta) and wobble (Std Delta)
        vector_df = (
            df_b.groupby(['BaseBin', 'AgeTier'], observed=True)['Delta']
            .agg(Mean='mean', Std='std', Count='count')
            .reset_index()
        )
        vector_df['BaseMid'] = vector_df['BaseBin'].apply(lambda x: x.mid).astype(float)

        # Filter out severely underpopulated bins
        vector_df = vector_df[vector_df['Count'] >= 10]
        if vector_df.empty:
            return _empty_fig("7. Simulation Force Field")

        fig = go.Figure()

        for tier, color in AGE_COLORS.items():
            tier_data = vector_df[vector_df['AgeTier'] == tier].sort_values('BaseMid')
            if tier_data.empty:
                continue

            # 1. The "Wobble" Band (±1σ around the mean pull)
            fig.add_trace(go.Scatter(
                x=pd.concat([tier_data['BaseMid'], tier_data['BaseMid'][::-1]]),
                y=pd.concat([tier_data['Mean'] + tier_data['Std'],
                             (tier_data['Mean'] - tier_data['Std'])[::-1]]),
                fill='toself',
                fillcolor=hex_to_rgba(color, 0.1),
                line=dict(color=hex_to_rgba(color, 0.2), width=1),
                name=f'{tier} RNG Wobble (±1σ)',
                hovertemplate=(
                    f"<b>{tier}</b><br>Base OVR: %{{x:.0f}}<br>"
                    f"Mean Δ: %{{y:.1f}}<extra></extra>"
                ),
            ))

            # 2. The "Force Vector" Line (Mean Delta)
            fig.add_trace(go.Scatter(
                x=tier_data['BaseMid'], y=tier_data['Mean'],
                mode='lines+markers', name=f'{tier} Mean Pull',
                line=dict(color=color, width=4),
                marker=dict(
                    size=12, symbol='arrow-bar-up', angleref='previous',
                    color=color, line=dict(width=1.5, color='white')
                ),
                customdata=np.column_stack([
                    tier_data['Std'].values, tier_data['Count'].values,
                ]),
                hovertemplate=(
                    f"<b>{tier}</b><br>"
                    f"Base OVR: %{{x:.0f}}<br>"
                    f"Mean Pull: %{{y:.1f}} OVR<br>"
                    f"RNG Wobble (σ): %{{customdata[0]:.1f}}<br>"
                    f"N Runs: %{{customdata[1]:,}}<extra></extra>"
                ),
            ))

        # Zero-force reference line
        fig.add_hline(y=0, line_width=2, line_color="#1e293b",
                      annotation_text="Zero Force (No Change)",
                      annotation_position="bottom left")

        # Signal-to-Noise annotation
        overall = vector_df.groupby('BaseMid').apply(
            lambda g: np.sqrt(np.average((g['Mean']**2), weights=g['Count'])) / 
                      np.sqrt(np.average((g['Std']**2), weights=g['Count'])) if g['Std'].mean() > 0 else 0
        )
        snr_text = "Signal > Noise" if overall.mean() > 1.0 else "Noise > Signal"
        fig.add_annotation(
            text=f"System SNR: {overall.mean():.2f} ({snr_text})",
            xref="paper", yref="paper", x=0.98, y=0.98,
            showarrow=False, font=dict(size=13, color='#0f172a', family="Inter"),
            bgcolor='rgba(255,255,255,0.9)', bordercolor='#e2e8f0', borderwidth=1,
        )

        fig.update_layout(
            template=_PLOTLY_TEMPLATE,
            title="7. Simulation Force Field (Mean Pull vs. RNG Wobble)",
            xaxis_title="Baseline OVR",
            yaxis_title="OVR Delta (Simulation Force)",
            hovermode='x unified',
            legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
        )
        return fig
    
    # ── 8. Convergence Diagnostics ───────────────────────────────────────
    def chart_convergence(self) -> go.Figure:
        """Running mean ± MCSE for the most volatile players."""
        conv = self._proc.convergence
        top_pids = conv['top_volatile']
        if not top_pids:
            return _empty_fig("8. Convergence")

        # Map PlayerID → display label
        pid_to_label = (
            self._df.groupby('PlayerID')
            .apply(lambda g: display_label(g['Name'].iloc[0], g['Team'].iloc[0]))
        )

        fig = make_subplots(
            rows=2, cols=3,
            subplot_titles=[f"<b>{pid_to_label.get(p, p)}</b>" for p in top_pids],
            vertical_spacing=0.15, horizontal_spacing=0.1,
        )

        for idx, pid in enumerate(top_pids):
            r, c = (idx // 3) + 1, (idx % 3) + 1
            vals = self._df[self._df['PlayerID'] == pid].sort_values('Run')['Delta'].values
            n = len(vals)
            if n < 2:
                continue

            runs = np.arange(1, n + 1)
            cum_sum    = np.cumsum(vals)
            cum_sum_sq = np.cumsum(vals ** 2)
            cum_mean   = cum_sum / runs

            # Online variance: Var_k = (Σx²/k - (Σx/k)²) × k/(k-1)
            cum_var_pop = cum_sum_sq / runs - cum_mean ** 2
            # Safe denominator avoids the RuntimeWarning from runs / (runs - 1) when runs=1
            safe_denom = np.where(runs > 1, runs - 1, 1.0)
            cum_var    = np.where(runs > 1, cum_var_pop * runs / safe_denom, 0.0)
            cum_var    = np.maximum(cum_var, 0.0)  # guard floating-point negativity
            mcse        = np.sqrt(cum_var / runs)

            fig.add_trace(go.Scatter(
                x=runs, y=cum_mean, mode='lines',
                line=dict(color='#2563eb', width=2), showlegend=False,
            ), row=r, col=c)
            fig.add_trace(go.Scatter(
                x=runs, y=cum_mean - mcse, mode='lines',
                line=dict(width=0), showlegend=False,
            ), row=r, col=c)
            fig.add_trace(go.Scatter(
                x=runs, y=cum_mean + mcse, mode='lines',
                line=dict(width=0), fill='tonexty',
                fillcolor='rgba(37,99,235,0.15)', showlegend=False,
            ), row=r, col=c)
            fig.add_hline(y=float(np.mean(vals)), line_dash="dash",
                          line_color="#dc2626", line_width=1, row=r, col=c)

        # Global convergence annotation
        pct = conv['pct_converged']
        fig.add_annotation(
            text=f"MCSE < {Config.MCSE_CONVERGENCE_THRESHOLD}: {pct:.0%} of players converged",
            xref="paper", yref="paper", x=0.5, y=-0.05, showarrow=False,
            font=dict(size=13, color='#64748b'),
        )

        fig.update_layout(
            template=_PLOTLY_TEMPLATE,
            title_text="8. Convergence: Running Mean Delta (±1 MCSE)",
            height=800,
        )
        return fig

    # ── 9. Variance Decomposition (ICC) ──────────────────────────────────

    def chart_icc(self) -> go.Figure:
        """ICC per attribute - how much outcome variance is systematic vs RNG."""
        icc = self._proc.icc_data
        if icc.empty:
            return _empty_fig("9. Variance Decomposition")

        fig = go.Figure()

        # Bar coloured by ICC value: high = teal, low = amber
        colors = [
            '#16a34a' if v >= 0.7 else '#f97316' if v >= 0.4 else '#dc2626'
            for v in icc['ICC']
        ]

        fig.add_trace(go.Bar(
            y=icc['Attribute'], x=icc['ICC'],
            orientation='h', marker_color=colors, marker_line_width=0, opacity=0.9,
            customdata=np.column_stack([
                icc['Var_Between'].values, icc['Var_Within'].values, icc['ICC'].values,
            ]),
            hovertemplate=(
                "<b>%{y}</b><br>ICC: %{customdata[2]:.2f}"
                "<br>σ²_between: %{customdata[0]:.2f}"
                "<br>σ²_within: %{customdata[1]:.2f}<extra></extra>"
            ),
        ))

        # Reference lines
        fig.add_vline(x=0.4, line_dash="dot", line_color="#f97316",
                      annotation_text="Low (0.4)", annotation_position="top right")
        fig.add_vline(x=0.7, line_dash="dot", line_color="#16a34a",
                      annotation_text="High (0.7)", annotation_position="top right")

        fig.update_layout(
            template=_PLOTLY_TEMPLATE,
            title="9. Variance Decomposition - ICC per Attribute",
            xaxis_title="ICC (1 = fully deterministic, 0 = pure RNG)",
            yaxis_title="Attribute",
            height=max(400, len(icc) * 30),
        )
        return fig

    # ── 10. Multivariate True Leverage (OLS β ± 95% CI) ─────────────────

    def chart_ols_leverage(self) -> go.Figure:
        """Standardised OLS coefficients with 95% CI by age tier.

        Uses QR decomposition for numerical stability.  Features with VIF > 10
        are annotated to flag collinearity.
        """
        ppl = self.ppl
        candidates = ['Age', 'Baseline'] + self.input_stats
        existing = [c for c in candidates if c in ppl.columns and ppl[c].std() > 0]
        if len(existing) < 2:
            return _empty_fig("10. Multivariate Leverage")

        rows = []
        for tier in ppl['AgeTier'].unique():
            sub = ppl[ppl['AgeTier'] == tier]
            X_df = sub[existing].apply(zscore)
            valid_features = X_df.columns[X_df.std() > 0].tolist()
            if len(valid_features) == 0:
                continue

            X = np.column_stack([np.ones(len(sub)), X_df[valid_features].values])
            y = zscore(sub['MeanDelta']).values

            try:
                beta, se, r2 = ols_fit(X, y)
            except (ValueError, np.linalg.LinAlgError):
                continue

            ci_95 = 1.96 * se[1:]  # skip intercept

            # Compute VIF for each feature
            vif_flags = {}
            if len(valid_features) > 1:
                for j, feat in enumerate(valid_features):
                    others = [f for f in valid_features if f != feat]
                    X_j = np.column_stack([np.ones(len(sub)), X_df[others].values])
                    y_j = X_df[feat].values
                    try:
                        _, _, r2_j = ols_fit(X_j, y_j)
                        vif = 1.0 / (1.0 - r2_j) if r2_j < 0.999 else float('inf')
                        if vif > 10:
                            vif_flags[feat] = vif
                    except (ValueError, np.linalg.LinAlgError):
                        vif_flags[feat] = float('inf')

            for i, feat in enumerate(valid_features):
                vif_note = f" (VIF>{vif_flags[feat]:.0f})" if feat in vif_flags else ""
                rows.append({
                    'Tier': tier, 'Stat': feat + vif_note,
                    'Beta': beta[i + 1], 'CI': ci_95[i], 'R2': r2,
                })

        data = pd.DataFrame(rows)
        if data.empty:
            return _empty_fig("10. Multivariate Leverage")

        fig = go.Figure()
        for tier, color in AGE_COLORS.items():
            tier_data = data[data['Tier'] == tier]
            fig.add_trace(go.Bar(
                x=tier_data['Stat'], y=tier_data['Beta'], name=tier,
                marker_color=color, marker_line_width=0, opacity=0.9,
                error_y=dict(type='data', array=tier_data['CI'], visible=True, color=color),
            ))

        fig.add_hline(y=0, line_width=1, line_color="#1e293b")
        fig.update_layout(
            template=_PLOTLY_TEMPLATE,
            title="10. Multivariate True Leverage (Independent Impact)",
            xaxis_title="Input Stat (VIF > 10 flagged)",
            yaxis_title="Standardised True Impact (β ± 95% CI)",
            barmode='group', bargap=0.2, bargroupgap=0.1,
        )
        return fig

    # ── 11. Volatility Landscape ─────────────────────────────────────────

    def chart_volatility_landscape(self) -> go.Figure:
        """Spearman ρ between input stats and StdDelta by age tier."""
        ppl = self.ppl
        candidates = self.input_stats + ['Baseline']
        rows = []

        for tier in ppl['AgeTier'].unique():
            sub = ppl[ppl['AgeTier'] == tier]
            if len(sub) < 5:
                continue
            for col in candidates:
                if col in sub.columns and sub[col].std() > 0:
                    r, _ = scipy_stats.spearmanr(sub[col], sub['StdDelta'])
                    rows.append({'Tier': tier, 'Stat': col, 'Correlation': r})

        data = pd.DataFrame(rows)
        if data.empty:
            return _empty_fig("11. Volatility Landscape")

        fig = go.Figure()
        for tier, color in AGE_COLORS.items():
            tier_data = data[data['Tier'] == tier]
            fig.add_trace(go.Bar(
                x=tier_data['Stat'], y=tier_data['Correlation'], name=tier,
                marker_color=color, marker_line_width=0, opacity=0.9,
            ))
        fig.add_hline(y=0, line_width=1, line_color="#1e293b")
        fig.update_layout(
            template=_PLOTLY_TEMPLATE,
            title="11. Volatility Landscape (Stats Driving RNG)",
            xaxis_title="Input Stat", yaxis_title="Spearman ρ (vs StdDelta)",
            barmode='group', bargap=0.2, bargroupgap=0.1,
        )
        return fig

    # ── 12. Attribute Delta Co-movement ──────────────────────────────────

    def chart_attr_comovement(self) -> go.Figure:
        """Spearman correlation heatmap of attribute deltas."""
        ad = self.ad
        avail = [c for c in self.varying if c in ad.columns and c != 'Age']
        if ad.empty or len(avail) < 2:
            return _empty_fig("12. Attribute Co-movement")

        corr = ad[avail].corr(method='spearman')
        fig = go.Figure(data=go.Heatmap(
            z=corr.values, x=corr.columns, y=corr.index,
            colorscale=DIVERGING_CMAP, zmid=0, zmin=-1, zmax=1,
            hovertemplate="Var 1: %{y}<br>Var 2: %{x}<br>ρ: %{z:.3f}<extra></extra>",
            xgap=3, ygap=3,
        ))
        fig.update_layout(
            template=_PLOTLY_TEMPLATE,
            title="12. Attribute Delta Co-movement (Clustered Declines?)",
            height=650, yaxis_autorange='reversed',
            xaxis_showgrid=False, yaxis_showgrid=False,
        )
        return fig

    # ── 13. Per-Attribute Progression by Age ─────────────────────────────
    def chart_attr_progression(self) -> go.Figure:
        """Faceted bars: mean attribute delta per tier (all varying attrs)."""
        prog = self._proc.attr_progression_by_age
        if prog.empty:
            return _empty_fig("13. Per-Attribute Progression")

        attrs = prog['Attribute'].unique().tolist()
        n = len(attrs)
        if n == 0:
            return _empty_fig("13. Per-Attribute Progression")

        cols = min(n, 3)
        rows = (n + cols - 1) // cols

        fig = make_subplots(
            rows=rows, cols=cols,
            subplot_titles=[f"<b>{a}</b>" for a in attrs],
            vertical_spacing=0.12, horizontal_spacing=0.08,
        )

        for i, attr in enumerate(attrs):
            r, c = (i // cols) + 1, (i % cols) + 1
            attr_data = prog[prog['Attribute'] == attr]
            for tier, color in AGE_COLORS.items():
                tier_data = attr_data[attr_data['AgeTier'] == tier]
                if tier_data.empty:
                    continue
                # FIX: Compute CI from SE (95% CI = 1.96 * SE)
                ci_95 = tier_data['SE'].values * 1.96
                
                fig.add_trace(go.Bar(
                    x=[tier], y=tier_data['MeanDelta'],
                    marker_color=color, marker_line_width=0, opacity=0.9,
                    error_y=dict(
                        type='data', array=ci_95,
                        visible=True, thickness=1.5, width=3,
                    ),
                    showlegend=(i == 0), name=tier,
                ), row=r, col=c)
            fig.add_hline(y=0, line_width=0.5, line_color="#94a3b8", row=r, col=c)

        fig.update_layout(
            template=_PLOTLY_TEMPLATE,
            title="13. Per-Attribute Progression by Age Tier (±95% CI)",
            height=350 * rows, barmode='group', bargap=0.2, bargroupgap=0.1,
            showlegend=True,
        )
        return fig

    # ── 14. Cap Ceiling & Probability of Improvement ─────────────────────

    def chart_cap_survival(self) -> go.Figure:
        """Dual-axis: compression curve (left) + logistic P(Δ>0) (right)."""
        ppl = self.ppl
        sub_all = ppl.dropna(subset=['Baseline', 'MeanOvr']).copy()
        if len(sub_all) < 20:
            return _empty_fig("14. Cap Ceiling & Probability")

        # Bin by Baseline for compression curve
        sub_all['Bin'] = pd.qcut(sub_all['Baseline'], q=15, duplicates='drop')
        binned = sub_all.groupby('Bin', observed=True).agg(
            BaselineMid=('Baseline', 'mean'),
            MeanOvr=('MeanOvr', 'mean'),
            PctPositive=('PctPositive', 'mean'),
        ).reset_index()

        fig = go.Figure()

        # Left axis: Compression curve
        fig.add_trace(go.Scatter(
            x=binned['BaselineMid'], y=binned['BaselineMid'],
            mode='lines', line=dict(color='#94a3b8', width=2, dash='dot'),
            name='No Change (y=x)',
        ))
        fig.add_trace(go.Scatter(
            x=binned['BaselineMid'], y=binned['MeanOvr'],
            mode='markers+lines', name='Mean Simulated OVR',
            line=dict(color='#2563eb', width=3), marker=dict(size=8),
        ))

        cap_est = int(ppl['MeanOvr'].max()) + 1
        fig.add_hline(y=cap_est, line_dash="dash", line_color="#dc2626", line_width=2,
                      annotation_text=f"Approx Cap (~{cap_est})",
                      annotation_font_color="#dc2626")

        # Right axis: Logistic survival curve
        fig.add_trace(go.Scatter(
            x=binned['BaselineMid'], y=binned['PctPositive'],
            mode='markers', name='P(Δ>0) Actual',
            marker=dict(color='#16a34a', size=7, opacity=0.6),
            yaxis='y2',
        ))

        # Fit logistic per tier for the right axis
        for tier, color in AGE_COLORS.items():
            sub = ppl[ppl['AgeTier'] == tier].dropna(subset=['Baseline', 'PctPositive'])
            if len(sub) < 10:
                continue
            try:
                popt, _ = curve_fit(logistic, sub['Baseline'], sub['PctPositive'],
                                    p0=[0, -0.1], maxfev=5000)
                x_fit = np.linspace(sub['Baseline'].min(), sub['Baseline'].max(), 200)
                y_fit = logistic(x_fit, *popt)
                fig.add_trace(go.Scatter(
                    x=x_fit, y=y_fit, mode='lines', name=f'{tier} Fit',
                    line=dict(color=color, width=2, dash='longdash'),
                    yaxis='y2',
                ))
            except RuntimeError:
                pass

        fig.update_layout(
            template=_PLOTLY_TEMPLATE,
            title="14. OVR Cap Ceiling & Probability of Improvement",
            xaxis_title="Baseline OVR",
            yaxis=dict(title="Mean Simulated OVR", side='left'),
            yaxis2=dict(title="P(Δ > 0)", side='right', overlaying='y',
                        rangemode='tozero', tickformat='.0%'),
            hovermode='x unified',
        )
        return fig

    # ── 15. Age-Adjusted Over/Under Performers ───────────────────────────

    def chart_age_adjusted(self) -> go.Figure:
        """Histogram of age-adjusted Z-scores with standard normal overlay."""
        ppl = self.ppl
        valid = ppl.dropna(subset=['AgeAdjZ'])
        if valid.empty:
            return _empty_fig("15. Age-Adjusted Performance")

        fig = go.Figure()
        fig.add_trace(go.Histogram(
            x=valid['AgeAdjZ'], nbinsx=40, marker_color='#2563eb',
            marker_line_width=0, opacity=0.8, name='All Players',
            histnorm='probability density',
        ))

        x_range = np.linspace(valid['AgeAdjZ'].min() - 1, valid['AgeAdjZ'].max() + 1, 200)
        fig.add_trace(go.Scatter(
            x=x_range, y=scipy_stats.norm.pdf(x_range, 0, 1),
            mode='lines', line=dict(color='#dc2626', width=3, dash='dash'),
            name='Standard Normal',
        ))

        fig.add_vline(x=0, line_width=2, line_color="#1e293b")
        fig.add_vline(x=-2, line_width=1, line_dash="dot", line_color="#dc2626",
                      annotation_text="Underperformer")
        fig.add_vline(x=2, line_width=1, line_dash="dot", line_color="#16a34a",
                      annotation_text="Overperformer")

        fig.update_layout(
            template=_PLOTLY_TEMPLATE,
            title="15. Age-Adjusted Over/Under Performers (Z-Score)",
            xaxis_title="Z-Score (MeanDelta relative to Age Tier)",
            yaxis_title="Probability Density",
        )
        return fig

    # ── 16. Tail Risk Analysis ───────────────────────────────────────────

    def chart_tail_risk(self) -> go.Figure:
        """Probability of extreme OVR Delta outcomes by tier."""
        thresholds = [2, 5, 10]
        df_local = self._df.assign(AgeTier=DataProcessor.assign_age_tiers(self._df['Age']))

        rows = []
        for tier in df_local['AgeTier'].unique():
            sub = df_local[df_local['AgeTier'] == tier]
            if len(sub) == 0:
                continue
            for th in thresholds:
                p_gain = (sub['Delta'] > th).mean()
                p_loss = (sub['Delta'] < -th).mean()
                rows.append({'Tier': tier, 'Threshold': f'>+{th}',
                             'Probability': p_gain, 'Type': 'Gain'})
                rows.append({'Tier': tier, 'Threshold': f'>-{th}',
                             'Probability': p_loss, 'Type': 'Loss'})

        data = pd.DataFrame(rows)
        if data.empty:
            return _empty_fig("16. Tail Risk")

        fig = go.Figure()
        gains = data[data['Type'] == 'Gain']
        losses = data[data['Type'] == 'Loss']

        for tier, color in AGE_COLORS.items():
            g = gains[gains['Tier'] == tier]
            fig.add_trace(go.Bar(
                x=g['Threshold'], y=g['Probability'], name=f'{tier} (Gain)',
                marker_color=color, marker_line_width=0, opacity=0.9,
            ))
            l = losses[losses['Tier'] == tier]
            fig.add_trace(go.Bar(
                x=l['Threshold'], y=-l['Probability'], name=f'{tier} (Loss)',
                marker_color=color, marker_line_width=0, opacity=0.4,
            ))

        fig.add_hline(y=0, line_width=1, line_color="#1e293b")
        fig.update_layout(
            template=_PLOTLY_TEMPLATE,
            title="16. Tail Risk Analysis (Probability of Extremes)",
            xaxis_title="OVR Delta Threshold",
            yaxis_title="Probability (Faded=Loss, Solid=Gain)",
            yaxis_tickformat=".1%", barmode='group', bargap=0.2, bargroupgap=0.1,
        )
        return fig

    # ── 17. Interaction Surface (Bivariate OLS) ─────────────────────────

    def chart_interaction(self) -> go.Figure:
        """3D surface: predicted MeanDelta from top 2 drivers.

        Fits separate OLS planes per age tier to reveal interaction effects.
        If the two drivers are collinear, the plane is still fit but the
        tuner should cross-reference Chart 10 for VIF warnings.
        """
        if len(self.top_drivers) < 2:
            return _empty_fig("17. Interaction Surface")

        d1, d2 = self.top_drivers[0], self.top_drivers[1]
        ppl = self.ppl

        fig = go.Figure()
        has_surface = False

        for tier, color in AGE_COLORS.items():
            sub = ppl[ppl['AgeTier'] == tier].dropna(subset=[d1, d2, 'MeanDelta'])
            if len(sub) < Config.MIN_OLS_SAMPLES:
                continue

            X_mat = np.column_stack([np.ones(len(sub)), sub[d1].values, sub[d2].values])
            y_vec = sub['MeanDelta'].values

            try:
                beta, _, _ = ols_fit(X_mat, y_vec)
            except (ValueError, np.linalg.LinAlgError):
                continue

            # Create prediction grid
            x1_grid = np.linspace(sub[d1].min(), sub[d1].max(), 25)
            x2_grid = np.linspace(sub[d2].min(), sub[d2].max(), 25)
            X1, X2 = np.meshgrid(x1_grid, x2_grid)
            Z = beta[0] + beta[1] * X1 + beta[2] * X2

            fig.add_trace(go.Surface(
                x=X1, y=X2, z=Z, name=tier,
                colorscale=[
                    [0.0, hex_to_rgba(color, 0.3)],
                    [0.5, hex_to_rgba(color, 0.6)],
                    [1.0, hex_to_rgba(color, 0.9)],
                ],
                showscale=False, opacity=0.85,
            ))
            has_surface = True

            # Scatter the actual points
            fig.add_trace(go.Scatter3d(
                x=sub[d1], y=sub[d2], z=sub['MeanDelta'],
                mode='markers', name=f'{tier} (data)',
                marker=dict(size=3, color=color, opacity=0.5),
            ))

        if not has_surface:
            return _empty_fig("17. Interaction Surface")

        fig.update_layout(
            template=_PLOTLY_TEMPLATE,
            title=f"17. Interaction Surface: {d1} × {d2} → MeanDelta",
            scene=dict(
                xaxis_title=d1, yaxis_title=d2, zaxis_title='Mean Δ',
                xaxis=dict(backgroundcolor='#f8fafc', gridcolor='#e2e8f0'),
                yaxis=dict(backgroundcolor='#f8fafc', gridcolor='#e2e8f0'),
                zaxis=dict(backgroundcolor='#f8fafc', gridcolor='#e2e8f0'),
            ),
            height=800,
        )
        return fig
    
    def chart_effect_sizes(self) -> go.Figure:
        """Forest plot of pairwise tier effect sizes with bootstrap CIs."""
        es = self._proc.effect_sizes
        if es.empty:
            return _empty_fig("Effect Sizes")

        fig = go.Figure()

        for i, row in es.iterrows():
            y_pos = i
            d = row['Cohen_d']
            # Use bootstrap CI on the mean diff, scaled to d
            mean_diff = row['MeanDiff']
            # Re-derive CI in d-space approximately
            ci_lo = row['Boot_CI_lo']
            ci_hi = row['Boot_CI_hi']

            color = '#16a34a' if abs(d) >= 0.8 else '#f97316' if abs(d) >= 0.5 else '#94a3b8'

            fig.add_trace(go.Scatter(
                x=[d], y=[row['Comparison']], mode='markers',
                marker=dict(color=color, size=14, line=dict(width=2, color='white')),
                customdata=[[row['KS_stat'], row['KS_p'], row['MannWhitney_p']]],
                hovertemplate=(
                    "<b>%{y}</b><br>"
                    "Cohen's d: %{x:.2f}<br>"
                    "KS: %{customdata[0]:.3f} (p=%{customdata[1]:.4f})<br>"
                    "Mann-Whitney p: %{customdata[2]:.4f}<extra></extra>"
                ),
                showlegend=False,
            ))
            fig.add_trace(go.Scatter(
                x=[ci_lo, ci_hi], y=[row['Comparison'], row['Comparison']],
                mode='lines', line=dict(color=color, width=3),
                showlegend=False, hoverinfo='skip',
            ))

        # Reference lines
        fig.add_vline(x=0, line_width=1, line_color="#1e293b")
        for d_val, label, lc in [(0.2, 'Small', '#94a3b8'),
                                  (0.5, 'Medium', '#f97316'),
                                  (0.8, 'Large', '#16a34a')]:
            for sign in [1, -1]:
                fig.add_vline(x=sign * d_val, line_dash="dot", line_color=lc,
                              line_width=1, opacity=0.5)
        fig.add_vline(x=0.2, line_dash="dot", line_color='#94a3b8',
                      annotation_text="Small (0.2)", annotation_position="top right")
        fig.add_vline(x=0.5, line_dash="dot", line_color='#f97316',
                      annotation_text="Medium (0.5)", annotation_position="top right")
        fig.add_vline(x=0.8, line_dash="dot", line_color='#16a34a',
                      annotation_text="Large (0.8)", annotation_position="top right")

        fig.update_layout(
            template=_PLOTLY_TEMPLATE,
            title="18. Effect Sizes: Pairwise Tier Differences (Cohen's d)",
            xaxis_title="Cohen's d (± Bootstrap 95% CI)",
            yaxis_title="Comparison",
            height=max(350, len(es) * 60 + 100),
        )
        return fig
    
    def chart_risk_adjusted(self) -> go.Figure:
        """Efficiency frontier: Certainty Equivalent vs Baseline OVR.
        Players above the frontier are optimal risk-reward; below are suboptimal.
        """
        ra = self._proc.risk_adjusted
        if ra.empty:
            return _empty_fig("Risk-Adjusted Efficiency")

        fig = go.Figure()

        # Scatter: CE vs Baseline, coloured by Sharpe
        fig.add_trace(go.Scatter(
            x=ra['Baseline'], y=ra['CertEquiv'], mode='markers',
            marker=dict(
                color=ra['Sharpe'], colorscale='RdYlGn',
                size=9, line=dict(width=1, color='white'), opacity=0.85,
                colorbar=dict(title="Sharpe Ratio", thickness=15),
                showscale=True, cmin=-2, cmax=2,
            ),
            customdata=np.column_stack([
                ra['Label'].values, ra['MeanDelta'].values,
                ra['StdDelta'].values, ra['Sharpe'].values,
            ]),
            hovertemplate=(
                "<b>%{customdata[0]}</b><br>"
                "Base OVR: %{x:.0f}<br>"
                "CE: %{y:.1f} | Mean Δ: %{customdata[1]:.1f} | σ: %{customdata[2]:.1f}<br>"
                "Sharpe: %{customdata[3]:.2f}<extra></extra>"
            ),
        ))

        # Pareto frontier: rolling max CE by baseline bin
        ra_sorted = ra.sort_values('Baseline')
        window = max(5, len(ra_sorted) // 10)
        frontier_x, frontier_y = [], []
        for start in range(0, len(ra_sorted) - window + 1, window // 3):
            chunk = ra_sorted.iloc[start:start + window]
            best = chunk.loc[chunk['CertEquiv'].idxmax()]
            frontier_x.append(best['Baseline'])
            frontier_y.append(best['CertEquiv'])
        if len(frontier_x) > 2:
            fig.add_trace(go.Scatter(
                x=frontier_x, y=frontier_y, mode='lines',
                line=dict(color='#dc2626', width=3, dash='dash'),
                name='Efficiency Frontier',
            ))

        fig.add_hline(y=0, line_width=1, line_color="#1e293b",
                      annotation_text="Break-even CE", annotation_position="bottom right")
        fig.update_layout(
            template=_PLOTLY_TEMPLATE,
            title="19. Risk-Adjusted Efficiency (Certainty Equivalent = μ − 0.5σ²)",
            xaxis_title="Baseline OVR",
            yaxis_title="Certainty Equivalent (OVR Delta)",
            hovermode='closest',
        )
        return fig
    
    def chart_rank_stability(self) -> go.Figure:
        """Kendall's W concordance + per-player rank CV distribution."""
        rs = self._proc.rank_stability
        if np.isnan(rs.get('W', np.nan)):
            return _empty_fig("Rank Stability")

        rank_cv = rs['rank_cv']

        fig = make_subplots(
            rows=1, cols=2,
            subplot_titles=["<b>Rank CoV Distribution</b>", "<b>Rank CoV vs Baseline OVR</b>"],
            horizontal_spacing=0.15,
        )

        # Left: histogram of rank CVs
        fig.add_trace(go.Histogram(
            x=rank_cv.values, nbinsx=30, marker_color='#2563eb',
            marker_line_width=0, opacity=0.8, name='Rank CoV',
        ), row=1, col=1)

        # Right: rank CV vs baseline OVR
        ppl = self._proc.per_player
        merged = ppl.join(rank_cv, on='PlayerID', how='inner')
        if not merged.empty:
            fig.add_trace(go.Scatter(
                x=merged['Baseline'], y=merged['RankCV'], mode='markers',
                marker=dict(color='#2563eb', size=8, opacity=0.7),
                customdata=merged[['Label', 'Age']].values,
                hovertemplate=(
                    "<b>%{customdata[0]}</b><br>"
                    "Base: %{x:.0f} | Rank CoV: %{y:.3f}<extra></extra>"
                ),
                showlegend=False,
            ), row=1, col=2)

        W = rs['W']
        interp = 'Stable' if W > 0.7 else 'Moderate' if W > 0.4 else 'Unstable'
        fig.add_annotation(
            text=f"Kendall's W = {W:.3f} ({interp})<br>"
                 f"N={rs['n_players']} players, {rs['n_runs']} runs",
            xref="paper", yref="paper", x=0.5, y=1.08, showarrow=False,
            font=dict(size=14, color='#0f172a', family="Inter"),
        )

        fig.update_xaxes(title_text="Rank Coefficient of Variation", row=1, col=1)
        fig.update_xaxes(title_text="Baseline OVR", row=1, col=2)
        fig.update_yaxes(title_text="Count", row=1, col=1)
        fig.update_yaxes(title_text="Rank CoV", row=1, col=2)
        fig.update_layout(
            template=_PLOTLY_TEMPLATE,
            title="20. Rank Stability Across Monte Carlo Runs",
            height=500,
        )
        return fig
    
    def chart_outlier_detection(self) -> go.Figure:
        """Mahalanobis distance in (MeanΔ, StdΔ) space, flags structural outliers."""
        outliers = self._proc.outlier_players
        if outliers.empty:
            return _empty_fig("Outlier Detection")

        fig = go.Figure()

        # χ²(2) 95% and 99% contours
        chi95 = np.sqrt(scipy_stats.chi2.ppf(0.95, df=2))
        chi99 = np.sqrt(scipy_stats.chi2.ppf(0.99, df=2))

        is_sig = outliers['Outlier_p'] < 0.05

        # Non-outliers
        normal = outliers[~is_sig]
        fig.add_trace(go.Scatter(
            x=normal['MeanDelta'], y=normal['StdDelta'], mode='markers',
            marker=dict(color='#94a3b8', size=7, opacity=0.5),
            name='Normal', hoverinfo='skip',
        ))

        # Outliers
        oot = outliers[is_sig]
        if not oot.empty:
            fig.add_trace(go.Scatter(
                x=oot['MeanDelta'], y=oot['StdDelta'], mode='markers+text',
                marker=dict(color='#dc2626', size=12, line=dict(width=2, color='white'),
                            symbol='diamond'),
                text=oot['Label'].apply(lambda s: s.split('(')[0].strip()),
                textposition='top center', textfont=dict(size=9, color='#dc2626'),
                customdata=np.column_stack([
                    oot['Label'].values, oot['MahalDist'].values, oot['Outlier_p'].values,
                ]),
                hovertemplate=(
                    "<b>%{customdata[0]}</b><br>"
                    "Mahal: %{customdata[1]:.2f}<br>"
                    "p: %{customdata[2]:.4f}<extra></extra>"
                ),
                name='Outlier (p<0.05)',
            ))

        # Centroid
        cx = outliers['MeanDelta'].mean()
        cy = outliers['StdDelta'].mean()
        for r, label, lc in [(chi95, '95%', '#f97316'), (chi99, '99%', '#dc2626')]:
            theta = np.linspace(0, 2 * np.pi, 100)
            # Scale ellipse by axis standard deviations
            sx = outliers['MeanDelta'].std()
            sy = outliers['StdDelta'].std()
            fig.add_trace(go.Scatter(
                x=cx + r * sx * np.cos(theta), y=cy + r * sy * np.sin(theta),
                mode='lines', line=dict(color=lc, width=2, dash='dash'),
                name=f'χ² {label}', hoverinfo='skip',
            ))

        fig.update_layout(
            template=_PLOTLY_TEMPLATE,
            title="21. Outlier Detection, Mahalanobis Distance in (MeanΔ, StdΔ)",
            xaxis_title="Mean OVR Delta", yaxis_title="Std OVR Delta",
            hovermode='closest',
        )
        return fig
    
    def chart_funnel(self) -> go.Figure:
        """Funnel plot: StdDelta vs Baseline OVR, reveals ceiling compression.

        If variance shrinks at high baselines, the system has a hard cap.
        This is critical intelligence for a system tuner.
        """
        ppl = self.ppl
        comp = self._proc.compression_analysis

        fig = go.Figure()

        # Scatter of individual players
        fig.add_trace(go.Scatter(
            x=ppl['Baseline'], y=ppl['StdDelta'], mode='markers',
            marker=dict(
                color=ppl['MeanDelta'], colorscale='RdYlGn', size=8,
                line=dict(width=1, color='white'), opacity=0.75,
                colorbar=dict(title="Mean Δ", thickness=15), showscale=True,
            ),
            customdata=ppl[['Label', 'Age', 'PctPositive']].values,
            hovertemplate=(
                "<b>%{customdata[0]}</b><br>"
                "Base: %{x:.0f} | StdΔ: %{y:.1f}<br>"
                "Age: %{customdata[1]} | P(+): %{customdata[2]:.0%}<extra></extra>"
            ),
            name='Players',
        ))

        # Rolling window trend line for StdDelta
        if not comp.empty:
            fig.add_trace(go.Scatter(
                x=comp['BaselineMid'], y=comp['StdDelta'],
                mode='lines+markers', name='Rolling Mean σ',
                line=dict(color='#dc2626', width=3),
                marker=dict(size=8, color='#dc2626'),
            ))

            # Breusch-Pagan-like test: is variance heteroscedastic?
            from scipy.stats import spearmanr
            rho_bp, p_bp = spearmanr(ppl['Baseline'], ppl['StdDelta'])

            fig.add_annotation(
                text=f"Heteroscedasticity test: ρ={rho_bp:.2f} (p={p_bp:.4f})<br>"
                    + ("Ceiling compression detected" if rho_bp < -0.3 and p_bp < 0.05
                        else "Variance roughly constant" if p_bp >= 0.05
                        else "Variance increases with baseline"),
                xref="paper", yref="paper", x=0.5, y=-0.12, showarrow=False,
                font=dict(size=12, color='#0f172a'),
            )

        fig.update_layout(
            template=_PLOTLY_TEMPLATE,
            title="22. Funnel Plot, Variance vs Baseline OVR (Ceiling Compression?)",
            xaxis_title="Baseline OVR", yaxis_title="Std of OVR Delta",
            hovermode='closest',
        )
        return fig
    
    def chart_conditional_prob(self) -> go.Figure:
        """P(Δ > 0) as a 2D heatmap over (Baseline OVR bin × Age bin)."""
        df = self._df.copy()
        n_base_bins = min(10, max(3, len(df) // 50))
        n_age_bins = min(8, max(3, df['Age'].nunique()))

        try:
            df['BaseBin'] = pd.qcut(df['Baseline'], q=n_base_bins, duplicates='drop')
            df['AgeBin'] = pd.qcut(df['Age'], q=n_age_bins, duplicates='drop')
        except ValueError:
            return _empty_fig("Conditional Probability")

        prob = (
            df.groupby(['BaseBin', 'AgeBin'], observed=True)['Delta']
            .agg(P_positive=lambda s: (s > 0).mean(), Count='count', Mean='mean')
            .reset_index()
        )
        prob['BaseMid'] = prob['BaseBin'].apply(lambda x: x.mid).astype(float)
        prob['AgeMid'] = prob['AgeBin'].apply(lambda x: x.mid).astype(float)

        pivot = prob.pivot_table(index='AgeMid', columns='BaseMid', values='P_positive')
        count_pivot = prob.pivot_table(index='AgeMid', columns='BaseMid', values='Count')

        fig = go.Figure(data=go.Heatmap(
            z=pivot.values, x=[f"{c:.0f}" for c in pivot.columns],
            y=[f"{c:.0f}" for c in pivot.index],
            colorscale='RdYlGn', zmin=0, zmax=1,
            hovertemplate=(
                "Age: %{y} | Base: %{x}<br>"
                "P(Δ>0): %{z:.1%}<extra></extra>"
            ),
            xgap=3, ygap=3,
            colorbar=dict(title="P(Δ>0)", tickformat=".0%"),
        ))

        fig.update_layout(
            template=_PLOTLY_TEMPLATE,
            title="23. Conditional Probability: P(Improvement | Baseline × Age)",
            xaxis_title="Baseline OVR Bin (midpoint)",
            yaxis_title="Age Bin (midpoint)",
        )
        return fig
    
    def chart_full_driver_importance(self) -> go.Figure:
        """Ranked lollipop: |partial r| of every input stat with MeanDelta,
        controlling for Age + Baseline. Surfaces ALL drivers, not just top 3."""
        ppl = self.ppl
        candidates = [c for c in self.input_stats 
                    if c in ppl.columns and ppl[c].std() > 0]
        if not candidates:
            return _empty_fig("Full Driver Importance")

        Z = ppl[['Age', 'Baseline']].values  # always control for these

        rows = []
        for col in candidates:
            r_partial, p = partial_corr(ppl[col].values, ppl['MeanDelta'].values, Z)
            rows.append({
                'Stat': col, 'r': r_partial,
                'abs_r': abs(r_partial), 'p': p,
            })

        imp = pd.DataFrame(rows).sort_values('abs_r')

        # BH correction across all tests
        p_arr = imp['p'].values
        imp['sig'] = benjamini_hochberg(p_arr, alpha=0.05)

        colors = ['#16a34a' if s else '#94a3b8' for s in imp['sig']]

        fig = go.Figure()
        # Stems
        fig.add_trace(go.Bar(
            y=imp['Stat'], x=imp['r'], orientation='h',
            marker_color=colors, marker_line_width=0, opacity=0.85,
            # text showing r and p
            text=[f"r={r:.3f} (p={p:.4f}){'*' if s else ''}"
                for r, p, s in zip(imp['r'], imp['p'], imp['sig'])],
            textposition='outside', textfont=dict(size=10),
        ))
        fig.add_vline(x=0, line_width=1, line_color="#1e293b")
        fig.update_layout(
            template=_PLOTLY_TEMPLATE,
            title="24. Full Input Driver Importance (Partial r, controlling Age+Baseline)",
            xaxis_title="Partial Correlation with MeanDelta",
            yaxis_title="Input Stat",
            height=max(400, len(imp) * 28),
        )
        return fig
    
    def chart_partial_dependence(self) -> go.Figure:
        """Binned partial dependence: MeanDelta at each quantile of top input stats.
        Reveals thresholds, saturation, and non-monotonic effects."""
        ppl = self.ppl
        # Take top 8 by simple |spearman r| (partial dependence is the deep dive)
        candidates = [c for c in self.input_stats 
                    if c in ppl.columns and ppl[c].std() > 0]
        scored = []
        for col in candidates:
            r, _ = scipy_stats.spearmanr(ppl[col], ppl['MeanDelta'])
            scored.append((col, abs(r)))
        scored.sort(key=lambda x: x[1], reverse=True)
        top_n = [s[0] for s in scored[:8]]

        if not top_n:
            return _empty_fig("Partial Dependence")

        cols = min(4, len(top_n))
        rows_count = (len(top_n) + cols - 1) // cols
        fig = make_subplots(
            rows=rows_count, cols=cols,
            subplot_titles=[f"<b>{d}</b>" for d in top_n],
            vertical_spacing=0.12, horizontal_spacing=0.08,
        )

        for i, driver in enumerate(top_n):
            r, c = (i // cols) + 1, (i % cols) + 1
            # Bin into quantiles
            try:
                ppl_local = ppl.dropna(subset=[driver, 'MeanDelta']).copy()
                ppl_local['Bin'] = pd.qcut(ppl_local[driver], q=8, duplicates='drop')
            except ValueError:
                continue

            binned = ppl_local.groupby('Bin', observed=True).agg(
                X_mid=(driver, lambda s: s.mean()),
                Y_mean=('MeanDelta', 'mean'),
                Y_std=('MeanDelta', 'std'),
                Y_se=('MeanDelta', 'sem'),
                Count=('MeanDelta', 'count'),
            ).reset_index()

            for tier, color in AGE_COLORS.items():
                tier_ppl = ppl_local[ppl_local['AgeTier'] == tier]
                if len(tier_ppl) < 5:
                    continue
                try:
                    tier_ppl2 = tier_ppl.copy()
                    tier_ppl2['Bin'] = pd.qcut(tier_ppl2[driver], q=5, duplicates='drop')
                except ValueError:
                    continue
                tier_binned = tier_ppl2.groupby('Bin', observed=True).agg(
                    X_mid=(driver, 'mean'),
                    Y_mean=('MeanDelta', 'mean'),
                ).reset_index()

                fig.add_trace(go.Scatter(
                    x=tier_binned['X_mid'], y=tier_binned['Y_mean'],
                    mode='lines+markers', name=tier if i == 0 else '',
                    line=dict(color=color, width=2, dash='dot'),
                    marker=dict(size=5, color=color),
                    showlegend=(i == 0),
                ), row=r, col=c)

            # Overall curve (thicker)
            fig.add_trace(go.Scatter(
                x=binned['X_mid'], y=binned['Y_mean'],
                mode='lines+markers', name='Overall' if i == 0 else '',
                line=dict(color='#0f172a', width=3),
                marker=dict(size=8, color='#0f172a'),
                error_y=dict(type='data', array=binned['Y_se'] * 1.96,
                            visible=True, thickness=1.5, width=3),
                showlegend=(i == 0),
            ), row=r, col=c)

            fig.add_hline(y=0, line_width=0.5, line_color="#94a3b8", row=r, col=c)

        fig.update_layout(
            template=_PLOTLY_TEMPLATE,
            title="25. Partial Dependence: MeanDelta vs Input Quantile (Nonlinearity Check)",
            height=350 * rows_count,
        )
        return fig

    def chart_input_sensitivity_matrix(self) -> go.Figure:
        """Heatmap: (input stat × output metric) correlations.
        Reveals that some inputs drive mean, others drive variance or tail risk."""
        ppl = self.ppl
        candidates = [c for c in self.input_stats
                    if c in ppl.columns and ppl[c].std() > 0]

        output_metrics = {
            'MeanDelta': ppl['MeanDelta'],
            'StdDelta': ppl['StdDelta'],
            'PctPositive': ppl['PctPositive'],
            'P95_Delta': ppl['P95_Delta'],
            'P05_Delta': ppl['P05_Delta'],
            'IQR': ppl['P75_Delta'] - ppl['P25_Delta'],
        }

        rows = []
        for stat in candidates:
            row = {'Input': stat}
            for metric_name, metric_vals in output_metrics.items():
                r, _ = scipy_stats.spearmanr(ppl[stat], metric_vals)
                row[metric_name] = r
            rows.append(row)

        matrix = pd.DataFrame(rows).set_index('Input')

        # Sort by |correlation with MeanDelta| for readability
        matrix = matrix.reindex(
            matrix['MeanDelta'].abs().sort_values(ascending=False).index
        )

        fig = go.Figure(data=go.Heatmap(
            z=matrix.values, x=matrix.columns, y=matrix.index,
            colorscale=DIVERGING_CMAP, zmid=0, zmin=-1, zmax=1,
            hovertemplate="Input: %{y}<br>Metric: %{x}<br>ρ: %{z:.3f}<extra></extra>",
            xgap=3, ygap=3,
            text=matrix.round(2).values, texttemplate="%{text}",
            textfont=dict(size=10),
        ))
        fig.update_layout(
            template=_PLOTLY_TEMPLATE,
            title="26. Input → Output Sensitivity Matrix (Spearman ρ)",
            height=max(400, len(matrix) * 30),
            yaxis_autorange='reversed',
            xaxis_showgrid=False, yaxis_showgrid=False,
        )
        return fig
    
    def chart_incremental_r2(self) -> go.Figure:
        """Stepwise OLS waterfall: marginal R² gain per input stat.
        Answers 'how much does each input actually improve prediction?'"""
        ppl = self.ppl
        candidates = ['Age', 'Baseline'] + [c for c in self.input_stats
                    if c in ppl.columns and ppl[c].std() > 0]
        if len(candidates) < 2:
            return _empty_fig("Incremental R²")

        y = ppl['MeanDelta'].values

        # Greedy forward selection by partial R²
        selected = []
        remaining = list(candidates)
        rows = []

        # Baseline: intercept-only R² = 0
        rows.append({'Step': 'Intercept', 'Marginal_R2': 0.0, 'Cumulative_R2': 0.0})

        for _ in range(len(remaining)):
            best_col, best_gain, best_r2_full = None, -1, None
            for col in remaining:
                features = selected + [col]
                X = np.column_stack([np.ones(len(ppl))] + 
                                [zscore(ppl[f]).values for f in features])
                try:
                    _, _, r2 = ols_fit(X, y)
                except (ValueError, np.linalg.LinAlgError):
                    continue
                gain = r2 - rows[-1]['Cumulative_R2']
                if gain > best_gain:
                    best_col, best_gain, best_r2_full = col, gain, r2

            if best_col is None or best_gain < 0.001:
                break  # no further improvement

            selected.append(best_col)
            remaining.remove(best_col)
            rows.append({
                'Step': best_col,
                'Marginal_R2': best_gain,
                'Cumulative_R2': best_r2_full,
            })

        data = pd.DataFrame(rows)

        fig = go.Figure()

        # Marginal bars (waterfall style)
        fig.add_trace(go.Bar(
            x=data['Step'], y=data['Marginal_R2'],
            marker_color=['#94a3b8'] + 
                        ['#2563eb' if r2 > 0.05 else '#94a3b8' 
                        for r2 in data['Marginal_R2'].iloc[1:]],
            marker_line_width=0, opacity=0.9, name='Marginal R²',
        ))

        # Cumulative line on secondary axis
        fig.add_trace(go.Scatter(
            x=data['Step'], y=data['Cumulative_R2'],
            mode='lines+markers', name='Cumulative R²',
            line=dict(color='#dc2626', width=3),
            marker=dict(size=8), yaxis='y2',
        ))

        fig.update_layout(
            template=_PLOTLY_TEMPLATE,
            title="27. Incremental R² Waterfall (Forward Stepwise OLS)",
            xaxis_title="Input (entered in order of importance)",
            yaxis_title="Marginal R² Gain",
            yaxis2=dict(title="Cumulative R²", overlaying='y', side='right',
                        rangemode='tozero'),
            barmode='group',
        )
        return fig
    
    def chart_interaction_strength(self) -> go.Figure:
        """Heatmap of pairwise input interaction effects on MeanDelta.
        For top N inputs, fits y ~ x1 + x2 + x1*x2 and reports the 
        standardized interaction coefficient β_{x1*x2}."""
        ppl = self.ppl
        candidates = [c for c in self.input_stats
                    if c in ppl.columns and ppl[c].std() > 0]

        # Pre-select top 8 by |spearman r|
        scored = [(c, abs(scipy_stats.spearmanr(ppl[c], ppl['MeanDelta'])[0]))
                for c in candidates]
        scored.sort(key=lambda x: x[1], reverse=True)
        top = [s[0] for s in scored[:8]]

        if len(top) < 2:
            return _empty_fig("Interaction Strength")

        y = zscore(ppl['MeanDelta']).values
        interaction_matrix = pd.DataFrame(
            np.nan, index=top, columns=top, dtype=float
        )

        for i, f1 in enumerate(top):
            for j, f2 in enumerate(top):
                if i >= j:
                    continue  # upper triangle only
                x1 = zscore(ppl[f1]).values
                x2 = zscore(ppl[f2]).values
                x1x2 = x1 * x2
                X = np.column_stack([np.ones(len(ppl)), x1, x2, x1x2])
                try:
                    beta, se, r2 = ols_fit(X, y)
                    # The interaction coefficient is beta[3]
                    # Significant if |beta[3]| > 1.96 * se[3]
                    t_stat = beta[3] / se[3] if se[3] > 0 else 0
                    interaction_matrix.loc[f1, f2] = beta[3]
                    interaction_matrix.loc[f2, f1] = beta[3]
                except (ValueError, np.linalg.LinAlgError):
                    pass

        z = interaction_matrix.to_numpy(copy=True)
        np.fill_diagonal(z, 0)

        fig = go.Figure(data=go.Heatmap(
            z=interaction_matrix.values,
            x=interaction_matrix.columns,
            y=interaction_matrix.index,
            colorscale=DIVERGING_CMAP, zmid=0,
            hovertemplate="%{y} × %{x}<br>β_interaction: %{z:.3f}<extra></extra>",
            xgap=3, ygap=3,
        ))
        fig.update_layout(
            template=_PLOTLY_TEMPLATE,
            title="28. Pairwise Input Interaction Strength (Standardized β of x₁·x₂)",
            height=600, yaxis_autorange='reversed',
            xaxis_showgrid=False, yaxis_showgrid=False,
        )
        return fig


# ═══════════════════════════════════════════════════════════════════════════════
# HTML RENDERER : Assembles Plotly figures into a standalone offline dashboard.
# ═══════════════════════════════════════════════════════════════════════════════

class HTMLDashboard:
    """Generates a self-contained, offline HTML dashboard from Plotly figures."""

    def __init__(self, charts: Dict[str, go.Figure], convergence_stats: Dict):
        self._charts = charts
        self._conv = convergence_stats

    def render(self, out_path: Path) -> None:
        """Write the standalone HTML file to disk."""
        logger.info(f"Generating standalone HTML dashboard -> {out_path}")
        plotly_js = get_plotlyjs()

        # Convergence summary banner
        conv_pct = self._conv['pct_converged']
        max_mcse = self._conv['max_mcse']
        conv_color = '#16a34a' if conv_pct >= 0.95 else '#f97316' if conv_pct >= 0.8 else '#dc2626'

        html_str = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Progbox · Monte Carlo Analysis</title>
    <script type="text/javascript">{plotly_js}</script>
    <style>
        :root {{
            --bg-color: #f1f5f9; --card-bg: #ffffff; --text-main: #0f172a;
            --text-muted: #64748b; --border-color: #e2e8f0;
        }}
        body {{
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background-color: var(--bg-color); color: var(--text-main);
            margin: 0; padding: 40px 20px;
        }}
        .header {{ text-align: center; margin-bottom: 30px; }}
        .header h1 {{ font-size: 2.5rem; font-weight: 800; letter-spacing: -0.025em; margin: 0 0 8px 0; }}
        .header p {{ font-size: 1.1rem; color: var(--text-muted); margin: 0; }}
        .convergence-banner {{
            max-width: 1400px; margin: 0 auto 30px auto; padding: 16px 24px;
            border-radius: 10px; background: {conv_color}15; border: 1px solid {conv_color}40;
            display: flex; justify-content: space-between; align-items: center;
        }}
        .convergence-banner .stat {{ font-size: 1.3rem; font-weight: 700; color: {conv_color}; }}
        .convergence-banner .label {{ font-size: 0.9rem; color: var(--text-muted); }}
        .chart-container {{
            background: var(--card-bg); border-radius: 12px;
            box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03);
            padding: 30px; margin-bottom: 40px; max-width: 1400px;
            margin-left: auto; margin-right: auto; border: 1px solid var(--border-color);
            transition: box-shadow 0.3s ease;
        }}
        .chart-container:hover {{
            box-shadow: 0 10px 15px -3px rgba(0,0,0,0.07), 0 4px 6px -2px rgba(0,0,0,0.04);
        }}
    </style>
</head>
<body>
    <div class="header">
        <h1>Progbox</h1>
        <p>Interactive Post-Simulation Analysis</p>
    </div>
    <div class="convergence-banner">
        <div><span class="label">MC Convergence</span><br>
             <span class="stat">{conv_pct:.0%}</span>
             <span class="label"> of players (MCSE &lt; {Config.MCSE_CONVERGENCE_THRESHOLD})</span></div>
        <div><span class="label">Max MCSE</span><br>
             <span class="stat">{max_mcse:.2f}</span>
             <span class="label"> OVR pts</span></div>
    </div>
"""
        for title, fig in self._charts.items():
            fig_html = fig.to_html(full_html=False, include_plotlyjs=False)
            html_str += f'<div class="chart-container">{fig_html}</div>\n'

        html_str += "</body></html>"
        out_path.write_text(html_str, encoding='utf-8')
        size_mb = out_path.stat().st_size / 1e6
        logger.info(f"HTML dashboard saved. Size: {size_mb:.2f} MB")


# ═══════════════════════════════════════════════════════════════════════════════
# EXCEL RENDERER : Generates a formatted Excel workbook.
# ═══════════════════════════════════════════════════════════════════════════════

class ExcelWorkbook:
    """Generates a formatted multi-sheet Excel workbook from processed data."""

    def __init__(self, proc: DataProcessor, df: pd.DataFrame):
        self._proc = proc
        self._df = df

    def render(self, xlsx_path: Path) -> None:
        """Write the Excel workbook to disk."""
        logger.info(f"Writing Excel workbook -> {xlsx_path}")
        wb = Workbook()

        self._write_players(wb)
        self._write_attributes(wb)
        self._write_team_summary(wb)
        self._write_age_summary(wb)
        self._write_convergence(wb)
        self._write_icc(wb)
        self._write_all_runs(wb)

        # Remove default empty sheet
        if 'Sheet' in wb.sheetnames and len(wb.sheetnames) > 1:
            del wb['Sheet']

        wb.active = wb.sheetnames.index('Players')
        logger.info("Saving Excel workbook (this may take a moment)...")
        wb.save(xlsx_path)
        logger.info("Excel workbook saved successfully.")

    def _write_sheet(self, wb: Workbook, title: str, df: pd.DataFrame) -> None:
        """Utility: write a DataFrame to a named sheet with auto-filter."""
        if 'Sheet' in wb.sheetnames and len(wb.sheetnames) == 1:
            ws = wb['Sheet']
            ws.title = title
        else:
            ws = wb.create_sheet(title)

        for r_idx, row in enumerate(dataframe_to_rows(df, index=False, header=True), 1):
            for c_idx, val in enumerate(row, 1):
                cell = ws.cell(row=r_idx, column=c_idx, value=val)
                if isinstance(val, float) and np.isnan(val):
                    cell.value = None

        n_cols = len(df.columns)
        n_rows = len(df) + 1
        if n_cols > 0 and n_rows > 1:
            ws.auto_filter.ref = f"A1:{get_column_letter(n_cols)}{n_rows}"

    def _write_players(self, wb: Workbook) -> None:
        ppl = self._proc.per_player.copy().round(4)
        if self._proc.top_drivers:
            ppl['Primary_Driver'] = self._proc.top_drivers[0]
        self._write_sheet(wb, 'Players', ppl)
        logger.info("      -> Players (1/7)")

    def _write_attributes(self, wb: Workbook) -> None:
        ad = self._proc.attr_deltas
        ppl = self._proc.per_player
        if ad.empty:
            self._write_sheet(wb, 'Attributes', pd.DataFrame())
            logger.info("      -> Attributes (2/7) [EMPTY]")
            return

        avail = [c for c in self._proc.varying_attrs if c in ad.columns]
        attr_deltas = ad[avail].round(2).rename(columns=lambda c: f'D_{c}')
        mean_attrs = self._df.groupby('PlayerID')[avail].mean().round(2)

        attributes = (
            ppl[['PlayerID', 'Name', 'Team', 'Age', 'Baseline']]
            .set_index('PlayerID')
            .join(attr_deltas)
            .join(mean_attrs)
            .reset_index()
            .sort_values(['Age', 'Baseline'], ascending=[True, False])
        )
        self._write_sheet(wb, 'Attributes', attributes)
        logger.info("      -> Attributes (2/7)")

    def _write_team_summary(self, wb: Workbook) -> None:
        ppl = self._proc.per_player
        team = (
            ppl.groupby('Team')['MeanDelta']
            .agg(
                Players='count', Mean_Delta='mean', Std_Delta='std',
                Min_Delta='min', Max_Delta='max',
                Pct_Improved=lambda s: (s > 0).mean(),
            )
            .round(3)
            .sort_values('Mean_Delta', ascending=False)
            .reset_index()
        )
        self._write_sheet(wb, 'Team Summary', team)
        logger.info("      -> Team Summary (3/7)")

    def _write_age_summary(self, wb: Workbook) -> None:
        age = self._proc.age_summary.reset_index().round(4)
        self._write_sheet(wb, 'Age Summary', age)
        logger.info("      -> Age Summary (4/7)")

    def _write_convergence(self, wb: Workbook) -> None:
        conv = self._proc.convergence['player_stats'].reset_index().round(4)
        self._write_sheet(wb, 'Convergence', conv)
        logger.info("      -> Convergence (5/7)")

    def _write_icc(self, wb: Workbook) -> None:
        icc = self._proc.icc_data.round(4)
        self._write_sheet(wb, 'ICC Variance Decomp', icc)
        logger.info("      -> ICC Variance Decomp (6/7)")

    def _write_all_runs(self, wb: Workbook) -> None:
        all_runs = self._df.sort_values(['PlayerID', 'Run']).reset_index(drop=True).round(4)
        self._write_sheet(wb, 'All Runs', all_runs)
        logger.info("      -> All Runs (7/7)")


# ═══════════════════════════════════════════════════════════════════════════════
# PIPELINE : Main orchestration entry point.
# ═══════════════════════════════════════════════════════════════════════════════

def generate_analysis(run_dir: Optional[str] = None) -> None:
    """Main execution pipeline for the Monte Carlo analysis."""
    loader = DataLoader()
    base = Path(run_dir) if run_dir else loader.find_latest_run()
    raw_dir = base / 'raw'

    logger.info("=" * 60)
    logger.info("Progbox Analysis Pipeline")
    logger.info("=" * 60)

    # Load data
    df = loader.load_sim_data(raw_dir)
    baseline = loader.load_baseline()

    n_runs = df['Run'].nunique()
    n_players = df['PlayerID'].nunique()
    logger.info(f"Detected {n_runs} runs × {n_players} players = {len(df):,} total rows")

    # Process data
    proc = DataProcessor(df, baseline)

    # Generate Excel
    ExcelWorkbook(proc, df).render(base / 'analysis.xlsx')

    # Generate Charts
    logger.info("Generating interactive Plotly charts...")
    builder = ChartBuilder(proc, df)
    charts = builder.build_all()

    # Generate HTML
    HTMLDashboard(charts, proc.convergence).render(base / 'analysis_dashboard.html')

    logger.info(f"Done. Charts: {len(charts)} | Players: {n_players} | Runs: {n_runs}")
    logger.info("=" * 60)


def main() -> None:
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Post-simulation analysis: generates interactive HTML dashboard and Excel workbook."
    )
    parser.add_argument(
        "run_dir", nargs="?", default=None,
        help="Path to the specific run directory. Auto-discovers if omitted.",
    )
    args = parser.parse_args()
    try:
        generate_analysis(args.run_dir)
    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()