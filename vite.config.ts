import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendUrl = env.VITE_DEFAULT_SERVER_URL || 'http://localhost:3000'

  return {
    plugins: [react(), tailwindcss(), viteSingleFile()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      // The dev stand-in for the production reverse proxy. The UI only ever
      // issues same-origin requests, so these two entries are what make
      // `npm run dev` work at all — there is no URL to type any more.
      proxy: {
        // Everything the API serves, WebSocket included. The prefix is stripped
        // because a default gowa mounts its routes at the root; a backend run
        // with APP_BASE_PATH=/api wants this rewrite removed.
        '/api': {
          target: backendUrl,
          changeOrigin: true,
          ws: true,
          rewrite: (p) => p.replace(/^\/api/, ''),
        },
        // /health is registered at the server root, outside APP_BASE_PATH, so
        // it is forwarded as-is. Without this entry the boot probe would be
        // answered by Vite's own SPA fallback.
        '/health': {
          target: backendUrl,
          changeOrigin: true,
        },
      },
    },
  }
})
