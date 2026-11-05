/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the build works on GitHub Pages under /<repo>/ and when opened locally.
export default defineConfig({
  base: './',
  plugins: [react()],
  // The bundled word lists make the main chunk large; that is expected.
  build: { chunkSizeWarningLimit: 1200 },
  test: {
    environment: 'node',
  },
});
