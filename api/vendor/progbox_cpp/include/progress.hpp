#pragma once
#include "core_types.hpp"
#include <atomic>
#include <chrono>
#include <mutex>
// ─────────────────────────────────────────────────────────────────────────────
// Lightweight progress indicator
// ─────────────────────────────────────────────────────────────────────────────
class ProgressIndicator {
public:
    explicit ProgressIndicator(int total, std::string label = "")
        : total_(total), completed_(0), last_printed_width_(0), label_(std::move(label)) {
        start_time_ = std::chrono::steady_clock::now();
    }

    void tick(int n = 1) {
        int done = completed_.fetch_add(n) + n;
        // Throttle: update roughly every 0.5-1% or at the end
        int threshold = std::max(1, total_ / 200);
        if (done % threshold < n || done >= total_) {
            display(done);
        }
    }

    void finish() {
        completed_ = total_;
        display(total_, true);
        printf("\n");
    }

private:
    void display(int done, bool final = false) {
        std::lock_guard<std::mutex> lock(mtx_);

        double progress = static_cast<double>(done) / total_;
        std::chrono::steady_clock::time_point now = std::chrono::steady_clock::now();
        double elapsed = std::chrono::duration<double>(now - start_time_).count();

        // Clear previous line
        printf("\r%*s\r", last_printed_width_, "");

        // Build bar
        constexpr int bar_width = 25;
        int filled = static_cast<int>(bar_width * progress);

        std::string bar = "[";
        for (int i = 0; i < bar_width; ++i) {
            bar += (i < filled) ? "█" : "░";
        }
        bar += "]";

        // Time info
        std::string time_info;
        if (final) {
            time_info = fmt_time(elapsed);
        } else if (progress > 0.005) {
            double eta = elapsed * (1.0 - progress) / progress;
            time_info = "ETA " + fmt_time(eta);
        } else {
            time_info = "ETA --:--";
        }

        // Format: [Label] [████░░░░] 1234/5678 (21%) ETA 0:05
        std::string line;
        if (!label_.empty()) {
            char buf[256];
            snprintf(buf, sizeof(buf), " %s %s %d/%d (%3d%%) %s",
                     label_.c_str(), bar.c_str(), done, total_,
                     static_cast<int>(progress * 100), time_info.c_str());
            line = buf;
        } else {
            char buf[256];
            snprintf(buf, sizeof(buf), " %s %d/%d (%3d%%) %s",
                     bar.c_str(), done, total_,
                     static_cast<int>(progress * 100), time_info.c_str());
            line = buf;
        }

        printf("%s", line.c_str());
        fflush(stdout);
        last_printed_width_ = static_cast<int>(line.size());
    }

    static std::string fmt_time(double seconds) {
        if (seconds < 0) return "--:--";
        int t = static_cast<int>(seconds);
        if (t >= 3600) {
            return std::to_string(t / 3600) + ":" +
                   pad2((t % 3600) / 60) + ":" + pad2(t % 60);
        }
        return std::to_string(t / 60) + ":" + pad2(t % 60);
    }

    static std::string pad2(int n) {
        char buf[8];
        snprintf(buf, sizeof(buf), "%02d", n);
        return buf;
    }

    int total_;
    std::atomic<int> completed_;
    std::chrono::steady_clock::time_point start_time_;
    std::mutex mtx_;
    int last_printed_width_;
    std::string label_;
};