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
    // Increase chunk size warning limit to 700KB to accommodate main bundle after splitting
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Manual chunk splitting to improve bundle size
        manualChunks(id) {
          // Split React and React-DOM into vendor chunk
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'react-vendor';
          }
          
          // Split socket.io client into its own chunk
          if (id.includes('node_modules/socket.io-client')) {
            return 'socket-vendor';
          }
          
          // Split modal components into their own chunk
          // These are conditionally rendered based on game state
          if (id.includes('/components/') && id.includes('Modal')) {
            return 'modals';
          }
          
          // Split utility modules into their own chunk
          if (id.includes('/utils/')) {
            return 'utils';
          }
          
          // Split shared workspace code
          if (id.includes('/shared/')) {
            return 'shared';
          }
        },
      },
    },
  },
});