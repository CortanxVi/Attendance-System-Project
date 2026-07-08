import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

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
      },
    }),
  ],
  optimizeDeps: {
    exclude: ['@mediapipe/face_mesh', '@mediapipe/camera_utils']
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})