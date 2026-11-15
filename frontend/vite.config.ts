import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const mobileHttpsEnabled = process.env.DEV_MOBILE_HTTPS === '1'
const backendPort = process.env.DEV_BACKEND_PORT || '8080'
const mobileHttps = mobileHttpsEnabled
  ? {
      cert: readFileSync(process.env.DEV_HTTPS_CERT || ''),
      key: readFileSync(process.env.DEV_HTTPS_KEY || ''),
    }
  : undefined

function gitOutput(command: string): string {
  try {
    return execSync(command, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5_000 }).toString().trim()
  } catch {
    return ''
  }
}

// Identity of this web build (src/config/buildInfo.ts): shown in the test overlay and sent as
// numbers in test-mode client_diagnostics, so a stale cached PWA build is visible in the data.
const buildCommit = (process.env.VERCEL_GIT_COMMIT_SHA || gitOutput('git rev-parse --short=7 HEAD')).slice(0, 7)
const appBuild = {
  commit: /^[0-9a-f]{7}$/.test(buildCommit) ? buildCommit : 'unknown',
  dirty: !process.env.VERCEL_GIT_COMMIT_SHA && gitOutput('git status --porcelain --untracked-files=no').length > 0,
  builtAt: new Date().toISOString(),
}

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_BUILD__: JSON.stringify(appBuild),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate', // อัปเดตเวอร์ชันใหม่ให้อัตโนมัติ ไม่ต้องรอผู้ใช้กดยืนยัน
      // src/pwa/registerServiceWorker.ts registers the worker itself (periodic update checks and a
      // reload that waits until no scan / check-in upload is on screen).
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons.svg'],
      manifest: {
        name: 'ระบบบันทึกเวลาเข้าเรียน มจพ.',
        short_name: 'เช็คชื่อ มจพ.',
        description: 'ระบบบันทึกเวลาเข้าเรียนด้วยเทคโนโลยีการจดจำใบหน้า สถาบันเทคโนโลยีพระจอมเกล้าพระนครเหนือ',
        theme_color: '#f97316',
        background_color: '#f8fafc',
        display: 'standalone',
        start_url: '/',
        lang: 'th',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
      workbox: {
        // A new build takes over at once (also from pages of older builds) and stale precaches go.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        // Excel/PDF engines are large and only needed after an explicit export action.
        // Keeping them out of the install-time precache makes first launch faster;
        // the browser still caches them normally after their first on-demand load.
        globIgnores: ['**/xlsx-*.js', '**/pdfmake-*.js'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
          {
            // Download the local face model before QR scanning, then reuse it
            // across launches without ever caching attendance API responses.
            urlPattern: ({ url }) => (
              url.pathname.includes('/models/face_landmarker.task')
              || url.pathname.includes('/mediapipe/wasm/')
            ),
            handler: 'CacheFirst',
            options: {
              cacheName: 'face-landmarker-tasks-vision-1.0.1-64184e22',
              cacheableResponse: { statuses: [0, 200] },
              expiration: {
                maxEntries: 8,
                maxAgeSeconds: 30 * 24 * 60 * 60,
              },
            },
          },
        ],
      },
    }),
  ],
  build: {
    // pdfmake is an intentionally lazy, user-triggered export engine. Its size does
    // not affect the initial route and is kept visible in the build size report.
    chunkSizeWarningLimit: 1000,
  },
  server: {
    // The ordinary launcher stays local. start_mobile_test.sh opts in to a
    // trusted LAN HTTPS origin so iOS/Android may use camera APIs while API and
    // OCR ports remain loopback-only behind this development proxy.
    https: mobileHttps,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${backendPort}`,
        changeOrigin: true,
      },
      '/health': {
        target: `http://127.0.0.1:${backendPort}`,
        changeOrigin: true,
      },
    },
    host: mobileHttpsEnabled ? '0.0.0.0' : '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
})
