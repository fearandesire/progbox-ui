/// @file sim_engine.hpp
/// @brief Parallel simulation engine for Monte Carlo player progressions.

#pragma once
#include "core_types.hpp"
#include "i_progression.hpp"
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <deque>
#include <functional>
#include <limits>
#include <future>
#include <mutex>
#include <thread>
#include <cstdio>
#include <string>
#include "progress.hpp"

namespace progbox {

class SimEngine {
private:
    const IProgressionStrategy& strategy_;
    size_t num_workers_;

    /// @brief A lightweight, fixed-size thread pool for parallel task execution.
    class thread_pool {
    public:
        /// @brief Spawns worker threads that continuously pull tasks from a queue.
        /// @param threads The number of concurrent worker threads to create.
        explicit thread_pool(size_t threads) : stop(false) {
            for (size_t i = 0; i < threads; ++i) {
                workers.emplace_back([this] {
                    for (;;) {
                        std::function<void()> task;
                        {
                            std::unique_lock<std::mutex> lock(queue_mutex);
                            condition.wait(lock,
                                [this] { return stop || !tasks.empty(); });
                            if (stop && tasks.empty()) return;
                            task = std::move(tasks.front());
                            tasks.pop_front();
                        }
                        task();
                    }
                });
            }
        }

        /// @brief Enqueues a callable task and returns a future for its result.
        /// @tparam F Callable type.
        /// @tparam Args Argument types for the callable.
        /// @param f The callable to execute.
        /// @param args Arguments to forward to the callable.
        /// @return A std::future holding the return value of the callable.
        template<class F, class... Args>
        auto enqueue(F&& f, Args&&... args)
            -> std::future<std::invoke_result_t<F, Args...>>
        {
            using return_type = std::invoke_result_t<F, Args...>;
            auto task = std::make_shared<std::packaged_task<return_type()>>(
                std::bind(std::forward<F>(f), std::forward<Args>(args)...)
            );
            std::future<return_type> res = task->get_future();
            {
                std::unique_lock<std::mutex> lock(queue_mutex);
                if (stop) throw std::runtime_error("enqueue on stopped ThreadPool");
                tasks.emplace_back([task]() { (*task)(); });
            }
            condition.notify_one();
            return res;
        }

        /// @brief Signals all workers to stop and joins their threads.
        ~thread_pool() {
            {
                std::unique_lock<std::mutex> lock(queue_mutex);
                stop = true;
            }
            condition.notify_all();
            for (std::thread& worker : workers) {
                worker.join();
            }
        }

    private:
        std::vector<std::thread> workers;
        std::deque<std::function<void()>> tasks;
        std::mutex queue_mutex;
        std::condition_variable condition;
        bool stop;
    };

public:
    /// @brief Constructs the simulation engine.
    /// @param strategy The progression strategy to apply to each player.
    /// @param workers The number of threads to use (defaults to hardware concurrency).
    SimEngine(const IProgressionStrategy& strategy,
              size_t workers = std::thread::hardware_concurrency())
        : strategy_(strategy), num_workers_(workers > 0 ? workers : 1) {}

    /// @brief Executes multiple simulation runs in parallel and collects results.
    /// @param meta Vector of player metadata (names, teams).
    /// @param base_states Vector of initial player states to progress.
    /// @param runs The total number of Monte Carlo simulations to execute.
    /// @param seed The master seed for reproducible RNG generation.
    /// @return A vector of RunResult containing the outcomes of every simulation.
    std::vector<RunResult> run(
        const std::vector<PlayerMeta>& meta,
        const std::vector<PlayerState>& base_states,
        int runs,
        int seed = 69
    ) {
        std::mt19937 master_rng(seed);
        std::uniform_int_distribution<int64_t> seed_dist(0, std::numeric_limits<int64_t>::max());

        std::vector<int64_t> run_seeds(runs);
        for (int i = 0; i < runs; ++i) {
            run_seeds[i] = seed_dist(master_rng);
        }

        thread_pool pool(num_workers_);
        ProgressIndicator progress(runs, "simulations");
        
        std::vector<std::future<RunResult>> futures;
        futures.reserve(runs);

        size_t n_players = base_states.size();

        for (int r = 0; r < runs; ++r) {
            futures.emplace_back(pool.enqueue(
                [this, &progress, s = run_seeds[r], &base_states, &meta, n_players]()
            {
                RunResult result;
                result.run_seed = s;
                result.final_ovrs.reserve(n_players);
                result.progressed_attrs.reserve(n_players);

                std::mt19937 run_rng(static_cast<std::mt19937::result_type>(s));

                for (size_t p = 0; p < n_players; ++p) {
                    ProgressionResult res =
                        strategy_.progress_player(base_states[p], run_rng, s);

                    result.final_ovrs.push_back(static_cast<double>(res.final_ovr));
                    result.progressed_attrs.push_back(res.final_state.attrs);

                    if (res.god_prog) {
                        GodProgRecord record = *res.god_prog;
                        record.name = meta[p].name;
                        result.god_progs.push_back(std::move(record));
                    }
                }
                
                progress.tick();
                return result;
            }));
        }

        std::vector<RunResult> all_results(runs);
        for (int r = 0; r < runs; ++r) {
            all_results[r] = futures[r].get();
        }
        
        progress.finish();
        return all_results;
    }
};

} // namespace progbox