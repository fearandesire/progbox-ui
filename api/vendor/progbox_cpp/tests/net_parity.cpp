#include <cmath>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include "json.hpp"
#include "v321_progression.hpp"
#include "v43_progression.hpp"

using json = nlohmann::json;
using namespace progbox;

struct ControlledDraws {
    std::vector<double> values;
    double fallback;
    size_t count = 0;
    double unit() {
        const auto i = count++;
        const double value = i < values.size() ? values[i] : fallback;
        if (value < 0 || value >= 1) throw std::runtime_error("draw outside [0,1)");
        return value;
    }
    int integer(int min, int max) {
        return static_cast<int>(std::floor(unit() * (max - min + 1) + min));
    }
};

PlayerStats read_stats(const json& value) {
    PlayerStats s{};
#define FIELD(key) s.key = value.value(#key, 0.0)
    FIELD(per); FIELD(gp); FIELD(min); FIELD(availability);
    FIELD(obpm); FIELD(dbpm); FIELD(stlp); FIELD(blkp); FIELD(usgp);
    FIELD(astp); FIELD(trbp); FIELD(orbp); FIELD(ortg); FIELD(fga);
    FIELD(fta); FIELD(tpa); FIELD(tp); FIELD(ft); FIELD(fgaAtRim);
    FIELD(fgAtRim); FIELD(fgaLowPost); FIELD(fgLowPost); FIELD(fgaMidRange);
    FIELD(fgMidRange); FIELD(orb); FIELD(tov);
#undef FIELD
    return s;
}

int main(int argc, char** argv) {
    try {
        if (argc != 2) throw std::runtime_error("expected parity fixture path");
        std::ifstream input(argv[1]);
        const json fixtures = json::parse(input);
        int failures = 0;
        for (const auto& c : fixtures.at("cases")) {
            const std::string name = c.at("name");
            PlayerState player{};
            player.age = c.at("age");
            player.attrs = c.at("attrs").get<std::array<double, 15>>();
            player.baseline_ovr = calcovr_from_array(player.attrs);
            ControlledDraws draws{c.at("draws").get<std::vector<double>>(), c.at("drawFallback")};
            const auto stats = read_stats(c.at("stats"));
            ProgressionResult result;
            if (c.at("version") == "v43") {
                V43Progression strategy;
                std::vector<PlayerStats> pool;
                for (const auto& s : c.at("pool")) pool.push_back(read_stats(s));
                strategy.prepare(pool);
                result = strategy.progress_player_with_draws(player, stats, draws, 4294967301LL);
            } else {
                V321Progression strategy;
                result = strategy.progress_player_with_draws(player, stats, draws, 4294967301LL);
            }
            const auto& expected = c.at("expected");
            bool ok = true;
            for (size_t i = 0; i < 15; ++i) {
                if (result.final_state.attrs[i] != expected.at("attrs").at(i).get<double>()) {
                    std::cerr << name << ": " << ALL_ATTRS[i] << " expected " << expected.at("attrs").at(i)
                              << " got " << result.final_state.attrs[i] << '\n';
                    ok = false;
                    break;
                }
            }
            if (result.final_ovr != expected.at("ovr") || result.final_ovr != calcovr_from_array(result.final_state.attrs)) {
                std::cerr << name << ": OVR expected " << expected.at("ovr") << " got " << result.final_ovr << '\n';
                ok = false;
            }
            const json god_bonus = result.god_prog ? json(result.god_prog->bonus) : json(nullptr);
            if (god_bonus != expected.at("godBonus")) {
                std::cerr << name << ": god bonus expected " << expected.at("godBonus") << " got " << god_bonus << '\n';
                ok = false;
            }
            if (draws.count != expected.at("drawCount")) {
                std::cerr << name << ": draw count expected " << expected.at("drawCount") << " got " << draws.count << '\n';
                ok = false;
            }
            if (result.god_prog && result.god_prog->run_seed != 4294967301LL) {
                std::cerr << name << ": god record truncated run seed\n";
                ok = false;
            }
            if (!ok) ++failures;
        }
        std::cout << fixtures.at("cases").size() << " real-header parity cases; " << failures << " failed\n";
        return failures ? 1 : 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
