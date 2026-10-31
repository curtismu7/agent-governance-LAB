import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: the API runs on PORT (default 7300, npm start) and Vite on VITE_PORT (default 7301). /api is proxied, so the browser only ever
// talks to one origin (same-origin writes). Ports stay inside 7300-7349.
const api = { target: `http://127.0.0.1:${Number(process.env.PORT) || 7300}` };

export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: Number(process.env.VITE_PORT) || 7301, strictPort: true, proxy: { "/api": api } },
  test: { environment: "jsdom", globals: true, setupFiles: "./src/testSetup.js", testTimeout: 30000 },
});
