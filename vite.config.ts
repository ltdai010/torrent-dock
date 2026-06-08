import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ["RQBIT_", "VITE_", "TAURI_"]);
  const rqbitTarget = env.RQBIT_PROXY_TARGET || "http://127.0.0.1:3030";

  return {
    plugins: [react()],
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      proxy: {
        "/rqbit": {
          target: rqbitTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rqbit/, "")
        }
      }
    },
    envPrefix: ["VITE_", "TAURI_"],
    build: {
      target: "es2020",
      minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
      sourcemap: Boolean(process.env.TAURI_DEBUG)
    }
  };
});
