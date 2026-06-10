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
        },
        "/source-proxy/1337x": {
          target: "https://1337x.to",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/source-proxy\/1337x/, "")
        },
        "/source-proxy/1377x": {
          target: "https://www.1377x.to",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/source-proxy\/1377x/, "")
        },
        "/source-proxy/apibay": {
          target: "https://apibay.org",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/source-proxy\/apibay/, "")
        },
        "/source-proxy/imdb-suggest": {
          target: "https://v3.sg.media-imdb.com",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/source-proxy\/imdb-suggest/, "")
        },
        "/source-proxy/subsource-api": {
          target: "https://api.subsource.net",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/source-proxy\/subsource-api/, "")
        },
        "/source-proxy/opensubtitles-org": {
          target: "https://api.opensubtitles.org",
          changeOrigin: true,
          headers: {
            "User-Agent": "Popcorn Time v1"
          },
          rewrite: (path) => path.replace(/^\/source-proxy\/opensubtitles-org/, "/xml-rpc")
        },
        "/source-proxy/opensubtitles-download": {
          target: "https://dl.opensubtitles.org",
          changeOrigin: true,
          headers: {
            "User-Agent": "Popcorn Time v1"
          },
          rewrite: (path) => path.replace(/^\/source-proxy\/opensubtitles-download/, "")
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
