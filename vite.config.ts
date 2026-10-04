import {runtimeArchives} from './scripts/runtime-archives';
import {defineConfig} from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  base: process.env.APP_BASE_PATH ?? '/',
  plugins: [runtimeArchives(), react()],
  server: {host: '127.0.0.1', port: 4173, strictPort: true},
  preview: {host: '127.0.0.1', port: 4173, strictPort: true},
  build: {license: {fileName: 'licenses/npm-bundle.json'}, manifest: true},
  test: {
    server: {deps: {inline: [/@sqlrooms\//]}},
    include: ['tests/unit/**/*.test.ts', 'tests/baseline/**/*.test.ts', 'scripts/*.test.mjs'],
  },
});
