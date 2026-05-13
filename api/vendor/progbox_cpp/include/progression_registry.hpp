/// @file progression_registry.hpp
/// @brief Central registry of all progression strategy implementations.
/// @author @akshayexists
///
/// ============================================================================
/// AUTO-REGISTRATION SYSTEM
/// ============================================================================
/// Entries are automatically discovered from @progbox-register blocks in
/// script headers. The registry is generated at build time.
///
/// TO ADD A NEW PROGRESSION SCRIPT:
///   1. Create your_new_progression.hpp in the scripts/ directory
///   2. Add this MANDATORY block at the top of your file:
///
///        /// @progbox-register
///        ///   id: your_id
///        ///   name: "Your Description Here"
///        ///   class: YourClassName
///        /// @end-progbox-register
///
///   3. Rebuild - CMake will automatically regenerate the registry
///
/// RULES:
///   - id: Single word, no quotes (e.g., v42, experimental_v1)
///   - name: Quoted string with description
///   - class: Exact class name (must inherit IProgressionStrategy)
/// ============================================================================

#pragma once

#include "generated_progression_registry.hpp"
#include "i_progression.hpp"
#include <string>

namespace progbox {

/// @brief Singleton registry providing access to all progression strategies.
/// @note Entries are populated from generated_progression_registry.hpp
class ProgressionRegistry {
public:
    /// @brief Get all registered entries.
    static const std::vector<ProgressionEntry>& entries() {
        return generated::entries();
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
        for (const auto& e : entries()) {
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
        static const std::string& first_id = entries().front().id;
        return first_id;
    }
};

} // namespace progbox