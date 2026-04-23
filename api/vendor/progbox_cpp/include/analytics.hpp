/// @file analytics.hpp
/// @brief Post-simulation analytics and data export utilities.
/// @author @akshayexists

#pragma once
#include "core_types.hpp"
#include <filesystem>
#include <cstdio>
#include <cmath>
#include <numeric>
#include <algorithm>
#include <unordered_map>
#include "json.hpp"
#include "progress.hpp"

namespace progbox {

/// @brief Aggregates simulation results and exports them to CSV/JSON formats.
class Analytics {
    const std::vector<PlayerMeta>& meta_;
    const std::vector<PlayerState>& base_states_;
    const std::vector<RunResult>& results_;
    size_t n_players_;
    size_t n_runs_;

    /// @brief Calculates the value at a specific quantile in a dataset.
    /// @param data The dataset (note: will be partially reordered by std::nth_element).
    /// @param quantile The target quantile between 0.0 and 1.0.
    /// @return The interpolated value at the requested quantile.
    double calculate_quantile(std::vector<double>& data, double quantile) const {
        if (data.empty()) return 0.0;
        size_t index = static_cast<size_t>(std::ceil(quantile * data.size())) - 1;
        std::nth_element(data.begin(), data.begin() + index, data.end());
        return data[index];
    }

public:
    /// @brief Constructs the analytics processor.
    /// @param meta Vector of player metadata (names, teams).
    /// @param base_states Vector of initial player states before progression.
    /// @param results Vector of simulation results from SimEngine::run().
    Analytics(
        const std::vector<PlayerMeta>& meta,
        const std::vector<PlayerState>& base_states,
        const std::vector<RunResult>& results
    ) : meta_(meta), base_states_(base_states), results_(results),
        n_players_(meta.size()), n_runs_(results.size()) {}

    // ─────────────────────────────────────────────────────────────────────────
    //  Raw CSV
    // ─────────────────────────────────────────────────────────────────────────
    
    /// @brief Exports every run/player combination to a detailed CSV.
    /// @param dir Output directory where `outputs.csv` will be saved.
    void export_raw_csv(const std::filesystem::path& dir) const {
        std::filesystem::create_directories(dir);
        std::string path = (dir / "outputs.csv").string();
        FILE* f = fopen(path.c_str(), "w");
        if (!f) return;

        int total_rows = static_cast<int>(n_runs_ * n_players_);
        ProgressIndicator progress(total_rows, "Raw CSV");

        // ── Header ──
        fprintf(f, "Run,RunSeed,Name,Team,Age,PlayerID,"
                   "Baseline,Ovr,Delta,PctChange,AboveBaseline,"
                   "PER,DWS,EWA");
        for (const char* attr : ALL_ATTRS) {
            fprintf(f, ",%s", attr);
        }
        fprintf(f, "\n");

        // ── Rows ──
        for (size_t r = 0; r < n_runs_; ++r) {
            int64_t seed = results_[r].run_seed;
            for (size_t p = 0; p < n_players_; ++p) {
                double base = base_states_[p].baseline_ovr;
                double ovr  = results_[r].final_ovrs[p];
                double delta = ovr - base;
                double pct   = (base != 0.0) ? (delta / base) : 0.0;
                int age      = static_cast<int>(base_states_[p].age);

                fprintf(f, "%zu,%lld,%s,%s,%d,%zu,"
                           "%.1f,%.1f,%.1f,%.6f,%s,"
                           "%.4f,%.4f,%.4f",
                    r, static_cast<long long>(seed),
                    meta_[p].name.c_str(), meta_[p].team.c_str(), age, p,
                    base, ovr, delta, pct,
                    (ovr > base) ? "True" : "False",
                    base_states_[p].per, base_states_[p].dws, base_states_[p].ewa);

                for (size_t a = 0; a < 15; ++a) {
                    fprintf(f, ",%.1f", results_[r].progressed_attrs[p][a]);
                }
                fprintf(f, "\n");

                progress.tick();
            }
        }

        fclose(f);
        progress.finish();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Summary CSV
    // ─────────────────────────────────────────────────────────────────────────

    /// @brief Exports per-player statistical summaries (mean, std, quantiles) to CSV.
    /// @param dir Output directory where `summary.csv` will be saved.
    void export_summary_csv(const std::filesystem::path& dir) const {
        std::filesystem::create_directories(dir);
        std::string path = (dir / "summary.csv").string();
        FILE* f = fopen(path.c_str(), "w");
        if (!f) return;

        ProgressIndicator progress(static_cast<int>(n_players_), "Summary");

        fprintf(f, "Name,Team,Age,Baseline,MeanOvr,MeanDelta,StdDelta,"
                   "MinOvr,MaxOvr,Q10,Q25,Q75,Q90,PctPositive\n");

        for (size_t p = 0; p < n_players_; ++p) {
            double base = base_states_[p].baseline_ovr;
            std::vector<double> deltas;
            deltas.reserve(n_runs_);
            for (size_t r = 0; r < n_runs_; ++r) {
                deltas.push_back(results_[r].final_ovrs[p] - base);
            }

            double mean_delta = std::accumulate(deltas.begin(), deltas.end(), 0.0)
                                / static_cast<double>(n_runs_);
            double mean_ovr   = base + mean_delta;

            double sq_sum = std::inner_product(
                deltas.begin(), deltas.end(), deltas.begin(), 0.0);
            double std_delta = std::sqrt(sq_sum / n_runs_ - mean_delta * mean_delta);

            double min_delta = *std::min_element(deltas.begin(), deltas.end());
            double max_delta = *std::max_element(deltas.begin(), deltas.end());

            long count_pos = std::count_if(
                deltas.begin(), deltas.end(), [](double d){ return d > 0; });
            double pct_pos = static_cast<double>(count_pos) / n_runs_;

            double q10 = calculate_quantile(deltas, 0.10);
            double q25 = calculate_quantile(deltas, 0.25);
            double q75 = calculate_quantile(deltas, 0.75);
            double q90 = calculate_quantile(deltas, 0.90);

            int age = static_cast<int>(base_states_[p].age);

            fprintf(f, "%s,%s,%d,%.1f,%.1f,%.3f,%.3f,%.1f,%.1f,%.1f,%.1f,%.1f,%.1f,%.3f\n",
                meta_[p].name.c_str(), meta_[p].team.c_str(), age, base, mean_ovr,
                mean_delta, std_delta,
                base + min_delta, base + max_delta,
                base + q10, base + q25, base + q75, base + q90, pct_pos);

            progress.tick();
        }

        fclose(f);
        progress.finish();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  God-prog logs
    // ─────────────────────────────────────────────────────────────────────────

    /// @brief Exports rare "god-progression" events and player frequencies to JSON.
    /// @param dir Output directory for `godprogs.json` and `superlucky.json`.
    void export_godprogs(const std::filesystem::path& dir) const {
        std::filesystem::create_directories(dir);

        // Count total god-progs for progress
        size_t total_events = 0;
        for (const auto& res : results_) {
            total_events += res.god_progs.size();
        }

        nlohmann::json records = nlohmann::json::array();
        std::unordered_map<std::string, int> superlucky;

        if (total_events > 0) {
            ProgressIndicator progress(static_cast<int>(total_events), "God-progs");

            for (const auto& res : results_) {
                for (const auto& rec : res.god_progs) {
                    records.push_back({
                        {"name",     rec.name},
                        {"run_seed", rec.run_seed},
                        {"age",      rec.age},
                        {"ovr",      rec.ovr},
                        {"bonus",    rec.bonus},
                        {"chance",   rec.chance}
                    });
                    superlucky[rec.name]++;
                    progress.tick();
                }
            }

            progress.finish();
        } else {
            printf(" God-progs: no events found\n");
        }

        {
            std::ofstream out(dir / "godprogs.json");
            out << records.dump(2);
        }
        {
            nlohmann::json sl_json = superlucky;
            std::ofstream out(dir / "superlucky.json");
            out << sl_json.dump(2);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Export all (convenient wrapper)
    // ─────────────────────────────────────────────────────────────────────────

    /// @brief Convenience wrapper to execute all export functions sequentially.
    /// @param dir Output directory for all generated CSV and JSON files.
    void export_all(const std::filesystem::path& dir) const {
        printf("\n");
        export_raw_csv(dir);
        printf("\n");
        export_summary_csv(dir);
        printf("\n");
        export_godprogs(dir);
        printf("\n");
    }
};

} // namespace progbox