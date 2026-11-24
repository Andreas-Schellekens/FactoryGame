// Vite: the dev server forwards /api to the local API (npm run dev:api), the way the web
// service's Caddy forwards it to the api service on Railway, so the game talks to one site.
import { defineConfig } from 'vite';

export default defineConfig({
    server: {
        proxy: {
            '/api': { target: process.env.SELENE_API ?? 'http://127.0.0.1:8787', changeOrigin: false },
        },
    },
});
