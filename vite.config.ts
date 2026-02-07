import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 5173,
        host: 'localhost',
        https: true,
      },
      plugins: [
        basicSsl(),
        react(),
        VitePWA({
          registerType: 'autoUpdate',
          includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'mask-icon.svg'],
          manifest: {
            name: 'CookAI Assistant',
            short_name: 'First Dish',
            description: 'AI-powered cooking assistant for recipes, meal planning, and kitchen help',
            theme_color: '#059669',
            background_color: '#faf8f5',
            display: 'standalone',
            start_url: '/',
            icons: [
              { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
              { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
              { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            ],
          },
          workbox: {
            globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
            runtimeCaching: [
              {
                urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
                handler: 'CacheFirst',
                options: { cacheName: 'google-fonts-cache', expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 } },
              },
              {
                urlPattern: /^https:\/\/cdn\.tailwindcss\.com\/.*/i,
                handler: 'CacheFirst',
                options: { cacheName: 'tailwind-cdn-cache', expiration: { maxEntries: 1, maxAgeSeconds: 60 * 60 * 24 * 365 } },
              },
            ],
          },
        }),
      ],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
