/// @file main.cpp
/// @brief Orchestration layer with automatic progression script version
/// discovery.
/// @author @akshayexists
///
/// This is the main entry point for the Progbox Simulator. It handles CLI
/// parsing, player data loading, Monte Carlo simulation execution, analytics
/// export, and optional Python post-processing.
///
/// Execution Flow:
///   1. Parse CLI into optional fields (absent = "not specified")
///   2. Load config file, merge into the unset fields
///   3. Resolve final Settings, validate required inputs
///   4. Resolve progression strategy via registry
///   5. Parse export + teaminfo JSON (once)
///   6. Resolve effective year (may be clamped by the export) and seed
///   7. Load and filter player data
///   8. Print the run banner
///   9. Create output directory, write metadata
///  10. Execute Monte Carlo simulation
///  11. Export analytics (raw CSV, summary CSV, god-prog JSON)
///  12. Run optional Python post-processing script

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstdio>
#include <filesystem>
#include <format>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <memory>
#include <optional>
#include <random>
#include <sstream>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

#include "analytics.hpp"
#include "json.hpp"
#include "ovr_math.hpp"
#include "progression_registry.hpp"
#include "sim_engine.hpp"

namespace fs = std::filesystem;
using json = nlohmann::json;

// ============================================================================
// JSON Helpers
// ============================================================================

/// @brief Safely extracts a numeric value from a JSON node.
/// @details Handles null, numeric, and string representations. Strings are
///          parsed via stoi/stod as appropriate. Returns default on failure.
/// @tparam T The output type (int, double, or bool).
/// @param j The JSON node to extract from.
/// @param default_val Fallback value if extraction fails.
/// @return The extracted value, or default_val on any error.
template <typename T>
T safe_json_number(const json& j, T default_val = T{}) {
    if (j.is_null()) return default_val;
    if (j.is_boolean() && std::is_same_v<T, bool>) return j.get<T>();
    if (j.is_number()) return j.get<T>();
    if (j.is_string()) {
        try {
            if constexpr (std::is_same_v<T, int>) {
                return std::stoi(j.get<std::string>());
            } else if constexpr (std::is_same_v<T, double>) {
                return std::stod(j.get<std::string>());
            } else if constexpr (std::is_same_v<T, bool>) {
                std::string s = j.get<std::string>();
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
template <typename T>
T safe_json_get(const nlohmann::json& j, const std::string& key,
                T default_val = T{}) {
    if (!j.contains(key)) return default_val;
    return safe_json_number<T>(j[key], default_val);
}

/// @brief Parses a JSON file from disk.
/// @return The parsed document, or std::nullopt if the file is missing or
///         malformed (the reason is printed to stderr).
std::optional<json> parse_json_file(const fs::path& path, const char* what) {
    std::ifstream f(path);
    if (!f.is_open()) {
        printf("Error: Cannot open %s file: %s\n", what, path.string().c_str());
        return std::nullopt;
    }
    try {
        return json::parse(f);
    } catch (const std::exception& e) {
        printf("Error: Malformed %s JSON (%s): %s\n", what,
               path.string().c_str(), e.what());
        return std::nullopt;
    }
}

/// @brief Mapping of common abbreviation mismatches to canonical attribute
/// names.
/// @details Handles cases where the source JSON uses shorthand keys like
///          "end" instead of "endu", or "str" instead of "stre".
const std::unordered_map<std::string, std::string> FAILSAFE = {
    {"end", "endu"}, {"2pt", "fg"}, {"3pt", "tp"}, {"str", "stre"}};

// ============================================================================
// Configuration
// ============================================================================

namespace progbox_cfg {

/// @brief Built-in fallback values, used only when neither the config file nor
///        the CLI supplies a setting. These are the ONLY hardcoded knobs, and
///        every one of them is overridable.
struct Defaults {
    static constexpr int runs = 500;
    static constexpr int year = 2021;
    static constexpr int workers = 0;  ///< 0 = auto-detect hardware threads
    static constexpr int seed = 69;    ///< 0 = draw a random seed
    static constexpr bool run_analysis = true;
    static constexpr const char* config_file = "config.json";
    static constexpr const char* analysis_script = "tools/analysis.py";
#if defined(_WIN32) || defined(_WIN64)
    static constexpr const char* python_exe = "python";
#else
    static constexpr const char* python_exe = "python3";
#endif
};

/// @brief Raw, partially-specified options from ONE source (CLI or file).
/// @details Every field is optional
struct Options {
    std::optional<std::string> export_path;
    std::optional<std::string> teaminfo_path;
    std::optional<fs::path> output_dir;
    std::optional<std::string> version;
    std::optional<int> runs;
    std::optional<int> year;
    std::optional<int> workers;
    std::optional<int> seed;
    std::optional<bool> run_analysis;
    std::optional<std::string> analysis_script;
};

/// @brief validated configuration used by the rest of the run.
struct Settings {
    std::string export_path;
    std::string teaminfo_path;
    fs::path output_dir;
    std::string version;
    int runs;
    int year;
    int workers;
    int seed;
    bool run_analysis;
    std::string analysis_script;
    std::string python_exe;
};

/// @brief Fill `dst` from `j[key]` only if `dst` is still unset.
template <typename T>
void merge(std::optional<T>& dst, const json& j, const std::string& key) {
    if (dst.has_value() || !j.is_object() || !j.contains(key) ||
        j[key].is_null())
        return;
    dst = safe_json_number<T>(j[key], T{});
}

/// @brief String specialization of merge().
void merge_str(std::optional<std::string>& dst, const json& j,
               const std::string& key) {
    if (dst.has_value() || !j.is_object() || !j.contains(key) ||
        !j[key].is_string())
        return;
    dst = j[key].get<std::string>();
}

/// @brief Merges a config-file document into any options the CLI left unset.
void merge_config_file(Options& opts, const json& cfg) {
    merge_str(opts.export_path, cfg, "export_path");
    merge_str(opts.teaminfo_path, cfg, "teaminfo_path");
    merge_str(opts.version, cfg, "version");
    merge_str(opts.analysis_script, cfg, "analysis_script");

    if (!opts.output_dir.has_value() && cfg.is_object() &&
        cfg.contains("output_dir") && cfg["output_dir"].is_string()) {
        opts.output_dir = fs::path(cfg["output_dir"].get<std::string>());
    }

    merge(opts.runs, cfg, "runs");
    merge(opts.year, cfg, "year");
    merge(opts.workers, cfg, "workers");
    merge(opts.seed, cfg, "seed");
    merge(opts.run_analysis, cfg, "run_analysis");
}

/// @brief Collapses partially-specified options onto the built-in defaults.
/// @return std::nullopt if a required input (export, teaminfo, output) is
///         missing from every source.
std::optional<Settings> resolve(const Options& opts) {
    if (!opts.export_path || !opts.teaminfo_path || !opts.output_dir) {
        printf(
            "Error: export.json, teaminfo.json and output_dir are required.\n"
            "       Supply them positionally, or as \"export_path\", "
            "\"teaminfo_path\" and \"output_dir\" in the config file.\n");
        return std::nullopt;
    }

    Settings s;
    s.export_path = *opts.export_path;
    s.teaminfo_path = *opts.teaminfo_path;
    s.output_dir = *opts.output_dir;
    s.version =
        opts.version.value_or(progbox::ProgressionRegistry::default_id());
    s.runs = opts.runs.value_or(Defaults::runs);
    s.year = opts.year.value_or(Defaults::year);
    s.workers = opts.workers.value_or(Defaults::workers);
    s.seed = opts.seed.value_or(Defaults::seed);
    s.run_analysis = opts.run_analysis.value_or(Defaults::run_analysis);
    s.analysis_script =
        opts.analysis_script.value_or(Defaults::analysis_script);
    s.python_exe = Defaults::python_exe;

    if (s.runs <= 0) {
        printf("Error: runs must be positive (got %d)\n", s.runs);
        return std::nullopt;
    }
    if (s.workers <= 0) {
        s.workers = static_cast<int>(std::thread::hardware_concurrency());
        if (s.workers == 0) s.workers = 4;
    }
    return s;
}

}  // namespace progbox_cfg

// ============================================================================
// CLI
// ============================================================================

/// @brief Prints usage information and available progression versions.
/// @param prog_name The name of the executable (typically argv[0]).
void print_usage(const char* prog_name) {
    using D = progbox_cfg::Defaults;
    printf(R"(
+--------------------------------------------------------------+
|                      ProgBox Simulator                       |
+--------------------------------------------------------------+

Usage: %s [export.json teaminfo.json output_dir] [options]

Inputs (required, from CLI or config file):
  export.json      Player export JSON
  teaminfo.json    Team info JSON
  output_dir       Output directory

Options:
  -c, --config     Config file (default: %s if present)
  -v, --version    Progression version (default: %s)
  -r, --runs       Simulation runs (default: %d)
  -y, --year       Season year (default: %d, clamped to export's latest)
  -w, --workers    Worker threads (default: auto-detect)
  -s, --seed       RNG seed, 0 = random (default: %d)
      --analysis   Run Python post-processing (default: %s)
      --no-analysis  Skip Python post-processing
  -h, --help       Show this help

Configuration precedence: defaults < config file < command line.

Config file keys (all optional):
  export_path, teaminfo_path, output_dir, version, runs, year,
  workers, seed, run_analysis, analysis_script

Available Versions:
%s
)",
           prog_name, D::config_file,
           progbox::ProgressionRegistry::default_id().c_str(), D::runs, D::year,
           D::seed, D::run_analysis ? "true" : "false",
           progbox::ProgressionRegistry::formatted_list().c_str());
}

/// @brief Parses command-line arguments into partially-specified Options.
/// @details Only sets fields the user actually passed, leaving the rest unset
///          so the config file and defaults can fill them in afterwards.
/// @param[out] config_path Set if the user passed -c/--config explicitly.
/// @return Parsed options, or std::nullopt on a malformed argument.
std::optional<progbox_cfg::Options> parse_args(
    int argc, char** argv, std::optional<fs::path>& config_path) {
    progbox_cfg::Options opts;
    int positional = 0;

    /// Parses an integer option value, reporting the offending flag on failure.
    auto parse_int = [](const char* flag, const char* raw,
                        std::optional<int>& dst) -> bool {
        try {
            dst = std::stoi(raw);
            return true;
        } catch (...) {
            printf("Error: invalid value for %s: '%s'\n", flag, raw);
            return false;
        }
    };

    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        if (arg.empty()) continue;

        if (arg == "-h" || arg == "--help") {
            print_usage(argv[0]);
            std::exit(0);
        } else if ((arg == "-c" || arg == "--config") && i + 1 < argc) {
            config_path = fs::path(argv[++i]);
        } else if ((arg == "-v" || arg == "--version") && i + 1 < argc) {
            opts.version = argv[++i];
        } else if ((arg == "-r" || arg == "--runs") && i + 1 < argc) {
            if (!parse_int("--runs", argv[++i], opts.runs)) return std::nullopt;
        } else if ((arg == "-y" || arg == "--year") && i + 1 < argc) {
            if (!parse_int("--year", argv[++i], opts.year)) return std::nullopt;
        } else if ((arg == "-w" || arg == "--workers") && i + 1 < argc) {
            if (!parse_int("--workers", argv[++i], opts.workers))
                return std::nullopt;
        } else if ((arg == "-s" || arg == "--seed") && i + 1 < argc) {
            if (!parse_int("--seed", argv[++i], opts.seed)) return std::nullopt;
        } else if (arg == "--analysis") {
            opts.run_analysis = true;
        } else if (arg == "--no-analysis") {
            opts.run_analysis = false;
        } else if (arg[0] != '-') {
            if (positional == 0)
                opts.export_path = arg;
            else if (positional == 1)
                opts.teaminfo_path = arg;
            else if (positional == 2)
                opts.output_dir = fs::path(arg);
            else {
                printf("Error: unexpected argument '%s'\n", arg.c_str());
                return std::nullopt;
            }
            ++positional;
        } else {
            printf("Error: unknown option '%s'\n", arg.c_str());
            return std::nullopt;
        }
    }
    return opts;
}

// ============================================================================
// Misc post-build helpers
// ============================================================================

/// @brief Generates a CalVer-style build identifier from the current time.
/// @return A string in the format "YYYYMMDDHHMMSS" (e.g., "20241115143022").
std::string make_calver_id() {
    auto now = std::chrono::system_clock::now();
    auto local_time = std::chrono::current_zone()->to_local(now);
    return std::format("{:%Y%m%d%H%M%S}", local_time);
}

/// @brief Executes the Python post-processing analysis script.
/// @param settings Resolved configuration (supplies interpreter + script path).
/// @param out_dir Directory containing simulation output files.
/// @return The exit code from the Python script (0 = success).
int run_python_analysis(const progbox_cfg::Settings& settings,
                        const fs::path& out_dir) {
    std::string cmd = settings.python_exe + " \"" + settings.analysis_script +
                      "\" \"" + out_dir.string() + "\"";
    printf("Running analysis: %s\n", cmd.c_str());
    return std::system(cmd.c_str());
}

/// @brief Determines the effective season year for a given export.
/// @details The export's latest award season + 1 is the newest season present.
///          A requested year beyond that would age every player incorrectly, so
///          it is clamped down. Returning the value (rather than mutating a
///          local copy, as the previous implementation did) is what lets the
///          banner and metadata.json report the year actually used.
/// @param data Parsed player export document.
/// @param requested The year requested via config/CLI.
/// @return The effective year to use for age calculation.
int resolve_year(const json& data, int requested) {
    int latest = 0;
    if (data.contains("awards") && data["awards"].is_array() &&
        !data["awards"].empty()) {
        try {
            latest = safe_json_get<int>(data["awards"].back(), "season", 0) + 1;
        } catch (const std::exception&) {
            printf("Warning: could not determine year from export.\n");
        }
    }
    if (latest > 0 && requested > latest) {
        printf("Note: requested year %d exceeds export; using latest (%d).\n",
               requested, latest);
        return latest;
    }
    return requested;
}

/// @brief Writes run metadata to a JSON file for reproducibility tracking.
/// @param out_dir Directory where metadata.json will be saved.
/// @param build_id CalVer timestamp identifier for this run.
/// @param display_name Human-readable progression name.
/// @param settings Resolved configuration (records the year ACTUALLY used).
/// @param player_count Number of players loaded after filtering.
/// @param seed RNG seed used for the simulation.
void write_metadata(const fs::path& out_dir, const std::string& build_id,
                    const std::string& display_name,
                    const progbox_cfg::Settings& settings, size_t player_count,
                    int seed) {
    auto now = std::chrono::system_clock::now();
    auto local_time = std::chrono::current_zone()->to_local(now);
    std::string iso_time = std::format("{:%Y-%m-%dT%H:%M:%S}", local_time);

    json meta = {
        {"build_id", build_id},
        {"timestamp", iso_time},
        {"progression", {{"id", settings.version}, {"name", display_name}}},
        {"simulation",
         {{"runs", settings.runs},
          {"workers", settings.workers},
          {"year", settings.year},
          {"seed", seed}}},
        {"inputs",
         {{"export_path", settings.export_path},
          {"teaminfo_path", settings.teaminfo_path}}},
        {"player_count", player_count}};

    std::ofstream f(out_dir / "metadata.json");
    if (f.is_open()) {
        f << meta.dump(4);
    }
}

// ============================================================================
// Player Loading
// ============================================================================

/// @brief Loads and filters player data.
/// @details Applies the following filter pipeline to each player:
///   1. Team ID must be >= -1 (valid team or free agent)
///   2. Must have non-empty stats array
///   3. Must have non-zero PER
///   4. Must be age >= 25 in the given year (can be removed later if we decide
///   an under 25 progression script is within scope.)
///
/// Stats are selected from the second-to-last entry if the last entry is
/// playoff data (and a regular-season entry exists), otherwise the last entry
/// is used. Attribute keys are normalized to lowercase and remapped via the
/// FAILSAFE table.
///
/// @param data Parsed player export document.
/// @param team_lookup Parsed team info lookup document.
/// @param year The effective season year (already resolved).
/// @param[out] out_meta Populated with player name and team.
/// @param[out] out_states Populated with mutable player state and baseline OVR.
/// @param[out] out_stats Populated with the immutable season statistical
///             profile (parallel to out_states).
void load_players(const json& data, const json& team_lookup, int year,
                  std::vector<progbox::PlayerMeta>& out_meta,
                  std::vector<progbox::PlayerState>& out_states,
                  std::vector<progbox::PlayerStats>& out_stats) {
    if (!data.contains("players") || !data["players"].is_array()) {
        printf("Error: export contains no \"players\" array.\n");
        return;
    }

    for (const auto& p : data["players"]) {
        int tid = safe_json_get<int>(p, "tid", -2);
        if (!p.contains("stats") || !p["stats"].is_array() ||
            p["stats"].empty() || tid < -1)
            continue;

        const auto& stats_arr = p["stats"];
        const json& last_stat = stats_arr.back();
        const bool is_playoffs =
            safe_json_get<bool>(last_stat, "playoffs", false);

        if (is_playoffs && stats_arr.size() < 2) continue;
        const json& stat =
            is_playoffs ? stats_arr[stats_arr.size() - 2] : last_stat;

        double per = safe_json_get<double>(stat, "per", 0.0);
        if (per == 0.0) continue;

        std::string tid_str = std::to_string(tid);
        std::string team = team_lookup.is_object()
                               ? team_lookup.value(tid_str, "Unknown")
                               : "Unknown";

        if (!p.contains("born")) continue;
        int birth_year = safe_json_get<int>(p["born"], "year", year - 25);
        int age = year - birth_year;
        if (age < 25) continue;

        if (!p.contains("ratings") || !p["ratings"].is_array() ||
            p["ratings"].empty())
            continue;

        // rd(): raw value as float.  pg(): per-game (raw / gp).
        auto rd = [&](const char* k) {
            return static_cast<float>(safe_json_get<double>(stat, k, 0.0));
        };
        const float gp = rd("gp");
        auto pg = [&](const char* k) { return gp > 0.f ? rd(k) / gp : 0.f; };

        progbox::PlayerStats pstats{};
        pstats.per = per;  // double, verbatim
        // advanced rates (already league-relative)
        pstats.ewa = rd("ewa");
        pstats.ows = rd("ows");
        pstats.dws = rd("dws");
        pstats.obpm = rd("obpm");
        pstats.dbpm = rd("dbpm");
        pstats.vorp = rd("vorp");
        pstats.ortg = rd("ortg");
        pstats.drtg = rd("drtg");
        pstats.pm100 = rd("pm100");
        pstats.onOff100 = rd("onOff100");
        pstats.astp = rd("astp");
        pstats.blkp = rd("blkp");
        pstats.drbp = rd("drbp");
        pstats.orbp = rd("orbp");
        pstats.stlp = rd("stlp");
        pstats.trbp = rd("trbp");
        pstats.usgp = rd("usgp");
        // volume, per game
        pstats.fg = pg("fg");
        pstats.fga = pg("fga");
        pstats.tp = pg("tp");
        pstats.tpa = pg("tpa");
        pstats.ft = pg("ft");
        pstats.fta = pg("fta");
        pstats.fgAtRim = pg("fgAtRim");
        pstats.fgaAtRim = pg("fgaAtRim");
        pstats.fgLowPost = pg("fgLowPost");
        pstats.fgaLowPost = pg("fgaLowPost");
        pstats.fgMidRange = pg("fgMidRange");
        pstats.fgaMidRange = pg("fgaMidRange");
        pstats.orb = pg("orb");
        pstats.drb = pg("drb");
        pstats.ast = pg("ast");
        pstats.tov = pg("tov");
        pstats.stl = pg("stl");
        pstats.blk = pg("blk");
        pstats.ba = pg("ba");
        pstats.pf = pg("pf");
        pstats.pts = pg("pts");
        pstats.dd = pg("dd");
        pstats.td = pg("td");
        // context / weighting
        pstats.gp = gp;
        pstats.gs = rd("gs");
        pstats.min = gp > 0.f ? rd("min") / gp : 0.f;  // minutes per game
        const float min_avail = rd("minAvailable");
        pstats.availability =
            min_avail > 0.f ? std::min(1.0f, rd("min") / min_avail) : 0.f;

        const json& last_rating = p["ratings"].back();
        std::unordered_map<std::string, int> ratings;
        for (auto& [k, v] : last_rating.items()) {
            std::string key = k;
            std::transform(key.begin(), key.end(), key.begin(), ::tolower);
            ratings[key] = safe_json_number<int>(v, 0);
        }

        /// @brief Lambda to look up a rating attribute with FAILSAFE remapping.
        auto get_attr = [&](const std::string& attr_name) {
            std::string lower_attr = attr_name;
            std::transform(lower_attr.begin(), lower_attr.end(),
                           lower_attr.begin(), ::tolower);
            if (FAILSAFE.count(lower_attr))
                lower_attr = FAILSAFE.at(lower_attr);
            return ratings.count(lower_attr) ? ratings[lower_attr] : 0;
        };

        progbox::PlayerMeta meta;
        meta.name = p.value("firstName", std::string{}) + " " +
                    p.value("lastName", std::string{});
        meta.team = team;

        progbox::PlayerState state;
        state.age = static_cast<double>(age);

        for (size_t i = 0; i < progbox::ALL_ATTRS.size(); ++i) {
            state.attrs[i] = static_cast<double>(
                get_attr(std::string(progbox::ALL_ATTRS[i])));
        }
        state.baseline_ovr =
            static_cast<double>(progbox::calcovr_from_array(state.attrs));

        // Push together to keep the three vectors index-parallel.
        out_meta.push_back(std::move(meta));
        out_stats.push_back(pstats);
        out_states.push_back(state);
    }
}

// ============================================================================
// Main
// ============================================================================

/// @brief Program entry point.
/// @details Orchestrates the full simulation pipeline.
/// @param argc Argument count.
/// @param argv Argument vector.
/// @return 0 on success, 1 on error.
int main(int argc, char** argv) {
    //    Phase 1: Parse CLI (leaves unspecified fields empty)
    std::optional<fs::path> explicit_config;
    std::optional<progbox_cfg::Options> cli =
        parse_args(argc, argv, explicit_config);
    if (!cli) {
        print_usage(argv[0]);
        return 1;
    }
    progbox_cfg::Options opts = *cli;

    //    Phase 2: Merge config file into whatever the CLI left unset
    // An explicit --config that cannot be read is a hard error; the implicit
    // default file is simply skipped when absent.
    const fs::path cfg_path =
        explicit_config.value_or(fs::path(progbox_cfg::Defaults::config_file));
    if (fs::exists(cfg_path)) {
        std::optional<json> cfg = parse_json_file(cfg_path, "config");
        if (!cfg) return 1;
        printf("Using config: %s\n", cfg_path.string().c_str());
        progbox_cfg::merge_config_file(opts, *cfg);
    } else if (explicit_config) {
        printf("Error: config file not found: %s\n", cfg_path.string().c_str());
        return 1;
    }

    //    Phase 3: Resolve + validate final settings
    std::optional<progbox_cfg::Settings> resolved = progbox_cfg::resolve(opts);
    if (!resolved) {
        print_usage(argv[0]);
        return 1;
    }
    progbox_cfg::Settings settings = *resolved;

    //    Phase 4: Resolve progression strategy
    std::unique_ptr<progbox::IProgressionStrategy> progression =
        progbox::ProgressionRegistry::create(settings.version);
    if (!progression) {
        printf("Error: Unknown version '%s'\n", settings.version.c_str());
        printf("Available: %s\n",
               progbox::ProgressionRegistry::id_list().c_str());
        return 1;
    }
    const progbox::ProgressionEntry* entry =
        progbox::ProgressionRegistry::find(settings.version);
    const std::string display_name =
        entry ? entry->display_name : settings.version;

    //    Phase 5: Parse inputs once (shared by year resolution + loading)
    std::optional<json> export_data =
        parse_json_file(settings.export_path, "export");
    if (!export_data) return 1;
    std::optional<json> team_lookup =
        parse_json_file(settings.teaminfo_path, "teaminfo");
    if (!team_lookup) return 1;

    //    Phase 6: Resolve the values the banner is about to report
    // The year may be clamped by the export
    settings.year = resolve_year(*export_data, settings.year);
    if (settings.seed == 0) {
        std::random_device rd;
        settings.seed = static_cast<int>(rd());
    }

    //    Phase 7: Load players
    printf("Loading players...\n");
    std::vector<progbox::PlayerMeta> player_meta;
    std::vector<progbox::PlayerState> player_states;
    std::vector<progbox::PlayerStats> player_stats;
    load_players(*export_data, *team_lookup, settings.year, player_meta,
                 player_states, player_stats);

    if (player_meta.empty()) {
        printf("No players found. Check export file and year (%d).\n",
               settings.year);
        return 1;
    }

    //    Phase 8: Setup CalVer suffix outpur dir
    const std::string build_id = make_calver_id();
    settings.output_dir /= build_id;
    std::error_code ec;
    fs::create_directories(settings.output_dir, ec);
    if (ec) {
        printf("Error: cannot create output directory %s (%s)\n",
               settings.output_dir.string().c_str(), ec.message().c_str());
        return 1;
    }

    //    Phase 9: Banner
    printf(R"(
+--------------------------------------------------------------+
|                      ProgBox Simulator                       |
+--------------------------------------------------------------+

  Version   : %s
  Players   : %zu
  Runs      : %d
  Workers   : %d
  Year      : %d
  Seed      : %d
  Output    : %s

)",
           display_name.c_str(), player_meta.size(), settings.runs,
           settings.workers, settings.year, settings.seed,
           settings.output_dir.string().c_str());

    //    Phase 10: Write metadata
    write_metadata(settings.output_dir, build_id, display_name, settings,
                   player_meta.size(), settings.seed);

    //    Phase 11: Run simulation
    printf("Simulating...\n");
    progbox::SimEngine engine(*progression, settings.workers);
    std::vector<progbox::RunResult> raw_results = engine.run(
        player_meta, player_states, player_stats, settings.runs, settings.seed);

    /// @note Validate simulation output before proceeding to analytics.
    if (raw_results.empty()) {
        printf("Error: Simulation produced no results.\n");
        return 1;
    }

    //    Phase 12: Compute and export analytics
    printf("Computing analytics...\n");
    progbox::Analytics analytics(player_meta, player_states, player_stats,
                                 raw_results);
    analytics.export_all(settings.output_dir / "raw");

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
)",
           player_meta.size(), settings.runs, settings.seed, god_count,
           settings.output_dir.string().c_str());

    //    Phase 13: Python post-processing
    if (settings.run_analysis) {
        std::cout << "Running Python analysis...\n";
        int rc = run_python_analysis(settings, settings.output_dir);
        if (rc != 0) {
            std::cerr << "Warning: postprocess script failed (" << rc << ")\n";
        }
    } else {
        std::cout << "Skipping Python analysis.\n";
    }

    return 0;
}
