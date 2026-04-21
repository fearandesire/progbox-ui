/// @file v41_progression.hpp
/// @brief V4.1 implementation of NET.
/// @author @akshayexists

#pragma once
#include "i_progression.hpp"
#include "ovr_math.hpp"

namespace progbox {

/// @brief Progression strategy implementing V4.1 aging, stat scaling, and god-prog logic.
class V41Progression final : public IProgressionStrategy {
private:
    /// @brief Attribute masks indicating physical traits subject to age-based decline.
    static constexpr std::array<bool, 15> IS_OLD_PHYS = {
        false, false, false, true, false, false, false, true, false, false, false, true, true, false, false
    };
    static constexpr std::array<bool, 15> IS_MID_PHYS = {
        false, false, false, false, false, false, false, true, false, false, false, true, true, false, false
    };

    /// @brief Boundary limits for progression ranges based on player age.
    struct AgeGroupConfig { int min1, min2, max1, max2, hard_max; };

    /// @brief Fetches progression divisor and cap configuration for a given age.
    /// @param age The player's current age.
    /// @return The AgeGroupConfig containing formula parameters.
    inline AgeGroupConfig get_age_config(int age) const {
        if (age >= 35) return {6, 9, 0, 0, 0};
        if (age >= 31) return {6, 7, 4, 3, 2};
        return {5, 7, 4, 2, 4};
    }

    /// @brief Calculates the minimum and maximum overall rating delta.
    /// @param per Player's PER metric.
    /// @param dws Player's DWS metric.
    /// @param ewa Player's EWA metric.
    /// @param ovr Player's current overall rating.
    /// @param age Player's current age.
    /// @return A pair of [min_delta, max_delta].
    inline std::pair<int, int> get_prog_range(double per, double dws, double ewa, int ovr, int age) const {
        auto cfg = get_age_config(age);
        double score = per * 0.70 + dws * 5.0 * 0.20 + ewa * 3.0 * 0.10;

        int lo, hi;
        if (score <= 20.0 && age < 31) {
            lo = static_cast<int>(std::ceil(score / 5.0)) - 6;
            hi = static_cast<int>(std::ceil(score / 4.0)) - 1;
        } else {
            lo = static_cast<int>(std::ceil(score / static_cast<double>(cfg.min1))) - cfg.min2;
            hi = (cfg.max1 > 0) ? static_cast<int>(std::ceil(score / static_cast<double>(cfg.max1))) - cfg.max2 : 0;
            if (cfg.hard_max == 0 && hi < 0) hi = 0;
        }

        if (hi > cfg.hard_max) hi = cfg.hard_max;

        if (ovr + hi >= 80) {
            if (ovr >= 80) {
                hi = 0;
                lo = (age > 30 && age < 35) ? -10 : (age >= 35 ? -14 : -2);
            } else {
                hi = 80 - ovr;
                if (ovr + lo >= 80) lo = 0;
            }
        }

        if (lo > hi) lo = hi;
        return {lo, hi};
    }

    /// @brief Applies a randomized delta to an attribute, enforcing age-specific physical decline rules.
    /// @param idx The index of the attribute (0-14).
    /// @param val The current value of the attribute.
    /// @param lo The minimum allowed delta.
    /// @param hi The maximum allowed delta.
    /// @param age The player's current age.
    /// @param rng The random number generator.
    /// @return The new attribute value clamped between 0 and 100.
    inline double apply_skill(size_t idx, double val, int lo, int hi, int age, std::mt19937& rng) const {
        std::uniform_int_distribution<int> dist(lo, hi);
        std::uniform_real_distribution<double> r_dist(0.0, 1.0);
        int delta = 0;

        if (age >= 30 && IS_OLD_PHYS[idx]) {
            if (hi <= 0) {
                delta = dist(rng);
            } else {
                if (r_dist(rng) > r_dist(rng) * 0.05 + 0.01) {
                    return val;
                }
                int capped_hi = std::min(hi, 3);
                int capped_lo = std::min(lo, capped_hi);
                std::uniform_int_distribution<int> cap_dist(capped_lo, capped_hi);
                delta = cap_dist(rng);
            }
        } else if (age >= 26 && age < 30 && IS_MID_PHYS[idx]) {
            delta = dist(rng);
            if (delta > 0) {
                if (r_dist(rng) > std::max(0.0, 0.7 - (age - 26) * 0.1)) {
                    return val;
                }
            }
        } else {
            delta = dist(rng);
        }

        return std::max(0.0, std::min(100.0, val + static_cast<double>(delta)));
    }

public:
    /// @brief Runs the full V4.1 progression pipeline for a single player.
    /// @details Skips players under 26. Calculates ranges, rolls for god-progs, and applies deltas.
    /// @param player The initial player state.
    /// @param rng The run-specific random number generator.
    /// @param run_seed The seed of the simulation run.
    /// @return The final ProgressionResult.
    ProgressionResult progress_player(
        const PlayerState& player, 
        std::mt19937& rng,
        int64_t run_seed
    ) const override {
        PlayerState out = player;
        std::optional<GodProgRecord> god_prog = std::nullopt;
        
        int age = static_cast<int>(out.age);
        if (age < 26) {
            int ovr = calcovr_from_array(out.attrs);
            return {out, ovr, std::nullopt};
        }

        int ovr = calcovr_from_array(out.attrs);
        auto [lo, hi] = get_prog_range(out.per, out.dws, out.ewa, ovr, age);

        std::uniform_real_distribution<double> r_dist(0.0, 1.0);
        if (age < 30 && ovr < 60 && r_dist(rng) < 0.02) {
            std::uniform_int_distribution<int> bonus_dist(7, 10);
            int bonus = bonus_dist(rng);
            lo = hi = bonus;
            god_prog = GodProgRecord{"", static_cast<int>(run_seed), age, ovr, bonus, 0.02};
        }

        for (size_t i = 0; i < 15; ++i) {
            if (i != 14) { // Index 14 is Hgt
                out.attrs[i] = apply_skill(i, out.attrs[i], lo, hi, age, rng);
            }
        }

        int final_ovr = calcovr_from_array(out.attrs);
        return {out, final_ovr, god_prog};
    }

    [[nodiscard]] std::string version() const noexcept override {
        return "v4.1";
    }
};

} // namespace progbox