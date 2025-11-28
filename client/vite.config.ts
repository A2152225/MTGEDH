import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  server: {
    port: 3000,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true
      },
      '/api': {
        target: 'http://localhost:3001'
      }
    },
    fs: {
      // allow importing shared workspace
      allow: [resolve(__dirname, '..')]
    }
  },
  build: {
    // Increase chunk size warning limit to 600KB
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Manual chunk splitting to improve bundle size
        manualChunks: {
          // Split React into its own chunk
          'react-vendor': ['react', 'react-dom'],
          // Split socket.io client
          'socket-vendor': ['socket.io-client'],
        },
      },
    },
  },
});