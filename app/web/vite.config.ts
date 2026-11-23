import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// En desarrollo (npm run dev) el proxy lleva /api al panel que corre en Docker (puerto 8080).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": { target: "http://127.0.0.1:8080", changeOrigin: true } } },
  build: { outDir: "dist", sourcemap: false },
});
