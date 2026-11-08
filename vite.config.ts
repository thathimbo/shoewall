import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// GitHub Pages serves a project site from /<repo>/, so the deploy workflow
// passes that prefix in as BASE_PATH. Locally it is unset and everything is
// served from the root. src/lib/opencv.ts reads import.meta.env.BASE_URL to
// find the OpenCV build, so it follows this automatically.
const base = process.env.BASE_PATH || '/';

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [react()],
});
