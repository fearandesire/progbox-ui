/// @file i_progression.hpp
/// @brief Defines the interface for progression algo implementations.
/// @author @akshayexists

#pragma once

#include "core_types.hpp"

#include <functional>
#include <memory>
#include <optional>
#include <random>
#include <string>
#include <vector>

namespace progbox {

// Forward declaration
class IProgressionStrategy;

/// @brief Descriptor for a registered progression strategy.
struct ProgressionEntry {
    std::string id;                                                  ///< CLI identifier (e.g., "v321")
    std::string display_name;                                        ///< Human-readable description
    std::function<std::unique_ptr<IProgressionStrategy>()> factory;  ///< Factory function
};

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
    /// @param player The initial (mutable) player state.
    /// @param stats  Immutable season statistical profile (read-only context).
    /// @param rng The run-specific random number generator.
    /// @param run_seed The seed of the simulation run (for tracking).
    /// @return The final progression result.
    virtual ProgressionResult progress_player(
        const PlayerState& player,
        const PlayerStats& stats,
        std::mt19937& rng,
        int64_t run_seed
    ) const = 0;

    /// @brief Get human-readable version identifier.
    /// @return Version string like "v3.2.1" or "v4.1".
    [[nodiscard]] virtual std::string version() const noexcept = 0;

    /// @brief Optional one-time hook to precompute pool-wide context before runs.
    /// @details Called exactly once by SimEngine before the parallel run loop,
    ///          with the full player pool. Strategies needing cross-player
    ///          statistics (e.g. z-scoring) override this; default is a no-op.
    ///          Must leave the strategy safe for concurrent const progress_player.
    virtual void prepare([[maybe_unused]] const std::vector<PlayerStats>& pool) {}
};
} // namespace progbox
