import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

/*
  The published demo is one HTML file with everything inside it, because that
  is what an artifact host can serve — no second request is possible, so no
  chunk may be separate. Chunking is a production concern anyway: the demo is
  opened once by somebody being shown it, not every morning by a department.
*/
const DEMO = process.env.VITE_DEMO === '1';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  /*
    The build an agency is running, baked in so feedback can say which one it
    came from. A vendor re-diagnosing a fault that was fixed two releases ago is
    the most avoidable waste in support.
  */
  define: {
    __APP_VERSION__: JSON.stringify(`${pkg.version}+${new Date().toISOString().slice(0, 10)}`),
  },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  build: {
    // Inlined into the single file below, so a separate map would be a dead
    // link and a copy of the source nobody asked to publish.
    sourcemap: false,
    assetsInlineLimit: DEMO ? 100_000_000 : 4096,
    cssCodeSplit: !DEMO,
    rollupOptions: {
      output: {
        /*
          React and the icon set change when a dependency is upgraded — a few
          times a year. The app changes daily. Keeping them in their own chunks
          means a normal deploy invalidates the app bundle and nothing else, so
          a department opening this every morning re-downloads what actually
          changed rather than all of it.
        */
        ...(DEMO
          ? { inlineDynamicImports: true, manualChunks: undefined }
          : {
              manualChunks: {
                react: ['react', 'react-dom', 'react-dom/client'],
                icons: ['lucide-react'],
              },
            }),
      },
    },
  },
  server: {
    // The API runs separately; same-origin in dev so the session cookie works.
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: false } },
  },
});
