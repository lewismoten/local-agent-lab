import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_PAGES === 'true' ? '/rivers-of-memory/' : '/',
  resolve: { dedupe: ['three'] },
  optimizeDeps: { include: [
    'three',
    'three/addons/controls/OrbitControls.js',
    'three/addons/exporters/GLTFExporter.js',
    'three/addons/loaders/PLYLoader.js',
  ] },
  server: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } },
  preview: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } },
});
