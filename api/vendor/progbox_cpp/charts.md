# ProgBox Chart Reference

A technical reference for every chart the post-processor (`tools/analysis.py`) renders, with the underlying mathematics and how to read each one.

This reference is **script-agnostic**. The post-processor works on the columns every progression emits (`Delta`, `Baseline`, `Age`, the 15 attributes, and the input stats), so nothing here assumes a particular script. Where a chart points at "a lever," it names the *category* of mechanism (youth development, the cap, the decline schedule, correlated run noise, an input's weight). A handful of facts are genuinely universal because they come from the shared OVR formula (`ovr_math.hpp`) which is a reproduction of how BBGM calculates OVR.

The dashboard has **two modes**, chosen by how many run directories you pass:

- **Single-run** (`analysis.py <run_dir>`, or auto-invoked by the engine): a seven-section deep-dive plus an interactive Player Explorer.
- **Comparison** (`analysis.py <run_dir_A> <run_dir_B> …`): a scorecard and overlays across N runs. "Which script better matches my intent?"

Both write one self-contained HTML file that embeds cleanly via `<iframe>`.

Notation: for player $i$ on run $r$,

$$\Delta_{i,r} = \text{Ovr}_{i,r} - \text{Baseline}_i$$

is the one-season OVR change; $\bar{\Delta}_i$ and $\sigma_{\Delta_i}$ are that player's mean and SD across the $R$ runs. **Production** (used only by the separation KPIs) is $\text{OBPM}+\text{DBPM}$ when those columns are present, else PER. This is the most elegant choice I could think of, that is independent of any individual progression script.

---

## Shared estimators

Three helpers feed several charts *and* the comparison scorecard for consistency.

**Peak age & decline slope** (`estimate_peak`). The per-age mean curve is scanned for sign changes; the **last** positive→negative crossing is the peak, with the age linearly interpolated:

$$\text{peak} = a_1 + (0 - m_1)\frac{a_2 - a_1}{m_2 - m_1}$$

The decline slope is an OLS fit to the mean curve over ages after the peak.

**Cluster bootstrap CI** (`cluster_bootstrap_ci`). Age-curve bands resample **players** (clusters), not player-runs, so correlation across a player's runs isn't mistaken for independent evidence.

**Talent separation** (`separation_gap`, `partial_separation_gap`). Within an age band, players split into production terciles; the gap is:

$$\overline{\bar{\Delta}}_{\text{top}} - \overline{\bar{\Delta}}_{\text{bottom}}$$

The *partial* variant computes that gap **inside fixed baseline-OVR bands and averages them**, controlling for OVR level so a cap that correctly holds down high-OVR studs doesn't read as unfairness. Raw ≪ partial ⇒ the cap is compressing the top; both negative ⇒ possible unfairness.

---

# Single-run dashboard

## §1 · League Health

### 1. Pre vs Post OVR Distribution (`chart_pre_vs_post_ovr`)

**Math.** Gaussian KDEs (Scott's rule) of Baseline (pre) and mean simulated OVR (post). Because pre and post are the **same players**, the comparison is *paired*:
a Wilcoxon signed-rank on the per-player differences, a paired $d_z = \overline{\Delta}/s_\Delta$ effect size, and a bootstrap 95% CI on the mean shift (3000 resamples). Spread change is $(\sigma_{\text{post}}/\sigma_{\text{pre}} - 1)$.

**Tuning.** The headline drift check: is the league, in aggregate, inflating or deflating? $|d_z|$ classifies the move (0.2/0.5/0.8 = small/med/large). A large, significant, tight-CI shift means the net of all your development and decline terms is biased in one direction.

### 2. Per-Player Pre → Post OVR (`chart_pre_post_scatter`)

**Math.** Baseline vs mean simulated OVR against the $y=x$ identity, colored by age tier, with an OLS fit. Slope $<0.95$ = compressive (regression to the mean); $>1.05$ = expansive.

**Tuning.** Reads the balance between your cap and your floor. A compressive slope whose compression concentrates at high baseline means the cap is doing the work; an expansive slope means low-baseline players aren't being lifted enough.

### 3. Quintile Transition (`chart_cohort_transition`)

**Math.** Row-normalized crosstab of pre-sim quintile × post-sim quintile; the diagonal is "stayed in cohort," and average retention is annotated.

**Tuning.** Below-diagonal mass in old rows is normal decline. The same in **young** rows means prospects slide backwards, implying youth development isn't outpacing early
physical decline.

---

## §2 · Age Curve

### 4. Age Curve (`chart_age_curve`)

**Math.** Mean $\Delta$ per integer age with a cluster-bootstrap 95% CI band; peak and post-peak slope from `estimate_peak`.

**Tuning.** *The* chart. Peak age is wherever your script crosses from net development to net decline; the post-peak slope is your decline schedule.

### 5. Outcome Envelope by Age (`chart_age_curve_bands`)

**Math.** Per-age P5/P50/P95 ribbon plus $\sigma(\Delta)$ on a secondary axis.

**Tuning.** Whether volatility tracks the mean. Sharp P95 asymmetry in the young tier is a right-tail upside mechanism.

### 6. Per-Group Attribute Δ by Age (`chart_age_group_curves`)

**Math.** For Physical / Shooting / Mental / Skill, the **unweighted** mean of each group's raw attribute deltas per age, giving you the lifecycle *shape*, not OVR impact (a big move on a low-coefficient attribute counts as much as a small move on a high one here).

**Tuning.** Physicals should decline earlier and harder than skills/mental, if the latter declines at all.

---

## §3 · Attribute Movement

### 7. Age × Attribute Heatmap (`chart_attr_age_heatmap`)

**Math.** Mean $\Delta$ per (age, attribute), group-ordered columns, diverging colorscale symmetric about 0 and clipped at the 97th percentile of $|z|$.

**Tuning.** Read a column top-to-bottom to find the age where each attribute flips sign.

### 8. Per-Attribute Age Curves (`chart_per_attribute_age_curves`)

**Math.** Small-multiples of mean $\Delta$ vs age per varying attribute, with $\pm 1.96\,\text{SEM}$ bars.

**Tuning.** The group chart (6) averages four curves and hides the outlier. Use this to catch a single misbehaving attribute (e.g. speed declining from 24 while strength holds to 28) and adjust just that attribute's age behavior.

### 9. ΔOVR Level Decomposition (`chart_ovr_decomposition`)

**Math.** Per-attribute contribution to the **level** of ΔOVR by age tier, $c_j \cdot \overline{\Delta_{\text{attr}_j}}$, where $c_j$ is the OVR coefficient from the shared formula.

**Tuning.** The only chart that separates cosmetic movement from OVR-moving movement: a large swing on a low-coefficient attribute contributes little, while dIQ, oIQ and Hgt (coef ≈ 0.13–0.16, the shared formula's heaviest) dominate. A script that develops a high-coefficient attribute moves OVR a lot; one that leaves it flat won't, no matter how much lower-coefficient movement it produces.

### 10. ΔOVR Variance Decomposition (`chart_ovr_variance_decomposition`)

**Math.** Per-attribute contribution to the **between-player spread** of ΔOVR, $c_j \cdot \text{Cov}(\Delta_j, \Delta\text{OVR}_{\text{implied}})$. By linearity of covariance the bars sum *exactly* to $\text{Var}(\Delta\text{OVR})$ across players.

> This is between-player dispersion of each player's *mean* movement, **not**
> run-to-run RNG. Run-to-run noise is the within-player variance in the ICC chart (§6).

**Tuning.** One dominant bar means a single attribute's cross-player spread carries the OVR dispersion; negative bars move opposite to ΔOVR.

### 11. Attribute Co-Movement (`chart_attr_comovement`)

**Math.** Two Spearman matrices: **(a) between-player** on per-player mean deltas, and **(b) within-run** on the average over players of each player's run-wise attribute correlation (one batched pass: rank along the run axis, `einsum` the per-player correlation stack, and finally nanmean over players).

**Tuning.** Strong **between-player** structure is systematic co-movement from tuning (one mechanism lifting several attributes together). Strong **within-run** structure
with weak between-player structure is correlated *noise*. A common per-run shock (if your script uses one) shows up here.

### 12. Boundary Saturation (`chart_attribute_saturation`)

**Math.** Per age tier, the fraction of (player, run) attribute values pinned at
ceiling ($\ge 99$) or floor ($\le 1$), as mirrored horizontal bars.

**Tuning.** A clamp that fires constantly is invisible in every other chart. Floor saturation on physicals for the Oldest tier is expected; floor saturation on mental attributes, or ceiling saturation on a skill for the Youngest, means the script can't move those players. In such a case, you would widen headroom or reduce whatever term is pinning them.

---

## §4 · Per-Player Outcomes

### 13. Risk-Return Map (`chart_risk_return`)

**Math.** Each player at $(\bar\Delta_i, \sigma_{\Delta_i})$, colored by baseline, with median quadrant lines: STAR (high μ, low σ), VOLATILE (high μ, high σ), STABLE (low μ, low σ), DANGER (low μ, high σ).

**Tuning.** High-baseline players clustering in DANGER means the cap makes elites both decline and thrash. A DANGER-heavy map feels punishing; a STAR/STABLE-heavy map is healthy.

### 14. Outcome Distributions by Tier (`chart_outcome_distributions`)

**Math.** KDE of every $\Delta_{i,r}$ by age tier, with pairwise KS and Cohen's d (tiers are different players, so independence holds here unlike chart 1).

**Tuning.** A long right tail in the Youngest tier is an upside/lottery mechanism; a long left tail in the Oldest tier is catastrophic decline. Tail thickness is set by your large-jump events and decline schedule.

### 15. Improvement Probability (`chart_improve_probability`)

**Math.** $P(\Delta>0)$ vs baseline with a per-tier logistic fit $P = \sigma(\beta_0 + \beta_1\,\text{Baseline})$ (logit argument clipped for overflow).

**Tuning.** A clean monotonic decline says the cap bites. If the Youngest tier stays near 100% across *all* baselines, age is swamping the cap for young players, resulting in something that might be too forgiving of young players. make youth development depend more on talent or reduce its uniform components.

---

## §5 · Input Sensitivity

### 16. Marginal Input Effects (`chart_controlled_input_effects`)

**Math.** For each input, a standardized OLS $\beta$ on MeanDelta controlling for Age + Baseline with a bootstrap 95% CI (600 resamples). Near-duplicate inputs ($|r|\ge 0.95$, e.g. EWA ≡ PER) are collapsed to one labeled representative. A CI straddling zero indicates no detectable marginal effect.

> Marginal and not unique: BBGM's advanced stats are heavily collinear (EWA is a function of PER), so a joint model has VIFs in the millions. For collinearity-robust importance, read chart 17.

**Tuning.** Confirms which inputs actually track outcomes. An input the script is supposed to key on showing a zero-straddling CI means its weight is too small or it isn't wired into the progression.

### 17. Shapley R² Importance (`chart_incremental_r2`)

**Math.** Each input's Shapley-averaged marginal $R^2$ over MeanDelta across 200 random inclusion orderings (subset $R^2$ cached; candidates capped at the 12 strongest $|\rho_S|$ so the $2^k$ subset space can't explode). Shapley splits shared credit symmetrically, so the ranking is stable under collinearity.

**Tuning.** tells you which inputs matter. Total $R^2$ is the explainable share of between-player MeanDelta variance; $1 - R^2$ is identity-independent RNG.

### 18. Partial Dependence (`chart_partial_dependence`)

**Math.** Age + Baseline are regressed out of MeanDelta; the residual is plotted against each top input's quantile (8 bins, SEM bars), top-6 by $|\rho_S|$ with the residual.

**Tuning.** Reveals the *shape* correlations hide: a clean ramp = linear wiring; a flat-then-kink = a threshold; a bump = non-monotonic. If your script maps an input linearly but the curve kinks, something upstream is clamping it.

---

## §6 · RNG Calibration

### 19. ICC per Attribute (`chart_icc`)

**Math.** One-way ICC per varying attribute, $\text{ICC} = \sigma^2_{\text{between}} / (\sigma^2_{\text{between}} + \sigma^2_{\text{within}})$ (between = variance of player means, within = mean of within-player variances), plus Ovr(agg). Bars: green $\ge 0.7$, orange $\ge 0.4$, red below.

**Tuning.** Signal vs RNG. Aim for the bulk in ~0.4–0.85. Below 0.4, identity barely matters (too random). Above ~0.9 the run is nearly deterministic. note *why*: independent per-attribute noise largely **cancels** at OVR (a property of the shared formula, $\Sigma c_j^2 \approx 0.085$), so adding more of it barely moves OVR variance. To make OVR itself less predictable, a script needs movement that is *correlated across attributes* within a run.

### 20. Convergence (`chart_convergence`)

**Math.** For the 6 most volatile players, the running mean and $\text{MCSE}_k = s_k/\sqrt{k}$ ribbon; the global % of players with $\text{MCSE} < 0.5$ OVR is annotated.

**Tuning.** If the ribbons haven't narrowed by the last run, or global convergence is < 95%, add Monte Carlo passes (`-r`) before trusting any other chart.

### 21. Rank Stability (`chart_rank_stability`)

**Math.** Kendall's $W$ concordance across runs with a large-sample significance test $\chi^2 = m(n-1)W$ (df $= n-1$), plus per-player **rank swing** = SD of the player's league rank across runs, in slots.

**Tuning.** $W \approx 1$ = rigid ordering (runs barely reorder players); $W < 0.4$ =
runs scramble the board. Rank swing shows *where* the churn concentrates.

---

## §7 · Diagnostics

### 22. Outlier Detection (`chart_outlier_detection`)

**Math.** Mahalanobis distance in $(\bar\Delta, \sigma_\Delta)$ space; $D^2 \sim \chi^2(2)$, players with $p<0.05$ flagged; 90%/99% ellipses oriented by the actual covariance.

**Tuning.** A high-μ/low-σ outlier is a "guaranteed riser". You should check it isn't bypassing the cap. A low-μ/high-σ outlier is a coin flip. Several outliers sharing a trait means an archetype is exploiting a gap in how the script handles some input, or being beat up.

### 23. Funnel (Heteroscedasticity) (`chart_funnel`)

**Math.** $\sigma(\Delta)$ vs baseline with a rolling mean and a Spearman heteroscedasticity test. $\rho < -0.3,\ p<0.05$ = the cap compresses variance; $\rho > 0.3$ = variance grows with baseline (unusual).

**Tuning.** The direct read on whether the cap is biting. A narrowing funnel confirms it engages; a flat or expanding one means it isn't reaching where you intended.

---

## §8 · Player Explorer (interactive widget)

A client-side selector over a compact embedded payload (one record per player, independent of run count), so any of the hundreds of players renders on demand without emitting hundreds of figures! Took some inventive plotly inlining to get this to work efficiently.

**Distribution panel.** The player's ΔOVR outcome as a **probability mass function over their own support**: since OVR is an integer, $\Delta$ is an integer and each bar is $P(\Delta = k)$. A percentile ruler (P5–P95 thin, P25–P75 thick, median tick) sits above the bars, and reference lines mark $\Delta=0$, the player's mean, and the league mean. The corner readout gives P(improve), P(decline), the 90% range, and P(jump ≥ +5).

**Attribute panel.** The player's coef-weighted attribute movement ($c_j \cdot \overline{\Delta_j}$) as horizontal bars in OVR-impact units, grouped by color.

**Tuning.** Ground-truth a single archetype end-to-end: confirm the attribute panel explains the OVR distribution, and that a near-cap player sits at/below zero with a thin right tail.

---

# Comparison dashboard

Two or more run directories. Labels come from each run's `metadata.json` (`progression.name`). Output is `comparison_dashboard.html` plus `comparison_scorecard.csv`
next to the first run.

## §1 · Scorecard (`cmp_scorecard`)

**Math.** One column per script; every tuning KPI distilled to a number:

| KPI | Definition |
|---|---|
| PeakAge | interpolated zero-crossing (`estimate_peak`) |
| PrimeSep | raw top−bottom production-tercile ΔOVR gap at ages 25–27 |
| PrimeSep(OVRadj) | same gap **within baseline-OVR bands**, controls for the cap holding down high-OVR studs |
| DeclineSlope | post-peak OLS slope of the age curve |
| Drift | mean of per-player MeanDelta (league inflation/deflation) |
| MedianσΔ | median per-player run-to-run SD (unpredictability) |
| ICC(Ovr) | between/(between+within) variance share on OVR |
| KendallW | rank concordance across runs (subsampled to ≤200 runs) |
| P99 Ovr, %>cap | ceiling behaviour; %>cap threshold defaults to 84 (`--ceiling`) |
| GodProg/run | rare large-jump events divided by run count |

**Tuning.** The whole loop on one screen. Read PrimeSep **with** PrimeSep(OVRadj): raw negative but adjusted positive = the cap is (correctly) holding down high-OVR studs, not unfairness; both negative = possible unfairness in whatever the script uses to separate talent.

## §2 · Age Curve

- **`cmp_age_curve`** is a overlaid mean-Δ age curves with 95% CI bands and per-script peak markers. Non-overlapping bands mean the scripts differ beyond run noise.
- **`cmp_sigma_by_age`** is a per-age $\sigma(\Delta)$ overlay: where each script concentrates its variance across the lifecycle.

## §3 · Talent Separation

- **`cmp_separation_bands`** are grouped bars of the production-tercile Δ gap per age band (25–27, 28–30, 31–33, 34–45). The fairness fingerprint: tall positive prime-age bars fading toward 0 with age = talent develops the young and correctly stops lifting the old.
- **`cmp_delta_vs_baseline`** is the mean Δ vs fixed 5-OVR baseline bins, overlaid. Where a script's curve turns down as baseline rises is where its cap engages.

## §4 · Ceiling & Outcomes

- **`cmp_improve_probability`** refers to the $P(\Delta>0)$ vs baseline bins per script. Height = generosity; drop-off point = where the cap starts biting.

## §5 · Noise & Determinism

- **`cmp_noise_kde`** is the KDE overlay of per-player StdDelta (dashed medians). A script shifted right is noisier per player; a long right tail means a subset is thrown around by RNG.
- **`cmp_icc_bars`** is the grouped ICC(Ovr) and median-attribute ICC per script, with the 0.4/0.7 guide lines. Higher = more deterministic.

## §6 · Attribute Fingerprint

- **`cmp_attr_fingerprint`** refers to per-attribute $c_j \cdot \overline{\Delta_j}$ (OVR-impact units) grouped by script. Two scripts can share an age curve yet reach it through different attributes. A more defense-aware script putting positive weight on defensive attributes that a scoring-only script leaves flat would be visible here.


---

<p align="center">
  <a href="https://github.com/akshayexists">
    <img src="https://img.shields.io/badge/%C2%A9_2026-akshayexists-black?style=for-the-badge&logo=github" alt="Copyright">
  </a>
</p>
