/// @progbox-register
///    id: v43
///    name: "v4.3, new and improved progression script" class: V43Progression
/// @end-progbox-register

/// @file v43_progression.hpp
/// @brief BBGM-semantic progression, additive core with talent-gated scaling
/// and balanced variance:
///        delta[attr] = G + L[attr] + noise[attr]
///
///        1. GLOBAL FACTOR (G) = (talent-scaled youth) − (talent-resisted
///        decline).
///           * Production/talent enters G exclusively through these two
///           principled channels
///             (young studs develop faster; elite talent ages better), never as
///             a uniform smear.
///           * Youth Base: Scaled by production so young studs develop and
///           scrubs stagnate,
///             without shifting the median player's peak.
///           * Age Decline: Countered by talent-based decline resistance.
///
///        2. LOCAL FACTOR (L) = Linear age character + curated z-scored nudge
///        per attribute.
///           * Pool z-scores are RELIABILITY-WEIGHTED (sample / (sample + K))
///             so noisy, low-minute estimates cannot artificially inflate the
///             pool standard deviation.
///
///        3. VARIANCE & SHOCK (noise):
///           * Per-Attribute Jitter
///           * Common Per-Player Shock
///
///        4. SOFT CEILING & LIMITS:
///           * Taper remains strictly one-sided on POSITIVE deltas; attributes
///           still move
///             independently near the cap to prevent net-OVR clamping from
///             homogenizing them.
///           * God prog unchanged (v321).
///
///        DEFENSIVE BALANCING: Lockdown defender value directly lifts dIQ,
///        Str, and Jmp
///           (via STL%, BLK%, and DBPM). Because dIQ carries a heavy OVR
///           coefficient (0.159), balanced defenders cleanly progress instead
///           of being buried by low PER (v3.2.1 flaw).
///
///        Applies to age >= 25 only.
/// @author @akshayexists

#pragma once
#include <algorithm>
#include <array>
#include <cmath>
#include <vector>

#include "i_progression.hpp"
#include "ovr_math.hpp"

namespace progbox {

// Index legend, matching ALL_ATTRS order exactly:
//  0 dIQ 1 Dnk 2 Drb 3 End 4 2Pt 5 FT 6 Ins 7 Jmp
//  8 oIQ 9 Pss 10 Reb 11 Spd 12 Str 13 3Pt 14 Hgt
enum Attr {
    dIQ = 0,
    Dnk,
    Drb,
    End,
    TwoPt,
    FT,
    Ins,
    Jmp,
    oIQ,
    Pss,
    Reb,
    Spd,
    Str,
    ThreePt,
    Hgt
};

class V43Progression final : public IProgressionStrategy {
   public:
    // ========================================================================
    //  TUNABLE CONFIG
    // ========================================================================
    struct Config {
        // ── GLOBAL age development ─────────────────────────────────────────
        double youngKnee = 28.0;  // youth improvement active below this age
        double youthRate = 0.60;  // pts/yr improvement per year under youngKnee
        double oldKnee = 32.0;    // age decline active above this age
        double oldRate = 0.60;    // pts/yr decline per year over oldKnee

        // ── TALENT-SCALED youth (rebalances age vs production) ─────────────
        // youthBase is multiplied by clamp(1 + youthTalentK·P, floor, cap), so
        // young studs develop faster and young scrubs stagnate. Median player
        // (P≈0) is unchanged, so this does NOT move the aggregate peak, it
        // only spreads development by talent. Set youthTalentK=0 for the old
        // uniform behaviour.
        double youthTalentK = 0.55;
        double youthTalentFloor =
            0.30;                      // −talent still develops at 30% of rate
        double youthTalentCap = 1.75;  // +talent develops at up to 175%

        // ── Decline resistance (talented players age better) ───────────────
        double declineW = 0.12;   // decline-resistance per 1 sigma production
        double minResist = 0.50;  // best case: decline at 50% rate
        double maxResist = 1.60;  // worst case: decline at 160% rate

        // Production composite: balanced BPM primary, PER a minor scoring lean.
        // Used only for youth-scaling and decline-resistance now (no smear).
        double prodWBpm = 0.70;
        double prodWPer = 0.30;
        double prodZCap = 3.50;  // clamp composite z (outlier leverage guard)

        // ── LOCAL per-attribute age character ──────────────────────────────
        // ageShape[a] = slope[a]*(age - agePivot). Physicals negative
        // (decline), IQ/touch positive (hold/rise). Redistributes around the
        // global trend.
        double agePivot = 27.0;
        std::array<double, 15> ageShapeSlope;

        // ── Curated nudge (now carries ALL production separation) ──────────
        // nudgeGain scales every nudge: this is the production-separation and
        // defensive-specialist lever. nudgeCap is currently quite generous.
        double nudgeGain = 1.70;
        double nudgeCap = 6.00;

        // ── Noise ──────────────────────────────────────────────────────────
        // Independent per-attr jitter (wobbles attributes, cancels at OVR) +
        // common per-player shock (correlated, MOVES OVR, serves as an
        // unpredictability knob).
        double noiseAmp = 1.6;  // uniform half-width (pts) at reference minutes
        double noiseRefMpg = 24.0;
        double noiseFloor = 8.0;
        double noiseMultCap = 1.8;
        double commonNoise = 1.40;

        // ── Soft ceiling: taper positive gains across [softCeil, +band] ────
        double softCeil = 78.0;
        double ceilBand = 4.0;

        // ── Pool / regression ──────────────────────────────────────────────
        double regressMinK = 600.0;  // phantom total minutes (rate stats)
        double regressAttK = 60.0;   // phantom attempts (shooting %)
        double effAttMin = 20.0;     // min total zone attempts to enter % pool
        double minutesFloor = 8.0;   // min mpg to enter rate pool

        double globalScale = 1.0;  // whole-league dev-speed knob

        // ── God prog (v321 semantics: rare, flat, OVR-scaled) ──────────────
        int godYoungMax = 30;
        int godMinRating = 30;
        int godMaxRating = 61;
        double godMaxChance = 0.09;
        int godMinBonus = 7;
        int godMaxBonus = 13;

        Config() {
            // Negative = declines with age; positive = holds/rises with age.
            ageShapeSlope[Hgt] = 0.00;  // immutable

            // --- ACCELERATED ATHLETICISM DECLINE ---
            ageShapeSlope[Spd] = -0.26;  // Increased from -0.16
            ageShapeSlope[Jmp] = -0.26;  // Increased from -0.16
            ageShapeSlope[Dnk] = -0.18;  // Increased from -0.11

            ageShapeSlope[End] = -0.11;
            ageShapeSlope[Reb] = -0.08;
            ageShapeSlope[Str] = -0.06;
            ageShapeSlope[Drb] = -0.05;
            ageShapeSlope[Ins] = -0.02;
            ageShapeSlope[TwoPt] = 0.07;
            ageShapeSlope[Pss] = +0.06;
            ageShapeSlope[ThreePt] = +0.08;
            ageShapeSlope[FT] = +0.05;

            // --- AGE INDEPENDENT IQ, positive when aged ---
            ageShapeSlope[dIQ] = +0.01;  // Changed from +0.06
            ageShapeSlope[oIQ] = +0.01;  // Changed from +0.07
        }
    };

    explicit V43Progression(Config cfg = {}) : cfg_(cfg) {}

    // ========================================================================
    //  Pool preparation (RELIABILITY-WEIGHTED moments)
    // ========================================================================
    void prepare(const std::vector<PlayerStats>& pool) override {
        pool_ = PoolStats{};
        if (pool.empty()) return;

        // Rate channels: weight by minutes reliability = tmin/(tmin+K).
        auto accMin = [&](auto get, Moments& m) {
            for (const auto& s : pool) {
                if (s.min < cfg_.minutesFloor) continue;
                const double tmin = s.min * s.gp;
                m.add(get(s), tmin / (tmin + cfg_.regressMinK));
            }
            m.finalize();
        };
        accMin([](const PlayerStats& s) { return (double)s.usgp; }, pool_.usg);
        accMin([](const PlayerStats& s) { return (double)s.astp; }, pool_.ast);
        accMin([](const PlayerStats& s) { return (double)s.trbp; }, pool_.trb);
        accMin([](const PlayerStats& s) { return (double)s.orbp; }, pool_.orb);
        accMin([](const PlayerStats& s) { return (double)s.stlp; }, pool_.stl);
        accMin([](const PlayerStats& s) { return (double)s.blkp; }, pool_.blk);
        accMin([](const PlayerStats& s) { return (double)s.obpm; }, pool_.obpm);
        accMin([](const PlayerStats& s) { return (double)s.dbpm; }, pool_.dbpm);
        accMin([](const PlayerStats& s) { return (double)s.ortg; }, pool_.ortg);
        accMin([](const PlayerStats& s) { return (double)s.per; }, pool_.per);
        accMin([](const PlayerStats& s) { return (double)s.min; }, pool_.mpg);
        accMin([](const PlayerStats& s) { return (double)s.availability; },
               pool_.avail);
        accMin([](const PlayerStats& s) { return (double)(s.obpm + s.dbpm); },
               pool_.bpm);
        accMin([](const PlayerStats& s) { return tovRate(s); }, pool_.tovr);
        accMin([](const PlayerStats& s) { return (double)s.fgaAtRim; },
               pool_.rimVol);
        accMin([](const PlayerStats& s) { return (double)s.fgaLowPost; },
               pool_.postVol);
        accMin([](const PlayerStats& s) { return (double)s.fgaMidRange; },
               pool_.midVol);
        accMin([](const PlayerStats& s) { return (double)s.tpa; }, pool_.tpVol);

        // Efficiency channels: weight by attempt reliability = att/(att+K).
        auto accEff = [&](auto pct, auto att, Moments& m) {
            for (const auto& s : pool) {
                const double a = att(s) * s.gp;
                if (a < cfg_.effAttMin) continue;
                m.add(pct(s), a / (a + cfg_.regressAttK));
            }
            m.finalize();
        };
        accEff([](const PlayerStats& s) { return zdiv(s.fgAtRim, s.fgaAtRim); },
               [](const PlayerStats& s) { return (double)s.fgaAtRim; },
               pool_.rimPct);
        accEff(
            [](const PlayerStats& s) {
                return zdiv(s.fgLowPost, s.fgaLowPost);
            },
            [](const PlayerStats& s) { return (double)s.fgaLowPost; },
            pool_.postPct);
        accEff(
            [](const PlayerStats& s) {
                return zdiv(s.fgMidRange, s.fgaMidRange);
            },
            [](const PlayerStats& s) { return (double)s.fgaMidRange; },
            pool_.midPct);
        accEff([](const PlayerStats& s) { return zdiv(s.tp, s.tpa); },
               [](const PlayerStats& s) { return (double)s.tpa; }, pool_.tpPct);
        accEff([](const PlayerStats& s) { return zdiv(s.ft, s.fta); },
               [](const PlayerStats& s) { return (double)s.fta; }, pool_.ftPct);
    }

    // ========================================================================
    //  Progress one player
    // ========================================================================
    ProgressionResult progress_player(const PlayerState& player,
                                      const PlayerStats& stats,
                                      std::mt19937& rng,
                                      int64_t run_seed) const override {
        PlayerState out = player;
        std::optional<GodProgRecord> god_prog = std::nullopt;

        const int age = static_cast<int>(out.age);
        const int ovr = calcovr_from_array(out.attrs);

        if (age < 25 || stats.per <= 0.0) return {out, ovr, std::nullopt};

        // God prog: rare flat replacement (v321). Bypasses everything below.
        if (age < cfg_.godYoungMax) {
            const double chance = god_chance(ovr);
            std::uniform_real_distribution<double> roll(0.0, 1.0);
            if (roll(rng) < chance) {
                std::uniform_int_distribution<int> b(cfg_.godMinBonus,
                                                     cfg_.godMaxBonus);
                const double bonus = static_cast<double>(b(rng));
                for (int a = 0; a < 15; ++a)
                    if (a != Hgt)
                        out.attrs[a] =
                            std::clamp(out.attrs[a] + bonus, 0.0, 100.0);
                god_prog = GodProgRecord{
                    "", run_seed, age, ovr, static_cast<int>(bonus), chance};
                return {out, calcovr_from_array(out.attrs), god_prog};
            }
        }

        // Production z (once) → global signal G (once, added to every attr).
        const double P = production_P(stats);

        std::uniform_real_distribution<double> unit(-1.0, 1.0);
        const double nmult = noise_mult(stats.min, age);
        // Common per-player shock: correlated across attributes
        const double commonShock = unit(rng) * cfg_.commonNoise * nmult;
        const double Gage = global_signal(out.age, P) * cfg_.globalScale;
        // const double G =
        //     (global_signal(out.age, P) + commonShock) * cfg_.globalScale;

        const StatZ z = zscores(stats);
        const double gf = gain_factor(ovr);
        const double namp = cfg_.noiseAmp * nmult;

        for (int a = 0; a < 15; ++a) {
            if (a == Hgt) continue;

            const double ageShape =
                cfg_.ageShapeSlope[a] * (out.age - cfg_.agePivot);
            const double nudge = std::clamp(cfg_.nudgeGain * stat_nudge(a, z),
                                            -cfg_.nudgeCap, cfg_.nudgeCap);
            const double L = ageShape + nudge;
            const double noise = unit(rng) * namp;
            const double base = (a == oIQ || a == dIQ) ? 0.0 : Gage;
            double delta = base + commonShock + L + noise;
            if (delta > 0.0) delta *= gf;

            out.attrs[a] = std::clamp(out.attrs[a] + delta, 0.0, 100.0);
        }

        return {out, calcovr_from_array(out.attrs), god_prog};
    }

    [[nodiscard]] std::string version() const noexcept override {
        return "v4.3";
    }

   private:
    Config cfg_;

    // Reliability-weighted running moments.
    struct Moments {
        double wsum = 0, wx = 0, wxx = 0, mean = 0, sd = 1;
        void add(double x, double w) {
            wsum += w;
            wx += w * x;
            wxx += w * x * x;
        }
        void finalize() {
            if (wsum <= 1e-9) {
                mean = 0;
                sd = 1;
                return;
            }
            mean = wx / wsum;
            const double var = wxx / wsum - mean * mean;
            sd = var > 1e-9 ? std::sqrt(var) : 1.0;
        }
    };
    struct PoolStats {
        Moments usg, ast, trb, orb, stl, blk, obpm, dbpm, ortg, per, mpg, avail,
            bpm, tovr;
        Moments rimVol, postVol, midVol, tpVol;
        Moments rimPct, postPct, midPct, tpPct, ftPct;
    };
    PoolStats pool_;

    static double zdiv(double n, double d) { return d > 1e-6 ? n / d : 0.0; }

    static double tovRate(const PlayerStats& s) {
        const double poss = s.fga + 0.44 * s.fta + s.tov;  // BBGM USG% basis
        return poss > 1e-6 ? s.tov / poss : 0.0;
    }

    static double shrink(double raw, double mean, double sample, double K) {
        return (raw * sample + mean * K) / (sample + K);
    }
    double zRate(double raw, const Moments& m, double totalMin) const {
        return (shrink(raw, m.mean, totalMin, cfg_.regressMinK) - m.mean) /
               m.sd;
    }
    double zEff(double raw, const Moments& m, double totalAtt) const {
        return (shrink(raw, m.mean, totalAtt, cfg_.regressAttK) - m.mean) /
               m.sd;
    }

    struct StatZ {
        double usg, ast, trb, orb, stl, blk, obpm, dbpm, ortg, mpg, avail, tovr;
        double rimVol, postVol, midVol, tpVol;
        double rimPct, postPct, midPct, tpPct, ftPct;
    };

    StatZ zscores(const PlayerStats& s) const {
        const double tmin = s.min * s.gp;
        auto att = [&](double perGame) { return perGame * s.gp; };
        return StatZ{
            zRate(s.usgp, pool_.usg, tmin),
            zRate(s.astp, pool_.ast, tmin),
            zRate(s.trbp, pool_.trb, tmin),
            zRate(s.orbp, pool_.orb, tmin),
            zRate(s.stlp, pool_.stl, tmin),
            zRate(s.blkp, pool_.blk, tmin),
            zRate(s.obpm, pool_.obpm, tmin),
            zRate(s.dbpm, pool_.dbpm, tmin),
            zRate(s.ortg, pool_.ortg, tmin),
            zRate(s.min, pool_.mpg, tmin),
            zRate(s.availability, pool_.avail, tmin),
            zRate(tovRate(s), pool_.tovr, tmin),
            zRate(s.fgaAtRim, pool_.rimVol, tmin),
            zRate(s.fgaLowPost, pool_.postVol, tmin),
            zRate(s.fgaMidRange, pool_.midVol, tmin),
            zRate(s.tpa, pool_.tpVol, tmin),
            zEff(zdiv(s.fgAtRim, s.fgaAtRim), pool_.rimPct, att(s.fgaAtRim)),
            zEff(zdiv(s.fgLowPost, s.fgaLowPost), pool_.postPct,
                 att(s.fgaLowPost)),
            zEff(zdiv(s.fgMidRange, s.fgaMidRange), pool_.midPct,
                 att(s.fgaMidRange)),
            zEff(zdiv(s.tp, s.tpa), pool_.tpPct, att(s.tpa)),
            zEff(zdiv(s.ft, s.fta), pool_.ftPct, att(s.fta)),
        };
    }

    // Balanced production composite (BPM primary, PER lean), clamped. Used for
    // youth-scaling and decline-resistance only.
    double production_P(const PlayerStats& s) const {
        const double tmin = s.min * s.gp;
        const double P =
            cfg_.prodWBpm * zRate(s.obpm + s.dbpm, pool_.bpm, tmin) +
            cfg_.prodWPer * zRate(s.per, pool_.per, tmin);
        return std::clamp(P, -cfg_.prodZCap, cfg_.prodZCap);
    }

    // Global signal: talent-scaled youth − talent-resisted decline.
    // NO uniform talentDev: production separation is carried by the nudges.
    double global_signal(double age, double P) const {
        const double youthTalent =
            std::clamp(1.0 + cfg_.youthTalentK * P, cfg_.youthTalentFloor,
                       cfg_.youthTalentCap);
        const double youthBase =
            cfg_.youthRate * std::max(0.0, cfg_.youngKnee - age) * youthTalent;
        const double declineBase =
            cfg_.oldRate * std::max(0.0, age - cfg_.oldKnee);
        const double resist =
            std::clamp(1.0 - cfg_.declineW * P, cfg_.minResist, cfg_.maxResist);
        return youthBase - declineBase * resist;
    }

    double gain_factor(int ovr) const {
        return std::clamp((cfg_.softCeil + cfg_.ceilBand - ovr) / cfg_.ceilBand,
                          0.0, 1.0);
    }

    double noise_mult(double mpg, double age = 0) const {
        const double m = std::max(cfg_.noiseFloor, mpg);
        return std::min(std::sqrt(cfg_.noiseRefMpg / m), cfg_.noiseMultCap);
    }

    double stat_nudge(int a, const StatZ& z) const {
        switch (a) {
            case dIQ:
                return 0.40 * z.stl + 0.30 * z.blk + 0.30 * z.dbpm;
            case Dnk:
                return 0.55 * z.rimPct + 0.30 * z.rimVol;
            case Drb:
                return 0.40 * z.ast + 0.20 * z.usg - 0.30 * z.tovr;
            case End:
                return 0.45 * z.mpg + 0.25 * z.avail;
            case TwoPt:
                return 0.55 * z.midPct + 0.20 * z.midVol;
            case FT:
                return 0.65 * z.ftPct;
            case Ins:
                return 0.50 * z.postPct + 0.30 * z.postVol + 0.10 * z.orb;
            case Jmp:
                return 0.35 * z.blk + 0.25 * z.orb + 0.20 * z.rimVol;
            case oIQ:
                return 0.50 * z.obpm + 0.30 * z.ast + 0.10 * z.ortg;
            case Pss:
                return 0.65 * z.ast + 0.15 * z.obpm - 0.20 * z.tovr;
            case Reb:
                return 0.55 * z.trb + 0.25 * z.orb;
            case Spd:
                return 0.25 * z.stl + 0.15 * z.ast;  // weak proxy
            case Str:
                return 0.35 * z.postVol + 0.30 * z.orb + 0.20 * z.dbpm;
            case ThreePt:
                return 0.55 * z.tpPct + 0.25 * z.tpVol;
            default:
                return 0.0;
        }
    }

    double god_chance(int ovr) const {
        double scale;
        if (ovr < cfg_.godMinRating)
            scale = 1.0;
        else if (ovr > cfg_.godMaxRating)
            scale = 0.01;
        else
            scale = 1.0 - double(ovr - cfg_.godMinRating) /
                              double(cfg_.godMaxRating - cfg_.godMinRating);
        return scale * cfg_.godMaxChance;
    }
};

}  // namespace progbox
