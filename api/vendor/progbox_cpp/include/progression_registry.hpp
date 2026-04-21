/// @file progression_registry.hpp
/// @brief Central registry of all progression strategy implementations.
/// @author @akshayexists
///
/// TO ADD A NEW PROGRESSION SCRIPT:
///   1. Add #include "your_new_progression.hpp" in the INCLUDES section below
///   2. Add a registry entry to the vector in get()
///
/// main.cpp will automatically discover and list all registered versions.

#pragma once

// ============================================================================
// PROGRESSION IMPLEMENTATION INCLUDES
// ============================================================================
#include "scripts/v321_progression.hpp"
#include "scripts/v41_progression.hpp"
// ── Add new progression headers above this line ──────────────────────────
// ============================================================================

#include "i_progression.hpp"
#include <memory>
#include <string>
#include <vector>
#include <functional>

namespace progbox {

/// @brief Descriptor for a registered progression strategy.
struct ProgressionEntry {
    std::string id;                                          ///< CLI identifier (e.g., "v321")
    std::string display_name;                                ///< Human-readable description
    std::function<std::unique_ptr<IProgressionStrategy>()> factory;  ///< Factory function
};

/// @brief Singleton registry providing access to all progression strategies.
/// @note Lazily initialized on first access. Thread-safe in C++11+.
class ProgressionRegistry {
public:
    /// @brief Get the registry instance (lazy initialization).
    static const std::vector<ProgressionEntry>& entries() {
        static const std::vector<ProgressionEntry> registry = {
            {
                "v41",
                "V4.1 - updated version using EWA, DWS on top of PER from v3",
                []() -> std::unique_ptr<IProgressionStrategy> { return std::make_unique<V41Progression>(); }
            },
            {
                "v321",
                "V3.2.1 - Current in-use script",
                []() -> std::unique_ptr<IProgressionStrategy> { return std::make_unique<V321Progression>(); }
            },
            // ─────────────────────────────────────────────────────────────────
            // ADD NEW PROGRESSION ENTRIES ABOVE THIS LINE
            // Format: { "id", "Description", []() { return std::make_unique<ClassName>(); } }
            // ─────────────────────────────────────────────────────────────────
        };
        return registry;
    }

    /// @brief Create a progression strategy by ID.
    /// @param id The CLI identifier (e.g., "v321", "v41").
    /// @return Unique pointer to the strategy, or nullptr if not found.
    [[nodiscard]] static std::unique_ptr<IProgressionStrategy> create(const std::string& id) {
        for (const auto& entry : entries()) {
            if (entry.id == id) {
                return entry.factory();
            }
        }
        return nullptr;
    }

    /// @brief Find an entry by ID.
    /// @return Pointer to the entry, or nullptr if not found.
    [[nodiscard]] static const ProgressionEntry* find(const std::string& id) {
        for (const auto& entry : entries()) {
            if (entry.id == id) {
                return &entry;
            }
        }
        return nullptr;
    }

    /// @brief Check if a version ID exists in the registry.
    [[nodiscard]] static bool contains(const std::string& id) {
        return find(id) != nullptr;
    }

    /// @brief Get comma-separated list of version IDs.
    [[nodiscard]] static std::string id_list() {
        std::string result;
        for (size_t i = 0; i < entries().size(); ++i) {
            if (i > 0) result += ", ";
            result += entries()[i].id;
        }
        return result;
    }

    /// @brief Format a multi-line listing of all versions with descriptions.
    [[nodiscard]] static std::string formatted_list() {
        std::string result;
        for (size_t i = 0; i < entries().size(); ++i) {
            const auto& e = entries()[i];
            result += "  " + e.id + "    " + e.display_name + "\n";
        }
        return result;
    }

    /// @brief Get the number of registered progression strategies.
    [[nodiscard]] static size_t count() noexcept {
        return entries().size();
    }

    /// @brief Get the default progression ID (first entry).
    [[nodiscard]] static const std::string& default_id() noexcept {
        return entries().front().id;
    }
};

} // namespace progbox