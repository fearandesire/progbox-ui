import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.engine.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.engine.test.ts",
        "src/server.ts",
        "src/types.ts",
      ],
      thresholds: {
        lines: 65,
        functions: 65,
        // Vitest 4 + @vitest/coverage-v8 report more branch points than Vitest 3 (~550 vs ~429).
        branches: 57,
        statements: 65,
      },
    },
  },
});
