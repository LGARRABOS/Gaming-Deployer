import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// Vite config: build frontend into backend/web/dist so Go can embed it.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../backend/web/dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:5298",
    },
  },
});

