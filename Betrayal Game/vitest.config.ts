import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The server suite runs in Node. The client package owns its own
    // vitest config (jsdom + React Testing Library), so explicitly
    // exclude it here — otherwise Vitest's default glob picks up the
    // client tests and runs them in Node, which fails on `window`,
    // `document`, JSX, etc.
    include: ['src/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    exclude: ['node_modules', 'dist', 'client', 'client/**'],
  },
});
