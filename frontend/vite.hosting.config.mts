import { defineConfig } from 'vite'

/**
 * Serves an already built frontend (vite build --outDir ...) on loopback and
 * forwards /api to the local Backend, so the web app and the API share one
 * origin. scripts/start_backend_ngrok.sh start --host-frontend puts ngrok in
 * front of this server, which makes one public URL for everything.
 *
 * Only /api is forwarded. Health, docs and OpenAPI paths are never exposed
 * through this server. Any Host header other than loopback and the ngrok host
 * is rejected by Vite's allowedHosts check.
 */
const webPort = Number(process.env.LOCAL_HOSTING_WEB_PORT || '4173');
const backendPort = Number(process.env.LOCAL_HOSTING_BACKEND_PORT || '8000');
const publicHost = (process.env.LOCAL_HOSTING_PUBLIC_HOST || '').trim();

export default defineConfig({
  preview: {
    host: '127.0.0.1',
    port: webPort,
    strictPort: true,
    allowedHosts: publicHost ? [publicHost, '127.0.0.1', 'localhost'] : ['127.0.0.1', 'localhost'],
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${backendPort}`,
        changeOrigin: true,
      },
    },
  },
});
