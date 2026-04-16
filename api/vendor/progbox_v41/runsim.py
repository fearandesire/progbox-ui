"""
runsim.py  ·  NoEyeTest Monte Carlo Simulation Runner
Wraps ProgressionSandbox in a parallelised multi-run engine.

Each run is fully independent (separate RNG seed, separate worker state),
so parallelism is embarrassingly simple. The DataFrame is serialised once
per worker process via the Pool initializer, not once per task.

Typical usage
-------------
    sim     = runsim(seed=69)
    results = sim.PROGEMUP(data, runs=1000, output_dir='outputs/raw')
    results.to_csv('outputs/raw/outputs.csv')
    sim.analytics.print_report()

Windows note
------------
Wrap the call site in  `if __name__ == '__main__':`  or multiprocessing
will fork-bomb on spawn-based platforms.
"""
from __future__ import annotations

import json
import multiprocessing as mp
import os
import random
import sys
from pathlib import Path
from typing import Optional

# Ensure worker processes (multiprocessing spawn) can import `progutils` from this directory.
_VDIR = Path(__file__).resolve().parent
if str(_VDIR) not in sys.path:
    sys.path.insert(0, str(_VDIR))

import numpy as np
import pandas as pd
from tqdm import tqdm
from progutils import (
    Config,
    ProgressionSandbox,
    ProgressionTracker,
    SimAnalytics,
    calcovr_from_array,
)
from workspace import REPO_ROOT


# ─────────────────────────────────────────────────────────────────────────────
#  Module-level worker state
#  Must live at module scope so multiprocessing can pickle the references.
# ─────────────────────────────────────────────────────────────────────────────

_worker_df:      Optional[pd.DataFrame]       = None
_worker_sandbox: Optional[ProgressionSandbox] = None


def _worker_init(df: pd.DataFrame) -> None:
    """
    Called once per worker process when the Pool starts.
    Stores the roster DataFrame and a reusable ProgressionSandbox in globals
    so they are not re-serialised for every task.
    """
    global _worker_df, _worker_sandbox
    _worker_df      = df
    _worker_sandbox = ProgressionSandbox(seed=0)   # seed overridden per task


def _worker_run(task: tuple[int, int, list]) -> tuple[int, np.ndarray, list]:
    """
    Execute one simulation run inside a worker process.

    Parameters
    ----------
    task : (run_idx, run_seed, players)

    Returns
    -------
    (run_idx, result_array, god_prog_records)
        result_array columns:
            0     → Ovr
            1-3   → PER, DWS, EWA
            4-18  → ALL_ATTRS
    """
    run_idx, run_seed, players = task

    # Fresh tracker per run, prevents records bleeding across tasks in one worker
    _worker_sandbox.tracker = ProgressionTracker()

    progressed = _worker_sandbox.progress_roster(
        _worker_df,
        rng=random.Random(run_seed),
        run_seed=run_seed,
    ).reindex(players)

    ovr_col   = progressed['Ovr'].fillna(0).to_numpy(dtype=np.float64).reshape(-1, 1)
    stats_col = progressed[Config.STAT_COLS[1:]].fillna(0).to_numpy(dtype=np.float64)
    attr_col  = progressed[Config.ALL_ATTRS].fillna(0).to_numpy(dtype=np.float64)

    result  = np.hstack([ovr_col, stats_col, attr_col])
    records = list(_worker_sandbox.tracker.records)   # copy before tracker resets
    return run_idx, result, records


# ─────────────────────────────────────────────────────────────────────────────
#  runsim
# ─────────────────────────────────────────────────────────────────────────────

class runsim(ProgressionSandbox):
    """
    Monte Carlo wrapper for the NoEyeTest progression engine.

    Inherits ProgressionSandbox for the single-pass logic and tracker,
    then orchestrates N independent runs in parallel using a process Pool.
    After PROGEMUP() completes, .analytics is a ready SimAnalytics instance.
    """

    def __init__(self, seed: int) -> None:
        super().__init__(seed=seed)
        self.seed        = seed
        self._master_rng = random.Random(seed)
        self.analytics:  Optional[SimAnalytics] = None

    # ─────────────────────────────────────────────────────────────────────────
    #  Data preparation
    # ─────────────────────────────────────────────────────────────────────────

    @staticmethod
    def _prepare_baseline(df: pd.DataFrame) -> tuple[list, np.ndarray, pd.DataFrame]:
        players    = list(df.index)
        meta       = df[['Name', 'Team', 'Age']].fillna('').copy()
        base_attrs = df[Config.ALL_ATTRS].fillna(0).to_numpy(dtype=np.float64)
        base_ovr   = np.array(
            [calcovr_from_array(base_attrs[i]) for i in range(len(players))],
            dtype=np.float64,
        )
        return players, base_ovr, meta

    # ─────────────────────────────────────────────────────────────────────────
    #  Result assembly
    # ─────────────────────────────────────────────────────────────────────────

    @staticmethod
    def _assemble_results(sim_results: list[np.ndarray],
                          base_ovr:    np.ndarray,
                          players:     list,
                          meta:        pd.DataFrame,
                          run_seeds:   list[int]) -> pd.DataFrame:
        """Flatten (runs × players × cols) into a long-format DataFrame."""
        stacked    = np.stack(sim_results, axis=0)   # (n_runs, n_players, ncols)
        n_runs     = len(sim_results)
        n_players  = len(players)

        sim_ovr    = stacked[:, :, 0].flatten()
        tiled_base = np.tile(base_ovr, n_runs)
        delta      = sim_ovr - tiled_base

        with np.errstate(divide='ignore', invalid='ignore'):
            pct_change = np.where(tiled_base != 0, delta / tiled_base, 0.0)

        frame: dict = {
            'Run':           np.repeat(np.arange(n_runs), n_players),
            'RunSeed':       np.repeat(run_seeds, n_players),
            'PlayerID':      np.tile(players, n_runs),
            'Baseline':      tiled_base,
            'Ovr':           sim_ovr,
            'Delta':         delta,
            'PctChange':     pct_change,
            'AboveBaseline': sim_ovr > tiled_base,
        }
        for col in meta.columns:
            frame[col] = np.tile(meta[col].values, n_runs)
        for i, stat in enumerate(Config.STAT_COLS[1:], start=1):
            frame[stat] = stacked[:, :, i].flatten()
        for i, attr in enumerate(Config.ALL_ATTRS, start=4):
            frame[attr] = stacked[:, :, i].flatten()

        head = ['Run', 'RunSeed', 'Name', 'Team', 'Age', 'PlayerID',
                'Baseline', 'Ovr', 'Delta', 'PctChange', 'AboveBaseline']
        tail = Config.STAT_COLS[1:] + Config.ALL_ATTRS
        return pd.DataFrame(frame)[head + tail]

    # ─────────────────────────────────────────────────────────────────────────
    #  Log export
    # ─────────────────────────────────────────────────────────────────────────

    def _export_logs(self, output_dir: str | Path) -> None:
        out_path = self._resolve_output_path(output_dir)
        out_path.mkdir(parents=True, exist_ok=True)

        godprogs_df, superlucky_df = self.tracker.to_dataframes()

        records = godprogs_df.to_dict('records') if not godprogs_df.empty else []
        with open(out_path / 'godprogs.json', 'w', encoding='utf-8') as fh:
            json.dump(records, fh, ensure_ascii=False, indent=2)

        lucky = (dict(zip(superlucky_df['Name'], superlucky_df['GodProgCount']))
                 if not superlucky_df.empty else {})
        with open(out_path / 'superlucky.json', 'w', encoding='utf-8') as fh:
            json.dump(lucky, fh, ensure_ascii=False, indent=2)

        count = self.tracker.god_prog_count
        print(f'\nGod Progressions: {count}' if count else '\nNo god progressions.')
        print(f'Logs → {out_path}')

    @staticmethod
    def _resolve_output_path(output_dir: str | Path) -> Path:
        # Use monorepo root so outputs resolve to <repo>/outputs/... (not under vendor/)
        workspace = REPO_ROOT
        path      = Path(output_dir)
        if not path.is_absolute():
            path = (workspace / path).resolve()
        try:
            path.relative_to(workspace)
        except ValueError:
            path = workspace / 'outputs' / 'raw'
            print(f'Warning: path outside workspace, using {path}')
        return path

    # ─────────────────────────────────────────────────────────────────────────
    #  Public API
    # ─────────────────────────────────────────────────────────────────────────

    def PROGEMUP(self,
                 initial_df: pd.DataFrame,
                 runs:       int = 100,
                 output_dir: str = 'outputs/raw',
                 n_workers:  Optional[int] = None) -> pd.DataFrame:
        """
        Run a parallelised Monte Carlo simulation over initial_df.

        Parameters
        ----------
        initial_df : DataFrame with Config.NUMCOLS + Name / Team columns.
        runs       : Number of independent simulation passes.
        output_dir : Directory for godprogs.json / superlucky.json.
        n_workers  : Worker processes. Defaults to os.cpu_count().
                     Pass 1 to force single-process (useful for debugging).

        Returns
        -------
        Long-format DataFrame, one row per (player × run).
        self.analytics is populated immediately after this returns.
        """
        n_workers = n_workers or os.cpu_count() or 1
        players, base_ovr, meta = self._prepare_baseline(initial_df)

        run_seeds = [self._master_rng.randint(0, 2**63 - 1) for _ in range(runs)]
        tasks     = [(idx, seed, players) for idx, seed in enumerate(run_seeds)]

        print(f'Starting simulation: {runs} runs · seed={self.seed} · '
              f'{n_workers} workers · {len(players)} players')

        # ── Parallel execution ────────────────────────────────────────────────
        # imap_unordered streams results as workers finish (ideal for tqdm).
        # We sort by run_idx afterward to guarantee deterministic output order.
        raw_results: list[tuple[int, np.ndarray, list]] = []
        print('')
        with mp.Pool(
            processes=n_workers,
            initializer=_worker_init,
            initargs=(initial_df,),
        ) as pool:
            with tqdm(total=runs, desc='Simulating', unit='run',
                        dynamic_ncols=True, colour='green',
                        file=sys.stderr, leave=True, position=0) as bar:
                for result in pool.imap_unordered(_worker_run, tasks, chunksize=4):
                    raw_results.append(result)
                    bar.update()

        # ── Sort & unpack ─────────────────────────────────────────────────────
        raw_results.sort(key=lambda t: t[0])
        ordered_arrays = [r[1] for r in raw_results]

        # Merge god-prog records from every worker run back into self.tracker
        for _, _, records in raw_results:
            for rec in records:
                self.tracker.records.append(rec)
                self.tracker.god_prog_count += 1
                self.tracker.player_god_counts[rec.name] = (
                    self.tracker.player_god_counts.get(rec.name, 0) + 1
                )

        # ── Assemble & finalise ───────────────────────────────────────────────
        print('Assembling results…')
        results = self._assemble_results(ordered_arrays, base_ovr, players, meta, run_seeds)

        self._export_logs(output_dir)
        self.analytics = SimAnalytics(results, self.tracker)

        print(f'Done · {len(results):,} rows · {results.shape[1]} columns')
        return results