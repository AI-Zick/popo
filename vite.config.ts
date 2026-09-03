import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  build: {
    rollupOptions: {
      output: {
        /*
          React and the icon set change when a dependency is upgraded — a few
          times a year. The app changes daily. Keeping them in their own chunks
          means a normal deploy invalidates the app bundle and nothing else, so
          a department opening this every morning re-downloads what actually
          changed rather than all of it.
        */
        manualChunks: {
          react: ['react', 'react-dom', 'react-dom/client'],
          icons: ['lucide-react'],
        },
      },
    },
  },
  server: {
    // The API runs separately; same-origin in dev so the session cookie works.
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: false } },
  },
});
