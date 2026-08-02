import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// BASE_PATH is set by the GitHub Pages deploy workflow (e.g. "/health-tracker/").
// Locally it defaults to "/".
const base = process.env.BASE_PATH || '/'

export default defineConfig({
  base,
  // Pre-bundling pdfjs-dist breaks its module worker handshake in dev
  // (silent hang). Serve it as native ESM instead.
  optimizeDeps: { exclude: ['pdfjs-dist'] },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // Health data lives in IndexedDB; the app shell is fully precached for offline use.
        navigateFallback: 'index.html',
      },
      manifest: {
        name: 'Health Tracker',
        short_name: 'Health',
        description: 'Personal health tracker: BMI, workouts, checkup reports and AI guidance.',
        theme_color: '#0d9488',
        background_color: '#f8fafc',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
