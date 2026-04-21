/// @file i_progression.hpp
/// @brief Defines the interface for progression algo implementations.
/// @author @akshayexists

#pragma once
#include "core_types.hpp"
#include <random>

namespace progbox {

struct ProgressionResult {
    PlayerState final_state;
    int final_ovr;
    std::optional<GodProgRecord> god_prog;
};

/// @brief Interface for progression strategy implementations.
class IProgressionStrategy {
public:
    virtual ~IProgressionStrategy() = default;
    
    /// @brief Progress a single player through one season.
    /// @param player The initial player state.
    /// @param rng The run-specific random number generator.
    /// @param run_seed The seed of the simulation run (for tracking).
    /// @return The final progression result.
    virtual ProgressionResult progress_player(
        const PlayerState& player,
        std::mt19937& rng,
        int64_t run_seed
    ) const = 0;
    
    /// @brief Get human-readable version identifier.
    /// @return Version string like "v3.2.1" or "v4.1".
    [[nodiscard]] virtual std::string version() const noexcept = 0;
};

} // namespace progbox