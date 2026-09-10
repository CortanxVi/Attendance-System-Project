import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'node:fs'

const mobileHttpsEnabled = process.env.DEV_MOBILE_HTTPS === '1'
const backendPort = process.env.DEV_BACKEND_PORT || '8000'
const mobileHttps = mobileHttpsEnabled
  ? {
      cert: readFileSync(process.env.DEV_HTTPS_CERT || ''),
      key: readFileSync(process.env.DEV_HTTPS_KEY || ''),
    }
  : undefined

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // 🌟 ทำให้เว็บแอปนี้ติดตั้งเป็น PWA ได้จริง (ตาม requirement 4.1.1)
    // - สร้างไฟล์ manifest ให้ Android/iOS เพิ่มไอคอนไปหน้า Home ได้
    // - สร้าง Service Worker (ผ่าน Workbox) ให้เปิดแอปซ้ำได้เร็วขึ้นและมี fallback แบบพื้นฐานตอนเน็ตหลุด
    VitePWA({
      registerType: 'autoUpdate', // อัปเดตเวอร์ชันใหม่ให้อัตโนมัติ ไม่ต้องรอผู้ใช้กดยืนยัน
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
        // ⚠️ ตั้งใจไม่ทำ runtime caching ให้ path /api/** เด็ดขาด
        // เพราะข้อมูลเช็คชื่อ/สถานะห้องเรียนต้องเป็นข้อมูลล่าสุดเสมอ ห้ามใช้ค่าที่แคชไว้เก่า
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
