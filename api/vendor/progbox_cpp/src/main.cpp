/// @file main.cpp
/// @brief Orchestration layer with automatic progression script version discovery.
/// @author @akshayexists
///
/// This is the main entry point for the ProgBox Simulator. It handles CLI
/// parsing, player data loading, Monte Carlo simulation execution, analytics
/// export, and optional Python post-processing.
///
/// Execution Flow:
///   1. Parse CLI arguments
///   2. Create timestamped output directory
///   3. Resolve progression strategy via registry
///   4. Load and filter player data from JSON exports
///   5. Write run metadata
///   6. Execute Monte Carlo simulation
///   7. Export analytics (raw CSV, summary CSV, god-prog JSON)
///   8. Run optional Python post-processing script

#include <iostream>
#include <fstream>
#include <filesystem>
#include <cstdio>
#include <string>
#include <memory>
#include <optional>
#include <chrono>
#include <iomanip>
#include <sstream>
#include <random>
#include <algorithm>

#include "progression_registry.hpp"
#include "sim_engine.hpp"
#include "analytics.hpp"
#include "json.hpp"

namespace fs = std::filesystem;
using json = nlohmann::json;


// ============================================================================
// CLI
// ============================================================================

/// @brief Parsed command-line arguments for the simulator.
struct CliArgs {
    std::string export_path;       ///< Path to player export JSON.
    std::string teaminfo_path;     ///< Path to team info JSON.
    fs::path output_dir;           ///< Base output directory (build ID appended).
    std::string version;           ///< Progression strategy ID (e.g., "v321").
    int runs = 1000;               ///< Number of Monte Carlo simulation runs.
    int year = 2021;               ///< Season year for age calculation.
    int workers = 0;               ///< Worker threads (0 = auto-detect).
    int seed = 69;                  ///< RNG seed (0 = random).
};

/// @brief Prints usage information and available progression versions to stdout.
/// @param prog_name The name of the executable (typically argv[0]).
void print_usage(const char* prog_name) {
    printf(R"(
╔══════════════════════════════════════════════════════════════╗
║                    ProgBox Simulator                        ║
╚══════════════════════════════════════════════════════════════╝

Usage: %s <export.json> <teaminfo.json> <output_dir> [options]

Required:
  export.json      Player export JSON
  teaminfo.json    Team info JSON  
  output_dir       Output directory

Options:
  -v, --version    Progression version (default: %s)
  -r, --runs       Simulation runs (default: 1000)
  -y, --year       Season year (default: 2021)
  -w, --workers    Worker threads (default: auto)
  -s, --seed       RNG seed (default: 69)
  -h, --help       Show this help

Available Versions:
%s
)", prog_name, progbox::ProgressionRegistry::default_id().c_str(),
   progbox::ProgressionRegistry::formatted_list().c_str());
}

/// @brief Parses command-line arguments into a CliArgs struct.
/// @param argc Argument count from main().
/// @param argv Argument vector from main().
/// @return Parsed arguments, or std::nullopt on error (triggers usage display).
std::optional<CliArgs> parse_args(int argc, char** argv) {
    CliArgs args;
    args.version = progbox::ProgressionRegistry::default_id();
    int positional = 0;

    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];

        if (arg == "-h" || arg == "--help") {
            print_usage(argv[0]);
            std::exit(0);
        }
        else if ((arg == "-v" || arg == "--version") && i + 1 < argc) {
            args.version = argv[++i];
        }
        else if ((arg == "-r" || arg == "--runs") && i + 1 < argc) {
            try { args.runs = std::stoi(argv[++i]); }
            catch (...) { printf("Error: invalid runs\n"); return std::nullopt; }
        }
        else if ((arg == "-y" || arg == "--year") && i + 1 < argc) {
            try { args.year = std::stoi(argv[++i]); }
            catch (...) { printf("Error: invalid year\n"); return std::nullopt; }
        }
        else if ((arg == "-w" || arg == "--workers") && i + 1 < argc) {
            try { args.workers = std::stoi(argv[++i]); }
            catch (...) { printf("Error: invalid workers\n"); return std::nullopt; }
        }
        else if ((arg == "-s" || arg == "--seed") && i + 1 < argc) {
            try { args.seed = std::stoi(argv[++i]); }
            catch (...) { printf("Error: invalid seed\n"); return std::nullopt; }
        }
        else if (arg[0] != '-') {
            if (positional == 0) args.export_path = arg;
            else if (positional == 1) args.teaminfo_path = arg;
            else if (positional == 2) args.output_dir = arg;
            else { printf("Error: unexpected argument\n"); return std::nullopt; }
            ++positional;
        }
        else {
            printf("Error: unknown option '%s'\n", arg.c_str());
            return std::nullopt;
        }
    }

    if (positional < 3) return std::nullopt;

    if (args.workers <= 0) {
        args.workers = static_cast<int>(std::thread::hardware_concurrency());
        if (args.workers == 0) args.workers = 4;
    }

    return args;
}


// ============================================================================
// JSON Helpers
// ============================================================================

/// @brief Safely extracts a numeric value from a JSON node.
/// @details Handles null, numeric, and string representations. Strings are
///          parsed via stoi/stod/stob as appropriate. Returns default on failure.
/// @tparam T The output type (int, double, or bool).
/// @param j The JSON node to extract from.
/// @param default_val Fallback value if extraction fails.
/// @return The extracted value, or default_val on any error.
template<typename T>
T safe_json_number(const nlohmann::json& j, T default_val = T{}) {
    if (j.is_null()) return default_val;
    if (j.is_number()) return j.get<T>();
    if (j.is_string()) {
        try {
            if constexpr (std::is_same_v<T, int>) {
                return std::stoi(j.get<std::string>());
            } else if constexpr (std::is_same_v<T, double>) {
                return std::stod(j.get<std::string>());
            } else if constexpr (std::is_same_v<T, bool>) {
                auto s = j.get<std::string>();
                std::transform(s.begin(), s.end(), s.begin(), ::tolower);
                return s == "true" || s == "1" || s == "yes";
            }
        } catch (...) {
            return default_val;
        }
    }
    return default_val;
}

/// @brief Safely retrieves a numeric value from a JSON object by key.
/// @tparam T The output type (int, double, or bool).
/// @param j The JSON object to search.
/// @param key The key to look up.
/// @param default_val Fallback value if key is missing or extraction fails.
/// @return The extracted value, or default_val on any error.
template<typename T>
T safe_json_get(const nlohmann::json& j, const std::string& key, T default_val = T{}) {
    if (!j.contains(key)) return default_val;
    return safe_json_number<T>(j[key], default_val);
}

/// @brief Mapping of common abbreviation mismatches to canonical attribute names.
/// @details Handles cases where the source JSON uses shorthand keys like
///          "end" instead of "endu", or "str" instead of "stre".
const std::unordered_map<std::string, std::string> FAILSAFE = {
    {"end", "endu"}, {"2pt", "fg"}, {"3pt", "tp"}, {"str", "stre"}
};

// ============================================================================
// Misc post-build helpers
// ============================================================================

/// @brief Generates a CalVer-style build identifier from the current time.
/// @return A string in the format "YYYYMMDDHHMMSS" (e.g., "20241115143022").
std::string make_calver_id() {
    using namespace std::chrono;

    auto now = system_clock::now();
    auto t = system_clock::to_time_t(now);
    std::tm tm = *std::localtime(&t);

    std::ostringstream oss;
    oss << std::put_time(&tm, "%Y%m%d%H%M%S");
    return oss.str();
}

/// @brief Executes the Python post-processing analysis script.
/// @param out_dir Directory containing simulation output files.
/// @return The exit code from the Python script (0 = success).
int run_python_analysis(const std::filesystem::path& out_dir) {
    std::string cmd =
        "python3 tools/analysis.py \"" + out_dir.string() + "\"";

    printf("Running analysis: %s\n", cmd.c_str());
    return std::system(cmd.c_str());
}

/// @brief Writes run metadata to a JSON file for reproducibility tracking.
/// @param out_dir Directory where metadata.json will be saved.
/// @param build_id CalVer timestamp identifier for this run.
/// @param version_id Progression strategy identifier (e.g., "v321").
/// @param display_name Human-readable progression name.
/// @param args Parsed CLI arguments.
/// @param player_count Number of players loaded after filtering.
/// @param seed RNG seed used for the simulation.
void write_metadata(
    const std::filesystem::path& out_dir,
    const std::string& build_id,
    const std::string& version_id,
    const std::string& display_name,
    const CliArgs& args,
    size_t player_count,
    int seed
) {
    using json = nlohmann::json;

    auto now = std::chrono::system_clock::now();
    auto t = std::chrono::system_clock::to_time_t(now);
    std::tm tm = *std::localtime(&t);

    std::ostringstream iso_time;
    iso_time << std::put_time(&tm, "%Y-%m-%dT%H:%M:%S");

    json meta = {
        {"build_id", build_id},
        {"timestamp", iso_time.str()},
        {"progression", {
            {"id", version_id},
            {"name", display_name}
        }},
        {"simulation", {
            {"runs", args.runs},
            {"workers", args.workers},
            {"year", args.year},
            {"seed", seed}
        }},
        {"inputs", {
            {"export_path", args.export_path},
            {"teaminfo_path", args.teaminfo_path}
        }},
        {"player_count", player_count}
    };

    std::ofstream f(out_dir / "metadata.json");
    f << meta.dump(4);
}

// ============================================================================
// Player Loading
// ============================================================================

/// @brief Loads and filters player data from JSON export files.
/// @details Applies the following filter pipeline to each player:
///   1. Team ID must be >= -1 (valid team or free agent)
///   2. Must have non-empty stats array
///   3. Must have non-zero PER
///   4. Must be age >= 25 in the given year
///
/// Stats are selected from the second-to-last entry if the last entry is
/// playoff data, otherwise the last entry is used. Attribute keys are
/// normalized to lowercase and remapped via the FAILSAFE table.
///
/// @param export_path Path to the player export JSON file.
/// @param teaminfo_path Path to the team info lookup JSON file.
/// @param year The season year (used to calculate player age).
/// @param[out] out_meta Populated with player name and team.
/// @param[out] out_states Populated with player stats, ratings, and baseline OVR.
void load_players(
    const std::string& export_path,
    const std::string& teaminfo_path,
    int year,
    std::vector<progbox::PlayerMeta>& out_meta,
    std::vector<progbox::PlayerState>& out_states
) {
    std::ifstream ef(export_path);
    if (!ef.is_open()) {
        printf("Error: Cannot open export file: %s\n", export_path.c_str());
        return;
    }
    json data = json::parse(ef);

    std::ifstream tf(teaminfo_path);
    if (!tf.is_open()) {
        printf("Error: Cannot open teaminfo file: %s\n", teaminfo_path.c_str());
        return;
    }
    json team_lookup = json::parse(tf);

    for (auto& p : data["players"]) {
        int tid = safe_json_get<int>(p, "tid", -2);
        if (p["stats"].empty() || tid < -1) continue;

        auto& last_stat = p["stats"].back();
        bool is_playoffs = safe_json_get<bool>(last_stat, "playoffs", false);

        /// @note Assumes at least 2 stat entries if last is playoff data.
        ///       This could crash if the stats array has exactly 1 playoff entry.
        auto& stat = is_playoffs ? p["stats"][p["stats"].size() - 2] : last_stat;

        double per = safe_json_get<double>(stat, "per", 0.0);
        if (per == 0.0) continue;

        double dws = safe_json_get<double>(stat, "dws", 0.0);
        double ewa = safe_json_get<double>(stat, "ewa", 0.0);

        std::string tid_str = std::to_string(tid);
        std::string team = team_lookup.value(tid_str, "Unknown");

        int birth_year = safe_json_get<int>(p["born"], "year", year - 25);
        int age = year - birth_year;
        if (age < 25) continue;

        auto& last_rating = p["ratings"].back();
        std::unordered_map<std::string, int> ratings;
        for (auto& [k, v] : last_rating.items()) {
            std::string key = k;
            std::transform(key.begin(), key.end(), key.begin(), ::tolower);
            ratings[key] = safe_json_number<int>(v, 0);
        }

        /// @brief Lambda to look up a rating attribute with FAILSAFE remapping.
        auto get_attr = [&](const std::string& attr_name) {
            std::string lower_attr = attr_name;
            std::transform(lower_attr.begin(), lower_attr.end(), lower_attr.begin(), ::tolower);
            if (FAILSAFE.count(lower_attr)) lower_attr = FAILSAFE.at(lower_attr);
            return ratings.count(lower_attr) ? ratings[lower_attr] : 0;
        };

        progbox::PlayerMeta meta;
        meta.name = p["firstName"].get<std::string>() + " " + p["lastName"].get<std::string>();
        meta.team = team;

        progbox::PlayerState state;
        state.age = static_cast<double>(age);
        state.per = per;
        state.dws = dws;
        state.ewa = ewa;

        for (size_t i = 0; i < progbox::ALL_ATTRS.size(); ++i) {
            state.attrs[i] = static_cast<double>(get_attr(std::string(progbox::ALL_ATTRS[i])));
        }
        state.baseline_ovr = static_cast<double>(progbox::calcovr_from_array(state.attrs));

        out_meta.push_back(std::move(meta));
        out_states.push_back(state);
    }
}

// ============================================================================
// Main
// ============================================================================

/// @brief Program entry point.
/// @details Orchestrates the full simulation pipeline:
///   1. Parse CLI → 2. Setup output dir → 3. Resolve progression →
///   4. Load players → 5. Write metadata → 6. Run simulation →
///   7. Export analytics → 8. Run Python post-process
/// @param argc Argument count.
/// @param argv Argument vector.
/// @return 0 on success, 1 on error.
int main(int argc, char** argv) {
    // ── Phase 1: Parse CLI ──────────────────────────────────────────────
    auto args = parse_args(argc, argv);
    if (!args) {
        print_usage(argv[0]);
        return 1;
    }

    // ── Phase 2: Setup output directory with CalVer suffix ──────────────
    const std::string build_id = make_calver_id();
    args->output_dir /= build_id;
    std::filesystem::create_directories(args->output_dir);

    // ── Phase 3: Resolve progression strategy ───────────────────────────
    auto progression = progbox::ProgressionRegistry::create(args->version);
    if (!progression) {
        printf("Error: Unknown version '%s'\n", args->version.c_str());
        printf("Available: %s\n", progbox::ProgressionRegistry::id_list().c_str());
        return 1;
    }

    const auto* entry = progbox::ProgressionRegistry::find(args->version);
    std::string display_name = entry ? entry->display_name : args->version;

    // ── Resolve seed: 0 means generate random ───────────────────────────
    int seed = args->seed;
    if (seed == 0) {
        std::random_device rd;
        seed = static_cast<int>(rd());
    }

    printf(R"(
╔══════════════════════════════════════════════════════════════╗
║                          ProgBox                             ║
╚══════════════════════════════════════════════════════════════╝

  Version   : %s
  Runs      : %d
  Workers   : %d
  Year      : %d
  Seed      : %d
  Output    : %s

)", display_name.c_str(), args->runs, args->workers, args->year, seed,
   args->output_dir.string().c_str());

    // ── Phase 4: Load players ───────────────────────────────────────────
    printf("Loading players...\n");
    std::vector<progbox::PlayerMeta> player_meta;
    std::vector<progbox::PlayerState> player_states;
    load_players(args->export_path, args->teaminfo_path, args->year, player_meta, player_states);
    printf("Loaded %zu players.\n", player_meta.size());

    // ── Phase 5: Write metadata ─────────────────────────────────────────
    write_metadata(
        args->output_dir,
        build_id,
        args->version,
        display_name,
        *args,
        player_meta.size(),
        seed
    );

    if (player_meta.empty()) {
        printf("No players found. Check export file and year.\n");
        return 1;
    }

    // ── Phase 6: Run simulation ─────────────────────────────────────────
    printf("Simulating...\n");
    progbox::SimEngine engine(*progression, args->workers);
    auto raw_results = engine.run(player_meta, player_states, args->runs, seed);

    /// @note Validate simulation output before proceeding to analytics.
    if (raw_results.empty()) {
        printf("Error: Simulation produced no results.\n");
        return 1;
    }

    // ── Phase 7: Compute and export analytics ───────────────────────────
    printf("Computing analytics...\n");
    progbox::Analytics analytics(player_meta, player_states, raw_results);
    analytics.export_all(args->output_dir / "raw");

    size_t god_count = 0;
    for (const auto& r : raw_results) god_count += r.god_progs.size();

    printf(R"(
═══════════════════════════════════════════════════════════════
  Players  : %zu
  Runs     : %d
  Seed     : %d
  God Progs: %zu
  Output   : %s
═══════════════════════════════════════════════════════════════
)", player_meta.size(), args->runs, seed, god_count, args->output_dir.string().c_str());

    // ── Phase 8: Python post-processing ─────────────────────────────────
    int rc = run_python_analysis(args->output_dir);
    if (rc != 0) {
        printf("Warning: postprocess script failed (%d)\n", rc);
    }

    return 0;
}