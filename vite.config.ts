/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

/**
 * Production Content-Security-Policy. `connect-src 'self'` means the browser itself
 * refuses any request to another origin — pasted content cannot be sent anywhere.
 * Inline styles are allowed because Monaco and Radix position elements with them.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "manifest-src 'self'",
].join('; ')

function contentSecurityPolicy(): Plugin {
  return {
    name: 'devtoolkit-csp',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
  }
}

export default defineConfig({
  plugins: [
    contentSecurityPolicy(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'robots.txt', 'apple-touch-icon.png', 'theme-init.js'],
      manifest: {
        name: 'DevToolkit',
        short_name: 'DevToolkit',
        description: 'Every developer utility. One workspace. Runs entirely in your browser.',
        theme_color: '#141517',
        background_color: '#141517',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache every chunk so that every tool works offline after installation.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,ttf,json,webmanifest}'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': r('./src'),
      'monaco-esm': r('./node_modules/monaco-editor/esm/vs'),
    },
  },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4096,
    sourcemap: false,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Several suites include large-input tests; allow headroom when files run in parallel.
    testTimeout: 20_000,
    benchmark: { include: ['src/**/*.bench.ts'] },
  },
})
