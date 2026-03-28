from __future__ import annotations

import math
import random
from dataclasses import dataclass
from typing import Optional

import numpy as np
import pandas as pd
"""
references: https://github.com/fearandesire/NoEyeTest/blob/dev/tiers.md
			https://github.com/zengm-games/zengm/blob/master/src/worker/core/player/ovr.basketball.ts
			noeyetest.js (https://github.com/fearandesire/NoEyeTest/blob/dev)
            working v4.1 prototype from: https://github.com/shawnmalik1/NoEyeTest-v4/blob/main/noeyetest_progs_v4.js

Progression is stat-driven (PER 70 %, DWS 20 %, EWA 10 %) and applied
per-skill via a [lo, hi] range, mirroring the JS exactly as far as possible.

v2: separation of concerns has been solidified and enforced, such that prog script can be changed independent of the monte carlo 
harness, and analysis module as long as strict public-facing API adherence is maintained.
"""


# ─────────────────────────────────────────────────────────────────────────────
#  Configuration
# ─────────────────────────────────────────────────────────────────────────────

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


# Pre-computed mapping: position of each OVR_CALC_ORDER attr inside ALL_ATTRS
_OVR_INDICES: list[int] = [Config.ALL_ATTRS.index(a) for a in Config.OVR_CALC_ORDER]


# ─────────────────────────────────────────────────────────────────────────────
#  OVR Calculation  (formula & constants unchanged from original)
# ─────────────────────────────────────────────────────────────────────────────

def _fudge_ovr(s: float) -> int:
    """Non-linear fudge factor applied after the linear dot-product."""
    if   s >= 68: fudge =  8.0
    elif s >= 50: fudge =  4.0 + (s - 50.0) * (4.0 / 18.0)
    elif s >= 42: fudge = -5.0 + (s - 42.0) * (9.0 /  8.0)
    elif s >= 31: fudge = -5.0 - (42.0 - s) * (5.0 / 11.0)
    else:         fudge = -10.0
    return max(0, min(100, int(round(s + fudge))))


def calcovr(attrs: dict) -> int:
    """Calculate OVR from an attribute dictionary."""
    vals = np.array([float(attrs.get(a, 0)) for a in Config.OVR_CALC_ORDER], dtype=float)
    return _fudge_ovr(float((vals - Config.OVR_CENTERS) @ Config.OVR_COEFFS + 48.5))


def calcovr_from_array(attrs: np.ndarray) -> int:
    """Calculate OVR from an ALL_ATTRS-ordered numpy array (fast path)."""
    vals = attrs[_OVR_INDICES]
    return _fudge_ovr(float((vals - Config.OVR_CENTERS) @ Config.OVR_COEFFS + 48.5))


# ─────────────────────────────────────────────────────────────────────────────
#  Progression Range
# ─────────────────────────────────────────────────────────────────────────────

def _age_range(age: int) -> str:
    if age >= 35: return '35+'
    if age >= 31: return '31-34'
    return '26-30'


def get_prog_range(per: float, dws: float, ewa: float,
                   ovr: int, age: int) -> tuple[int, int]:
    """
    Return the [lo, hi] per-skill prog range for a player.
    Mirrors JS v4.1 getProgRange() 1-to-1, including all cap logic.
    """
    cfg = Config.AGE_GROUP_CONFIG[_age_range(age)]
    min1, min2   = cfg['min1'],    cfg['min2']
    max1, max2   = cfg['max1'],    cfg['max2']
    hard_max     = cfg['hard_max']

    c = Config.COMPOSITE
    score = (per * c['per_w']
             + dws * c['dws_scale'] * c['dws_w']
             + ewa * c['ewa_scale'] * c['ewa_w'])

    # Base lo / hi
    if score <= 20 and age < 31:       # volatile range for low-composite young players
        lo = math.ceil(score / 5) - 6
        hi = math.ceil(score / 4) - 1
    else:
        lo = math.ceil(score / min1) - min2
        hi = (math.ceil(score / max1) - max2) if max1 else 0
        # JS: `if (!hardMax && max < 0) max = 0`, 35+ has hard_max=0 (falsy)
        if not hard_max and hi < 0:
            hi = 0

    if hi > hard_max:
        hi = hard_max

    # OVR cap: no player may prog past 80
    if ovr + hi >= Config.OVR_HARD_CAP:
        if ovr >= Config.OVR_HARD_CAP:
            hi = 0
            lo = -10 if 30 < age < 35 else (-14 if age >= 35 else -2)
        else:
            hi = Config.OVR_HARD_CAP - ovr
            if ovr + lo >= Config.OVR_HARD_CAP:
                lo = 0

    return (min(lo, hi), hi)   # guarantee lo ≤ hi


# ─────────────────────────────────────────────────────────────────────────────
#  Per-Skill Application  (v4.1 physical-decline gates)
# ─────────────────────────────────────────────────────────────────────────────

def _apply_skill(skill: str, val: float, lo: int, hi: int,
                 age: int, rng: random.Random) -> float:
    """
    Roll and apply a prog delta for a single skill.
    Physical skill restrictions match JS v4.1 exactly.
    """
    if age >= 30 and skill in Config.OLD_AGE_PHYS:
        if hi <= 0:                        # pure-decline path, apply directly
            delta = rng.randint(lo, hi)
        else:
            # ≈ 3.5 % average pass rate, matching JS `Math.random() > Math.random()*0.05+0.01`
            if rng.random() > rng.random() * 0.05 + 0.01:
                return val                 # skip, no change
            capped_hi = min(hi, 3)
            capped_lo = min(lo, capped_hi) # ensures lo ≤ hi after cap
            delta     = rng.randint(capped_lo, capped_hi)

    elif 26 <= age < 30 and skill in Config.MID_AGE_PHYS:
        delta = rng.randint(lo, hi)
        if delta > 0:
            # Linear fade: 70 % chance at 26, 40 % at 29
            if rng.random() > max(0.0, 0.7 - (age - 26) * 0.1):
                return val

    else:
        delta = rng.randint(lo, hi)

    return float(max(Config.ATTR_MIN, min(Config.ATTR_MAX, val + delta)))


# ─────────────────────────────────────────────────────────────────────────────
#  Core Progression Function
# ─────────────────────────────────────────────────────────────────────────────

def progplayer(player_row: np.ndarray,
               rng: random.Random) -> tuple[np.ndarray, Optional[dict]]:
    """
    Progress one player in-place using v4.1 logic.

    player_row layout (Config.NUMCOLS order):
        index 0       → Age
        indices 1-3   → PER, DWS, EWA
        indices 4-18  → ALL_ATTRS (dIQ … Hgt)

    Returns (modified_row, god_prog_info | None).
    """
    age = int(player_row[0])
    if age < Config.MIN_AGE:
        return player_row, None

    per, dws, ewa = float(player_row[1]), float(player_row[2]), float(player_row[3])
    attrs_view    = player_row[4: 4 + len(Config.ALL_ATTRS)]
    ovr           = calcovr_from_array(attrs_view)

    lo, hi        = get_prog_range(per, dws, ewa, ovr, age)
    god_info: Optional[dict] = None

    # God Progression: age < 30, OVR < 60, flat 2 % chance, overrides range
    gp = Config.GOD_PROG
    if age < gp['age_limit'] and ovr < gp['ovr_limit'] and rng.random() < gp['max_chance']:
        bonus    = rng.randint(gp['bonus_min'], gp['bonus_max'])
        lo = hi  = bonus
        god_info = dict(bonus=bonus, chance=gp['max_chance'], ovr=ovr, age=age)

    for i, attr in enumerate(Config.ALL_ATTRS):
        if attr in Config.PROG_KEYS:       # Hgt is not in PROG_KEYS → skipped
            player_row[4 + i] = _apply_skill(attr, player_row[4 + i],
                                              lo, hi, age, rng)
    return player_row, god_info


# ─────────────────────────────────────────────────────────────────────────────
#  Tracking
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class GodProgRecord:
    name:     str
    run_seed: int
    age:      int
    ovr:      int
    bonus:    int
    chance:   float


class ProgressionTracker:
    """Accumulates god-progression events across every simulation run."""

    def __init__(self) -> None:
        self.god_prog_count:    int                  = 0
        self.player_god_counts: dict[str, int]       = {}
        self.records:           list[GodProgRecord]  = []

    def record(self, name: str, run_seed: int, info: dict) -> None:
        self.god_prog_count += 1
        self.player_god_counts[name] = self.player_god_counts.get(name, 0) + 1
        self.records.append(GodProgRecord(
            name=name, run_seed=run_seed,
            age=info.get('age', 0), ovr=info.get('ovr', 0),
            bonus=info.get('bonus', 0), chance=info.get('chance', 0.0),
        ))

    def to_dataframes(self) -> tuple[pd.DataFrame, pd.DataFrame]:
        """Return (godprogs_df, superlucky_df) ready for JSON export."""
        godprogs = (
            pd.DataFrame([vars(r) for r in self.records])
            if self.records else pd.DataFrame()
        )
        superlucky = (
            pd.DataFrame(list(self.player_god_counts.items()),
                         columns=['Name', 'GodProgCount'])
            if self.player_god_counts
            else pd.DataFrame(columns=['Name', 'GodProgCount'])
        )
        return godprogs, superlucky


# ─────────────────────────────────────────────────────────────────────────────
#  Analytics
# ─────────────────────────────────────────────────────────────────────────────

class SimAnalytics:
    """
    Built-in analytics layer for Monte Carlo results.

    Consume the DataFrame returned by runsim.PROGEMUP().
    Every public method returns a DataFrame so results can be saved or
    merged into the Excel workbook alongside the raw data.
    Call .print_report() for an instant console summary.
    """

    def __init__(self, results: pd.DataFrame,
                 tracker: Optional[ProgressionTracker] = None) -> None:
        self._df      = results
        self._tracker = tracker

    # ── Per-player summaries ──────────────────────────────────────────────────

    def player_summary(self) -> pd.DataFrame:
        """Full OVR statistics per player, aggregated over all runs."""
        return (
            self._df.groupby('Name', sort=True).agg(
                Team        = ('Team',      'first'),
                Age         = ('Age',       'first'),
                Baseline    = ('Baseline',  'first'),
                MeanOvr     = ('Ovr',       'mean'),
                MeanDelta   = ('Delta',     'mean'),
                StdDelta    = ('Delta',     'std'),
                MinOvr      = ('Ovr',       'min'),
                MaxOvr      = ('Ovr',       'max'),
                Q10         = ('Delta',     lambda s: s.quantile(0.10)),
                Q25         = ('Delta',     lambda s: s.quantile(0.25)),
                Q75         = ('Delta',     lambda s: s.quantile(0.75)),
                Q90         = ('Delta',     lambda s: s.quantile(0.90)),
                PctPositive = ('Delta',     lambda s: (s > 0).mean()),
            )
            .round(3)
            .reset_index()
        )

    def attribute_means(self) -> pd.DataFrame:
        """Mean final attribute value per player, averaged over all runs."""
        attr_cols = [c for c in self._df.columns if c in Config.PROG_KEYS]
        return (
            self._df[['Name'] + attr_cols]
            .groupby('Name', sort=True)
            .mean()
            .round(2)
            .reset_index()
        )

    # ── Group breakdowns ──────────────────────────────────────────────────────

    def age_group_breakdown(self) -> pd.DataFrame:
        """Delta statistics grouped by age tier (26-30 / 31-34 / 35+)."""
        df = self._df.assign(
            AgeGroup=pd.cut(self._df['Age'],
                            bins=[0, 30, 34, 999],
                            labels=['26-30', '31-34', '35+'],
                            right=True)
        )
        return (
            df.groupby('AgeGroup', observed=True)['Delta']
              .agg(Mean='mean', Std='std', Min='min', Max='max', Count='count')
              .round(3)
        )

    # ── Rankings ─────────────────────────────────────────────────────────────

    def top_risers(self, n: int = 10) -> pd.DataFrame:
        """Players with the highest mean OVR delta."""
        return self._rank_by_delta('nlargest', n)

    def top_fallers(self, n: int = 10) -> pd.DataFrame:
        """Players with the lowest mean OVR delta."""
        return self._rank_by_delta('nsmallest', n)

    def _rank_by_delta(self, method: str, n: int) -> pd.DataFrame:
        means = self._df.groupby('Name')['Delta'].mean().round(3)
        return (
            getattr(means, method)(n)
            .reset_index()
            .rename(columns={'Delta': 'MeanDelta'})
        )

    # ── Distributions ─────────────────────────────────────────────────────────

    def ovr_distribution(self) -> pd.DataFrame:
        """Frequency of each final OVR value across all runs and players."""
        return (
            self._df['Ovr']
            .value_counts().sort_index().reset_index()
            .rename(columns={'Ovr': 'FinalOvr', 'count': 'Frequency'})
        )

    def delta_distribution(self) -> pd.DataFrame:
        """Frequency of each OVR delta value."""
        return (
            self._df['Delta']
            .value_counts().sort_index().reset_index()
            .rename(columns={'Delta': 'OvrDelta', 'count': 'Frequency'})
        )

    # ── God Progression ───────────────────────────────────────────────────────

    def god_prog_summary(self) -> Optional[pd.DataFrame]:
        """Count and averages of god-progression events per player."""
        if not self._tracker or not self._tracker.records:
            return None
        gp_df, _ = self._tracker.to_dataframes()
        return (
            gp_df.groupby('name', sort=True)
                 .agg(GodProgCount=('bonus', 'count'),
                      AvgBonus    =('bonus', 'mean'),
                      AvgOvr      =('ovr',   'mean'))
                 .round(3)
                 .reset_index()
                 .rename(columns={'name': 'Name'})
        )

    # ── Console report ────────────────────────────────────────────────────────

    def print_report(self) -> None:
        """Print a formatted summary to stdout."""
        bar = '─' * 58
        print(f'\n{"="*58}\n SIMULATION ANALYTICS REPORT\n{"="*58}')
        for label, df in [
            ('TOP 10 RISERS  (mean OVR Δ)',  self.top_risers()),
            ('TOP 10 FALLERS  (mean OVR Δ)', self.top_fallers()),
        ]:
            print(f'\n{bar}\n {label}\n{bar}')
            print(df.to_string(index=False))
        print(f'\n{bar}\n AGE GROUP BREAKDOWN\n{bar}')
        print(self.age_group_breakdown().to_string())
        gp = self.god_prog_summary()
        if gp is not None and not gp.empty:
            print(f'\n{bar}\n GOD PROGRESSIONS  ({len(gp)} players)\n{bar}')
            print(gp.to_string(index=False))
        print(f'\n{"="*58}')


# ─────────────────────────────────────────────────────────────────────────────
#  Progression Sandbox  (base class consumed by runsim)
# ─────────────────────────────────────────────────────────────────────────────

class ProgressionSandbox:
    """Owns a ProgressionTracker and applies a single roster-wide prog pass."""

    def __init__(self, seed: int = 0) -> None:
        self.tracker = ProgressionTracker()
        self._rng    = random.Random(seed)

    def progress_roster(self,
                        roster_df: pd.DataFrame,
                        rng: Optional[random.Random] = None,
                        run_seed: int = 0) -> pd.DataFrame:
        """
        Apply one progression pass to every eligible player.
        Returns a new DataFrame, input is not mutated.
        All columns listed in Config.NUMCOLS must be present.
        """
        rng = rng or self._rng
        out = roster_df.copy(deep=True)

        for col in Config.NUMCOLS:
            if col not in out.columns:
                out[col] = 0.0
        if 'Ovr' not in out.columns:
            out['Ovr'] = 0

        num_arr = out[Config.NUMCOLS].to_numpy(dtype=np.float64)

        for i in range(len(num_arr)):
            if int(num_arr[i, 0]) < Config.MIN_AGE:
                continue
            _, god_info = progplayer(num_arr[i], rng)
            if god_info is not None:
                name = (out.at[out.index[i], 'Name']
                        if 'Name' in out.columns else f'Player_{i}')
                self.tracker.record(str(name), run_seed, god_info)

        out[Config.NUMCOLS] = num_arr

        # Vectorised OVR recalc from updated attribute slice
        attrs_block = num_arr[:, 4: 4 + len(Config.ALL_ATTRS)]
        out['Ovr']  = [calcovr_from_array(attrs_block[i]) for i in range(len(out))]
        return out