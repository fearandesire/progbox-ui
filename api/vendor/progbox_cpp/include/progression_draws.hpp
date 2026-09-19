#pragma once
#include <random>

namespace progbox {
// Production draws stay local to each run; tests may supply the same two methods
// with a recorded uniform stream without assuming JS/C++ seed equivalence.
struct ProgressionDraws {
    std::mt19937& rng;
    double unit() { return std::uniform_real_distribution<double>(0.0, 1.0)(rng); }
    int integer(int min, int max) {
        return std::uniform_int_distribution<int>(min, max)(rng);
    }
};
} // namespace progbox
