import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    watch: {
      // Uploads and the local index are runtime data, not source files.
      ignored: ['**/.data/**', '**/.tmp-test/**']
    }
  },
  resolve: {
    tsconfigPaths: true
  },
  plugins: [
    tanstackStart({
      srcDirectory: 'src',
      // Web Libris is a client-rendered application: the readers, the theme
      // bootstrap and the auth token all live in the browser. SPA mode keeps
      // that model while still giving us file-based routing, type-safe
      // navigation and real server routes for the API on the same origin.
      spa: {
        enabled: true
      }
    }),
    // React's plugin must come after Start's.
    viteReact(),
    nitro()
  ],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000
  }
});
