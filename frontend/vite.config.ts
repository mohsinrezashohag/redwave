import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';

// The short commit the bundle was built from — shown in the footer so a running deploy is verifiable at a
// glance (ends "am I on the latest build?" ambiguity). Prefer the deploy platform's env, else local git.
function resolveBuildSha(): string {
  const env =
    process.env.VERCEL_GIT_COMMIT_SHA || process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT_SHA;
  if (env) return env.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'dev';
  }
}
const BUILD_SHA = resolveBuildSha();

// Frontend dev server config. The `/v1`, `/api`, and `/health` proxies forward to the NestJS
// backend (default :3000) so the SPA can call the API in development without CORS friction.
// The typed client (openapi-fetch) targets `/v1` (all backend routes live under /v1).
export default defineConfig({
  // `svgr` lets us import an SVG as a React component (`import X from './x.svg?react'`) so it can be
  // inlined, sized, and themed via tokens (currentColor ink + var(--brand-orange) — see components/ui/Logo).
  // svgo is OFF so our currentColor / var() fills + viewBox survive verbatim.
  plugins: [svgr({ svgrOptions: { svgo: false } }), react()],
  define: { __BUILD_SHA__: JSON.stringify(BUILD_SHA) },
  server: {
    port: 5173,
    proxy: {
      '/v1': { target: 'http://localhost:3000', changeOrigin: true },
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/health': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
});
