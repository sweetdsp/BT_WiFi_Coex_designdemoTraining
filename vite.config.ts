/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' lets the static build work from a GitHub Pages sub-path.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        // Libraries and the engine's data files go in their own chunks, so the app code itself stays small and the browser can cache them.
        codeSplitting: { groups: [{ name: 'vendor', test: /node_modules[\\/](react|react-dom|scheduler|d3-[a-z]+|internmap)[\\/]/ }, { name: 'data', test: /src[\\/]data[\\/]/ }] },
      },
    },
  },
  test: { environment: 'node', include: ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'] },
});
