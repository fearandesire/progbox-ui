

#pragma once
#include "core_types.hpp"
#include <cmath>
#include <algorithm>

namespace progbox {

constexpr std::array<const char*, 15> OVR_CALC_ORDER = {
    "Hgt", "Str", "Spd", "Jmp", "End", "Ins",
    "Dnk", "FT",  "3Pt", "oIQ", "dIQ", "Drb",
    "Pss", "2Pt", "Reb"
};

constexpr std::array<double, 15> OVR_COEFFS = {
    0.159, 0.0777, 0.123, 0.051, 0.0632, 0.0126,
    0.0286, 0.0202, 0.0726, 0.133, 0.159, 0.059,
    0.062,  0.01,   0.01
};

constexpr std::array<double, 15> OVR_CENTERS = {
    47.5, 50.2, 50.8, 48.7, 39.9, 42.4,
    49.5, 47.0, 47.1, 46.8, 46.7, 54.8,
    51.3, 47.0, 51.4
};

constexpr std::array<size_t, 15> OVR_INDICES = []() {
    std::array<size_t, 15> indices{};
    for (size_t i = 0; i < OVR_CALC_ORDER.size(); ++i) {
        for (size_t j = 0; j < ALL_ATTRS.size(); ++j) {
            if (std::string_view(OVR_CALC_ORDER[i]) == std::string_view(ALL_ATTRS[j])) {
                indices[i] = j; break;
            }
        }
    }
    return indices;
}();

inline int _fudge_ovr(double s) {
    double fudge;
    if (s >= 68.0) fudge = 8.0;
    else if (s >= 50.0) fudge = 4.0 + (s - 50.0) * (4.0 / 18.0);
    else if (s >= 42.0) fudge = -5.0 + (s - 42.0) * (9.0 / 8.0);
    else if (s >= 31.0) fudge = -5.0 - (42.0 - s) * (5.0 / 11.0);
    else fudge = -10.0;
    return static_cast<int>(std::round(std::max(0.0, std::min(100.0, s + fudge))));
}

inline int calcovr_from_array(const std::array<double, 15>& attrs) {
    double dot = 0.0;
    for (size_t i = 0; i < 15; ++i) {
        dot += (attrs[OVR_INDICES[i]] - OVR_CENTERS[i]) * OVR_COEFFS[i];
    }
    return _fudge_ovr(dot + 48.5);
}

} // namespace progbox