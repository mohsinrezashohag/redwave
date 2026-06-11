/**
 * Vitest config — fast unit tests. The DEFAULT env is `node` (framework-free logic like the session refresh
 * classifier stubs `fetch`/`localStorage` itself). Component/hook render tests (`*.test.tsx`) opt into jsdom
 * per-file with a `// @vitest-environment jsdom` docblock, so node tests stay node. Kept separate from
 * vite.config.ts so the svgr/react plugins aren't loaded for tests.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
