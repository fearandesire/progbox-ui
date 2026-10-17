import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

const apiProxy = {
  "/api": {
    target: "http://127.0.0.1:8000",
    changeOrigin: true,
  },
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: { proxy: apiProxy },
  // The container serves the built app with `vite preview`; same /api route.
  preview: { proxy: apiProxy },
});
