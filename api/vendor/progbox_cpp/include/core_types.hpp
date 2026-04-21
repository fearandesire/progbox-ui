/// @file core_types.hpp
/// @brief Defines the core data structures used throughout the codebase.
/// @author @akshayexists

#pragma once
#include <array>
#include <cstdint>
#include <string>
#include <optional>
#include <vector>

namespace progbox {

constexpr std::array<const char*, 15> ALL_ATTRS = {
    "dIQ", "Dnk", "Drb", "End", "2Pt", "FT", "Ins",
    "Jmp", "oIQ", "Pss", "Reb", "Spd", "Str", "3Pt", "Hgt"
};

struct PlayerState {
    double age;
    double per;
    double dws;
    double ewa;
    std::array<double, 15> attrs;
    double baseline_ovr;
};

struct PlayerMeta {
    std::string name;
    std::string team;
};

struct GodProgRecord {
    std::string name;
    int64_t run_seed;          // was int, now int64_t to match Python's 2**63 range
    int age;
    int ovr;
    int bonus;
    double chance;
};

struct RunResult {
    int64_t run_seed;                               
    std::vector<double> final_ovrs;
    std::vector<std::array<double, 15>> progressed_attrs;
    std::vector<GodProgRecord> god_progs;
};

} // namespace progbox