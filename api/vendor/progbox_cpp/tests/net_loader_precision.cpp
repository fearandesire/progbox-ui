// Exercise production JSON loading without launching its CLI or writing outputs.
#define main progbox_app_main
#include "../src/main.cpp"
#undef main
#include <type_traits>

int main() {
    const json ratings = {{"diq",50},{"dnk",50},{"drb",50},{"endu",50},
        {"fg",50},{"ft",50},{"ins",50},{"jmp",50},{"oiq",50},{"pss",50},
        {"reb",50},{"spd",50},{"stre",50},{"tp",50},{"hgt",50}};
    const json stat = {{"season",2019},{"per",15},{"gp",3},{"min",24},
        {"minAvailable",97},{"tpa",20},{"tp",10},{"stlp",0.123456789012345}};
    const json data = {
        {"_progbox_contract", {{"id","net-runtime-v1"}}},
        {"players", json::array({{
            {"pid",1},{"tid",0},{"firstName","Precision"},{"lastName","Boundary"},
            {"born",{{"year",1990}}},{"ratings",json::array({ratings})},
            {"stats",json::array({stat})}
        }})}
    };
    std::vector<progbox::PlayerMeta> meta;
    std::vector<progbox::PlayerState> states;
    std::vector<progbox::PlayerStats> stats, population;
    load_players(data, json{{"0","Fixture"}}, 2020, meta, states, stats, population);
    int failures = 0;
    auto check = [&](bool condition, const char* message) {
        if (!condition) { std::cerr << message << '\n'; ++failures; }
    };
    check(stats.size()==1 && population.size()==1, "loader must retain target in preparation population");
    if (stats.size()!=1 || population.size()!=1) return 1;
    const auto& s = stats[0];
    // V43 zscores/prepare promote per-game attempts to double before multiplying
    // by gp. Float 20/3 becomes 19.999999523162842 and fails the 20-attempt gate.
    const double reconstructed_attempts = static_cast<double>(s.tpa) * s.gp;
    check(reconstructed_attempts == 20.0, "20 total attempts must survive raw -> per-game -> total exactly");
    check(reconstructed_attempts >= 20.0, "a 20-attempt player must enter the efficiency pool");
    check(s.tpa == 20.0/3.0, "normalized per-game attempts must retain JS double precision");
    check(s.stlp == 0.123456789012345, "advanced rates must retain JSON double precision");
    check(s.availability == 24.0/97.0, "availability division must use double operands");
    check(population[0].tpa == s.tpa, "target and preparation stats must use identical precision");
    check(std::is_same_v<decltype(s.tpa),double>, "PlayerStats attempt fields must store doubles");
    check(std::is_same_v<decltype(s.stlp),double>, "PlayerStats rate fields must store doubles");
    // The unnormalized legacy path must retain its old float quantization,
    // even though the shared storage now supports doubles for NET parity.
    json legacy = data;
    legacy.erase("_progbox_contract");
    std::vector<progbox::PlayerMeta> legacy_meta;
    std::vector<progbox::PlayerState> legacy_states;
    std::vector<progbox::PlayerStats> legacy_stats, legacy_population;
    load_players(legacy, json{{"0","Fixture"}}, 2020, legacy_meta, legacy_states,
                 legacy_stats, legacy_population);
    check(legacy_stats.size()==1, "legacy fixture must still load");
    if (!legacy_stats.empty()) {
        check(legacy_stats[0].tpa == static_cast<double>(20.0f/3.0f),
              "legacy per-game division must retain float rounding");
        check(legacy_stats[0].stlp == static_cast<double>(static_cast<float>(0.123456789012345)),
              "legacy advanced stats must retain float rounding");
        check(legacy_stats[0].availability == static_cast<double>(24.0f/97.0f),
              "legacy availability must retain float rounding");
    }

    // Exercise the actual JSON producer, not a parser-only seed fixture.
    // JavaScript cannot represent either of these integers losslessly as Number.
    constexpr int64_t first_seed = 9007199254740993LL;
    constexpr int64_t last_seed = 9223372036854775807LL;
    progbox::RunResult run{};
    run.god_progs = {{"Precision Boundary",first_seed,25,50,7,0.09},
                    {"Precision Boundary",last_seed,25,50,7,0.09}};
    const std::vector<progbox::RunResult> results{run};
    const auto nonce = std::chrono::steady_clock::now().time_since_epoch().count();
    const auto directory = fs::temp_directory_path() /
        ("progbox-loader-precision-" + std::to_string(nonce));
    struct Cleanup {
        fs::path directory;
        ~Cleanup() { std::error_code error; fs::remove_all(directory,error); }
    } cleanup{directory};
    progbox::Analytics(meta,states,stats,results).export_godprogs(directory);
    std::ifstream records_file(directory / "godprogs.json");
    const json records = json::parse(records_file);
    check(records.size()==2, "god JSON producer must retain both records");
    check(records.at(0).at("run_seed") == "9007199254740993",
          "god JSON seed above 2^53 must be an exact decimal string");
    check(records.at(1).at("run_seed") == "9223372036854775807",
          "god JSON must preserve the maximum signed 64-bit seed");

    std::cout << "loader precision and god JSON: " << failures << " failed; attempts="
              << std::setprecision(17) << reconstructed_attempts << '\n';
    return failures ? 1 : 0;
}
