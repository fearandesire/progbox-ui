/// @progbox-register
///   id: v321
///   name: "v3.2.1, current progression script"
///   class: V321Progression
/// @end-progbox-register

/// @file v321_progression.hpp
/// @brief V3.2.1 implementation of NET progression.
/// @author @akshayexists

#pragma once
#include "i_progression.hpp"
#include "ovr_math.hpp"
#include "progression_draws.hpp"
#include <cstring>

namespace progbox {

/// @brief Progression strategy implementing V3.2.1 aging, stat scaling, and god-prog logic.
/// @details This version features:
///   - OVR-scaled god prog chance (0.09 max at OVR < 30, down to 0.0009 at OVR > 61)
///   - God prog range of 7-12 (wider than v4.1's 7-10)
///   - Physical decline starts at age 30 (not 26)
///   - Mid-age slowdown for ages 25-29 (not 26-29)
///   - Additional OVR cap logic with random minimum for capped players
class V321Progression final : public IProgressionStrategy {
private:
    // ========================================================================
    // Configuration Constants
    // ========================================================================

    static constexpr int YOUNG_MAX = 30;
    static constexpr int MAX_OVR = 80;
    static constexpr int MIN_RATING = 30;
    static constexpr int MAX_RATING = 61;
    static constexpr double MAX_GOD_PROG_CHANCE = 0.09;
    static constexpr int MIN_GOD_PROG = 7;
    static constexpr int MAX_GOD_PROG_EXCLUSIVE = 13;

    static constexpr int EARLY_PROG_PER_THRESHOLD = 20;
    static constexpr int EARLY_PROG_AGE_THRESHOLD = 31;
    static constexpr int EARLY_PROG_PER_DIVISOR_MN = 5;
    static constexpr int EARLY_PROG_PER_OFFSET_MN = -6;
    static constexpr int EARLY_PROG_PER_DIVISOR_MX = 4;
    static constexpr int EARLY_PROG_PER_OFFSET_MX = -1;

    static constexpr int DEFAULT_MAX_PROG = 2;

    // ========================================================================
    // Attribute Name Mappings
    // ========================================================================

    /// @brief Attribute names matching ALL_ATTRS order in Config.
    static constexpr const char* ATTR_NAMES[15] = {
        "dIQ", "Dnk", "Drb", "End", "2Pt", "FT", "Ins", "Jmp",
        "oIQ", "Pss", "Reb", "Spd", "Str", "3Pt", "Hgt"
    };

    /// @brief Physical attributes subject to decline at age >= 30.
    static constexpr const char* PHYSICAL_OLD_NAMES[4] = {"Spd", "Str", "Jmp", "End"};

    /// @brief Physical attributes with mid-age slowdown (25-29).
    static constexpr const char* PHYSICAL_MID_NAMES[3] = {"Spd", "Str", "Jmp"};

    // ========================================================================
    // Attribute Lookup Helpers
    // ========================================================================

    /// @brief Check if attribute at index is in the physical old set.
    [[nodiscard]] inline bool is_physical_old(size_t idx) const noexcept {
        const char* attr = ATTR_NAMES[idx];
        for (const char* name : PHYSICAL_OLD_NAMES) {
            if (std::strcmp(attr, name) == 0) return true;
        }
        return false;
    }

    /// @brief Check if attribute at index is in the physical mid set.
    [[nodiscard]] inline bool is_physical_mid(size_t idx) const noexcept {
        const char* attr = ATTR_NAMES[idx];
        for (const char* name : PHYSICAL_MID_NAMES) {
            if (std::strcmp(attr, name) == 0) return true;
        }
        return false;
    }

    // ========================================================================
    // Age Parameters Structure
    // ========================================================================

    /// @brief Progression parameters for an age bracket.
    /// @note max1/max2 of -1 indicates "not set" (None in Python).
    struct AgeParams {
        int min1, min2;
        int max1, max2;
        int hard_max;
        int age;
    };

    /// @brief Get progression parameters for a given age.
    [[nodiscard]] inline AgeParams get_age_params(int age) const noexcept {
        if (age >= 35) {
            return {6, 9, -1, -1, 0, age};
        } else if (age >= 31) {
            return {6, 7, 4, 3, 2, age};
        } else {
            return {5, 7, 4, 2, 4, age};
        }
    }

    // ========================================================================
    // Progression Range Calculator
    // ========================================================================

    /// @brief Calculate base progression range from PER and age params.
    [[nodiscard]] inline std::pair<int, int> calculate_base_range(
        double per, const AgeParams& params
    ) const {
        int mn, mx;

        if (per <= EARLY_PROG_PER_THRESHOLD && params.age < EARLY_PROG_AGE_THRESHOLD) {
            mn = static_cast<int>(std::ceil(per / EARLY_PROG_PER_DIVISOR_MN)) + EARLY_PROG_PER_OFFSET_MN;
            mx = static_cast<int>(std::ceil(per / EARLY_PROG_PER_DIVISOR_MX)) + EARLY_PROG_PER_OFFSET_MX;
        } else {
            mn = static_cast<int>(std::ceil(per / static_cast<double>(params.min1))) - params.min2;

            if (params.max1 >= 0 && params.max2 >= 0) {
                mx = static_cast<int>(std::ceil(per / static_cast<double>(params.max1))) - params.max2;
                // Published JS uses `calculated || 2`, including a zero result.
                if (mx == 0) mx = DEFAULT_MAX_PROG;
            } else {
                mx = DEFAULT_MAX_PROG;
            }
        }

        return {mn, mx};
    }

    /// @brief Apply hard min/max limits from age params.
    [[nodiscard]] inline std::pair<int, int> apply_hard_limits(
        int mn, int mx, const AgeParams& params
    ) const noexcept {
        if (mx > params.hard_max) {
            mx = params.hard_max;
        }
        return {mn, mx};
    }

    /// @brief Apply OVR cap logic with age-based adjustments.
    /// @note Retains the pinned Published JS randomMin branch literally.
    template <typename Draws>
    [[nodiscard]] inline std::pair<int, int> apply_ovr_cap_logic(
        int mn, int mx, int ovr, int age, Draws& draws
    ) const {
        int ovr_progression = mx + ovr;
        int flag_lower = mn + ovr;

        if (ovr_progression >= MAX_OVR) {
            if (ovr >= MAX_OVR) {
                mx = 0;
                if (age > 30 && age < 35) {
                    mn = -10;
                } else if (age >= 35) {
                    mn = -14;
                } else if (age <= 30) {
                    // Published JS consumes this draw even though every outcome
                    // {-2, -1, 0} satisfies randomMin < 0.02.
                    int random_min = static_cast<int>(std::floor(draws.unit() * 3.0)) - 2;
                    if (random_min < 0.02) {
                        mn = -2;
                    }
                }
                // Prevent inverted range
                if (mn > mx) {
                    mn = 0;
                }
            } else {
                // Approaching cap - limit max progression
                mx = MAX_OVR - ovr;
                if (flag_lower >= MAX_OVR) {
                    mn = 0;
                }
            }
        }

        return {mn, mx};
    }

    /// @brief Main entry point for calculating progression range.
    template <typename Draws>
    [[nodiscard]] inline std::pair<int, int> get_progression_range(
        double per, int age, int ovr, Draws& draws
    ) const {
        auto params = get_age_params(age);
        auto [mn, mx] = calculate_base_range(per, params);
        std::tie(mn, mx) = apply_hard_limits(mn, mx, params);
        return apply_ovr_cap_logic(mn, mx, ovr, age, draws);
    }

    // ========================================================================
    // God Progression System
    // ========================================================================

    /// @brief Calculate god progression chance based on OVR.
    /// @details Scale ranges from 1.0 (OVR < 30) to 0.01 (OVR > 61).
    [[nodiscard]] inline double calculate_god_prog_chance(int ovr) const noexcept {
        double scale;
        if (ovr < MIN_RATING) {
            scale = 1.0;
        } else if (ovr > MAX_RATING) {
            scale = 0.01;
        } else {
            scale = 1.0 - static_cast<double>(ovr - MIN_RATING)
                         / static_cast<double>(MAX_RATING - MIN_RATING);
        }
        return scale * MAX_GOD_PROG_CHANCE;
    }

    /// @brief Attempt god progression for a player.
    /// @return std::nullopt if no god prog, otherwise (min, max) tuple.
    template <typename Draws>
    [[nodiscard]] inline std::optional<std::pair<int, int>> attempt_god_prog(
        int age, int ovr, Draws& draws
    ) const {
        if (age >= YOUNG_MAX) {
            return std::nullopt;
        }

        double chance = calculate_god_prog_chance(ovr);
        if (draws.unit() >= chance) {
            return std::nullopt;
        }

        const int bonus = static_cast<int>(std::floor(
            draws.unit() * (MAX_GOD_PROG_EXCLUSIVE - MIN_GOD_PROG))) + MIN_GOD_PROG;
        return std::make_pair(bonus, bonus);
    }

    // ========================================================================
    // Attribute Progression
    // ========================================================================

    /// @brief Apply physical caps for older players.
    /// @return Tuple of (adjusted_mn, adjusted_mx, skip_flag).
    template <typename Draws>
    [[nodiscard]] inline std::tuple<int, int, bool> apply_physical_caps(
        size_t idx, int age, int mn, int mx, Draws& draws
    ) const {
        // Only applies to age >= 30 for physical attributes with positive max
        if (age < 30 || !is_physical_old(idx) || mx <= 0) {
            return {mn, mx, false};
        }

        // Preserve the published branch literally: usually progress normally.
        // The rare branch caps a >3 maximum, otherwise skips this attribute.
        const double old_prog_phys = draws.unit() * 0.05 + 0.01;
        if (draws.unit() < old_prog_phys) {
            if (mx > 3) mx = 3;
            else return {mn, mx, true};
        }

        return {mn, mx, false};
    }

    /// @brief Apply mid-age slowdown for physical attributes (ages 25-29).
    template <typename Draws>
    [[nodiscard]] inline int apply_mid_age_slowdown(
        size_t idx, int age, int prog, Draws& draws
    ) const {
        if (!(25 <= age && age < 30 && is_physical_mid(idx) && prog > 0)) {
            return prog;
        }

        // Probability decreases with age: 0.7 at 25, 0.3 at 29
        double age_factor = 0.7 - (age - 25) * 0.1;
        double prob_progression = std::max(age_factor, 0.0);

        // JS: return Math.random() > probProgression; (returns true to SKIP)
        // Inverted: keep prog if random() <= prob
        return (draws.unit() <= prob_progression) ? prog : 0;
    }

    /// @brief Progress a single attribute with all applicable rules.
    template <typename Draws>
    [[nodiscard]] inline double progress_attribute(
        size_t idx, int age, int& mn, int& mx, double current_rating, Draws& draws
    ) const {
        // Apply physical caps first
        auto [adj_mn, adj_mx, skip] = apply_physical_caps(idx, age, mn, mx, draws);
        if (skip) {
            return current_rating;
        }

        // JS mutates the shared progRange, so later nonphysical attributes also
        // observe a cap triggered by an earlier physical attribute.
        mn = adj_mn;
        mx = adj_mx;

        // Calculate base progression
        int prog = 0;
        if (adj_mn <= adj_mx) {
            prog = draws.integer(adj_mn, adj_mx);
        } else {
            // JS randInt uses floor(uniform * (max-min+1) + min), even when
            // extreme PER produces an inverted range. Do not feed that range
            // to std::uniform_int_distribution, whose precondition forbids it.
            prog = static_cast<int>(std::floor(draws.unit() * (adj_mx - adj_mn + 1) + adj_mn));
        }

        // JS `continue` leaves the attribute untouched, even if fractional.
        const int slowed = apply_mid_age_slowdown(idx, age, prog, draws);
        if (prog > 0 && slowed == 0) return current_rating;

        // BBGM limitRating floors before the final OVR calculation.
        return std::floor(std::clamp(current_rating + static_cast<double>(slowed), 0.0, 100.0));
    }

public:
    /// @brief Runs the full V3.2.1 progression pipeline for a single player.
    /// @details Skips players under 25 or with PER == 0. Calculates ranges,
    ///          rolls for god-progs with OVR-scaled chance, and applies deltas.
    /// @param player The initial player state.
    /// @param rng The run-specific random number generator.
    /// @param run_seed The seed of the simulation run.
    /// @return The final ProgressionResult.
    ProgressionResult progress_player(
        const PlayerState& player,
        const PlayerStats& stats,
        std::mt19937& rng,
        int64_t run_seed
    ) const override {
        ProgressionDraws draws{rng};
        return progress_player_with_draws(player, stats, draws, run_seed);
    }

    template <typename Draws>
    ProgressionResult progress_player_with_draws(const PlayerState& player,
                                                const PlayerStats& stats,
                                                Draws& draws,
                                                int64_t run_seed) const {
        PlayerState out = player;
        std::optional<GodProgRecord> god_prog = std::nullopt;

        int age = static_cast<int>(out.age);

        // Skip conditions
        if (age < 25 || stats.per == 0.0) {
            int ovr = calcovr_from_array(out.attrs);
            return {out, ovr, std::nullopt};
        }

        int ovr = calcovr_from_array(out.attrs);
        auto [mn, mx] = get_progression_range(stats.per, age, ovr, draws);

        // Check for god progression
        if (auto gp = attempt_god_prog(age, ovr, draws)) {
            std::tie(mn, mx) = *gp;
            god_prog = GodProgRecord{
                "",                              // name (set by caller if needed)
                run_seed,
                age,
                ovr,
                mn,                              // jump amount
                calculate_god_prog_chance(ovr)   // actual chance used
            };
        }

        // Apply progression to each attribute (excluding Hgt at index 14)
        for (size_t i = 0; i < 15; ++i) {
            if (i != 14) {
                out.attrs[i] = progress_attribute(i, age, mn, mx, out.attrs[i], draws);
            }
        }

        int final_ovr = calcovr_from_array(out.attrs);
        return {out, final_ovr, god_prog};
    }

    /// @brief Get human-readable version identifier.
    [[nodiscard]] std::string version() const noexcept override {
        return "v3.2.1";
    }
};

} // namespace progbox
