/// @file v0_progression.hpp
/// @brief Baseline progression strategy: port of Basketball GM's `developSeason`.
/// ORIGINAL AUTHOR: dumbmatter
///
///
///
/// @author akshayexists
/// @progbox-register
///   id: v0
///   name: "Baseline (BBGM developSeason port)"
///   class: V0Progression
/// @end-progbox-register
///
/// Faithful port of `develop/developSeason.basketball.ts` from Basketball GM.
/// Differences from upstream:
///   - Coaching effect is disabled (multiplier fixed at 1.0). The interface
///     does not provide a coaching level, and coaching modeling is out of
///     scope for the v0 baseline.
///   - `GodProgRecord` is not emitted; `ProgressionResult::god_prog` is
///     always `std::nullopt`.
///
/// The strategy mutates each rating in-place across a single season:
/// young players may grow in height; every non-height rating receives a
/// delta of `bound((baseChange + ageModifier(age)) * U(0.4, 1.4), lo, hi)`
/// then is clamped to [0, 100] and rounded by `limit_rating`.

#pragma once

#include "core_types.hpp"
#include "i_progression.hpp"
#include "ovr_math.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <optional>
#include <random>
#include <string>
#include <string_view>
#include <utility>

namespace progbox {

// ----------------------------------------------------------------------------
// Attribute-name lookup
// ----------------------------------------------------------------------------
// Lives at namespace scope (not as a class member) because static constexpr
// member initializers cannot call sibling member functions: the class
// definition is still incomplete at that point and the called function is
// considered to not yet have a complete definition for constant evaluation.
namespace v0_detail {

constexpr size_t find_attr(std::string_view name) noexcept {
    for (size_t i = 0; i < ALL_ATTRS.size(); ++i) {
        if (std::string_view(ALL_ATTRS[i]) == name) return i;
    }
    return static_cast<size_t>(-1);
}

} // namespace v0_detail

class V0Progression final : public IProgressionStrategy {
public:
    ProgressionResult progress_player(
        const PlayerState& player,
        const PlayerStats& stats,
        std::mt19937& rng,
        int64_t /*run_seed*/
    ) const override;

    [[nodiscard]] std::string version() const noexcept override {
        return "v0";
    }

private:
    // ---------- attribute index lookup ----------
    // Resolved at compile time via the free function above so the rest of
    // the file can use named slots regardless of `ALL_ATTRS` storage order.

    static constexpr size_t HGT = v0_detail::find_attr("Hgt");
    static constexpr size_t STR = v0_detail::find_attr("Str");
    static constexpr size_t SPD = v0_detail::find_attr("Spd");
    static constexpr size_t JMP = v0_detail::find_attr("Jmp");
    static constexpr size_t END = v0_detail::find_attr("End");
    static constexpr size_t INS = v0_detail::find_attr("Ins");
    static constexpr size_t DNK = v0_detail::find_attr("Dnk");
    static constexpr size_t FT  = v0_detail::find_attr("FT");
    static constexpr size_t FG  = v0_detail::find_attr("2Pt");   // BBGM `fg`
    static constexpr size_t TP  = v0_detail::find_attr("3Pt");   // BBGM `tp`
    static constexpr size_t OIQ = v0_detail::find_attr("oIQ");
    static constexpr size_t DIQ = v0_detail::find_attr("dIQ");
    static constexpr size_t DRB = v0_detail::find_attr("Drb");
    static constexpr size_t PSS = v0_detail::find_attr("Pss");
    static constexpr size_t REB = v0_detail::find_attr("Reb");

    // ---------- numeric helpers ----------

    static double bound(double v, double lo, double hi) noexcept {
        return std::clamp(v, lo, hi);
    }

    /// Mirrors BBGM's `limitRating`: round to integer-valued double,
    /// clamp to [0, 100].
    static double limit_rating(double r) noexcept {
        return std::round(std::clamp(r, 0.0, 100.0));
    }

    static double uniform(std::mt19937& rng, double a, double b) {
        return std::uniform_real_distribution<double>(a, b)(rng);
    }

    static double real_gauss(std::mt19937& rng, double mean, double stddev) {
        return std::normal_distribution<double>(mean, stddev)(rng);
    }

    // ---------- per-rating age modifiers ----------
    // Each function mirrors a `RatingFormula.ageModifier` in the source.
    // Pure functions of age unless explicitly noted (only `endu_age_mod`
    // consumes RNG, and only for young players).

    static double shooting_age_mod(int age) noexcept {
        if (age <= 27) return 0.0;
        if (age <= 29) return 0.5;
        if (age <= 31) return 1.5;
        return 2.0;
    }

    static double iq_age_mod(int age) noexcept {
        if (age <= 21) return 4.0;
        if (age <= 23) return 3.0;
        if (age <= 27) return 0.0;
        if (age <= 29) return 0.5;
        if (age <= 31) return 1.5;
        return 2.0;
    }

    /// IQ delta limits: widens for very young players, who can swing
    /// substantially as offensive/defensive sense develops.
    /// age 19 -> [-3, 32], age 23 -> [-3, 12], age >= 24 -> [-3, 9].
    static std::array<double, 2> iq_limits(int age) noexcept {
        if (age >= 24) return {-3.0, 9.0};
        return {-3.0, 7.0 + 5.0 * (24 - age)};
    }

    static double spd_age_mod(int age) noexcept {
        if (age <= 27) return  0.0;
        if (age <= 30) return -2.0;
        if (age <= 35) return -3.0;
        if (age <= 40) return -4.0;
        return -8.0;
    }

    static double jmp_age_mod(int age) noexcept {
        if (age <= 26) return  0.0;
        if (age <= 30) return -3.0;
        if (age <= 35) return -4.0;
        if (age <= 40) return -5.0;
        return -10.0;
    }

    /// Consumes one uniform draw for `age <= 23`. Caller must invoke
    /// this BEFORE any downstream RNG use to keep argument-evaluation
    /// ordering deterministic across compilers.
    static double endu_age_mod(int age, std::mt19937& rng) {
        if (age <= 23) return uniform(rng, 0.0, 9.0);
        if (age <= 30) return  0.0;
        if (age <= 35) return -2.0;
        if (age <= 40) return -4.0;
        return -8.0;
    }

    static double dnk_age_mod(int age) noexcept {
        // Shooting-shaped, but old players cap at +0.5 (no further uptrend).
        return (age <= 27) ? 0.0 : 0.5;
    }

    // ---------- base change ----------

    static double calc_base_change(int age, std::mt19937& rng) {
        double val;
        if      (age <= 21) val =  2.0;
        else if (age <= 25) val =  1.0;
        else if (age <= 27) val =  0.0;
        else if (age <= 29) val = -1.0;
        else if (age <= 31) val = -2.0;
        else if (age <= 34) val = -3.0;
        else if (age <= 40) val = -4.0;
        else if (age <= 43) val = -5.0;
        else                val = -6.0;

        // Noise: wider variance and a one-sided cap for the young.
        if (age <= 23) {
            val += bound(real_gauss(rng, 0.0, 5.0), -4.0, 20.0);
        } else if (age <= 25) {
            val += bound(real_gauss(rng, 0.0, 5.0), -4.0, 10.0);
        } else {
            val += bound(real_gauss(rng, 0.0, 3.0), -2.0, 4.0);
        }

        // Coaching effect omitted in v0 (multiplier = 1.0):
        //   val *= 1 + sign(val) * coachingEffect(coachingLevel);
        return val;
    }

    // ---------- apply one rating change ----------

    static void apply_rating(
        std::array<double, 15>& attrs,
        size_t idx,
        double base_change,
        double age_modifier,
        double lo,
        double hi,
        std::mt19937& rng
    ) {
        const double delta = bound(
            (base_change + age_modifier) * uniform(rng, 0.4, 1.4),
            lo, hi
        );
        attrs[idx] = limit_rating(attrs[idx] + delta);
    }
};

// ============================================================================
// progress_player
// ============================================================================
inline ProgressionResult V0Progression::progress_player(
    const PlayerState& player,
    const PlayerStats& stats,
    std::mt19937& rng,
    int64_t /*run_seed*/
) const {
    PlayerState out = player;
    auto& attrs = out.attrs;
    const int age = static_cast<int>(player.age);

    // ---- height growth (young players only) ----
    // The JS deliberately uses the SAME random draw for both checks, so a
    // player can gain at most two inches in a season (and only at age <= 20
    // for the first inch). Reproduce that behaviour exactly.
    if (age <= 21) {
        const double height_rand = uniform(rng, 0.0, 1.0);
        if (height_rand > 0.99 && age <= 20 && attrs[HGT] <= 99.0) {
            attrs[HGT] += 1.0;
        }
        if (height_rand > 0.999 && attrs[HGT] <= 99.0) {
            attrs[HGT] += 1.0;
        }
    }

    const double base = calc_base_change(age, rng);

    // ---- rating updates ----
    // Order matches the insertion order of `ratingsFormulas` in the JS
    // source, which determines the order of RNG draws and therefore the
    // determinism of any seed-based reproductions.
    constexpr double NINF = -std::numeric_limits<double>::infinity();
    constexpr double PINF =  std::numeric_limits<double>::infinity();

    // stre -> no aging, no delta cap
    apply_rating(attrs, STR, base, 0.0, NINF, PINF, rng);

    // spd -> aging-only decline, asymmetric cap
    apply_rating(attrs, SPD, base, spd_age_mod(age), -12.0, 2.0, rng);

    // jmp -> same shape as spd, steeper falloff
    apply_rating(attrs, JMP, base, jmp_age_mod(age), -12.0, 2.0, rng);

    // endu -> uniform-driven for the young, declining for the old.
    // Evaluate the age modifier in its own statement: it may draw from
    // `rng`, and we must guarantee that draw lands before `apply_rating`'s
    // own uniform (C++ argument-evaluation order is unspecified).
    const double endu_mod = endu_age_mod(age, rng);
    apply_rating(attrs, END, base, endu_mod, -11.0, 19.0, rng);

    // dnk -> shooting-shaped, capped at +0.5 for old players
    apply_rating(attrs, DNK, base, dnk_age_mod(age), -3.0, 13.0, rng);

    // shooting cluster -> ins / ft / fg / tp share the same formula
    {
        const double s_mod = shooting_age_mod(age);
        apply_rating(attrs, INS, base, s_mod, -3.0, 13.0, rng);
        apply_rating(attrs, FT,  base, s_mod, -3.0, 13.0, rng);
        apply_rating(attrs, FG,  base, s_mod, -3.0, 13.0, rng);
        apply_rating(attrs, TP,  base, s_mod, -3.0, 13.0, rng);
    }

    // iq cluster -> oIQ / dIQ share both modifier and limits
    {
        const double iq_mod = iq_age_mod(age);
        const auto   iq_lim = iq_limits(age);
        apply_rating(attrs, OIQ, base, iq_mod, iq_lim[0], iq_lim[1], rng);
        apply_rating(attrs, DIQ, base, iq_mod, iq_lim[0], iq_lim[1], rng);
    }

    // drb / pss / reb -> shooting age curve but tighter delta cap
    {
        const double s_mod = shooting_age_mod(age);
        apply_rating(attrs, DRB, base, s_mod, -2.0, 5.0, rng);
        apply_rating(attrs, PSS, base, s_mod, -2.0, 5.0, rng);
        apply_rating(attrs, REB, base, s_mod, -2.0, 5.0, rng);
    }

    // ---- finalize ----
    ProgressionResult result;
    result.final_state = std::move(out);
    result.final_ovr   = calcovr_from_array(result.final_state.attrs);
    result.god_prog    = std::nullopt;
    return result;
}

} // namespace progbox
