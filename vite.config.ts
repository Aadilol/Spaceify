import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { privateHistory } from './dev/private-history.ts'

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    privateHistory(),
    ...(mode === 'github-pages' ? [{
      name: 'pages-security-policy',
      transformIndexHtml: {
        order: 'pre' as const,
        handler: () => [{
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: [
              "default-src 'none'",
              "base-uri 'none'",
              "form-action 'none'",
              "script-src 'self'",
              "style-src 'self' 'unsafe-inline'",
              "worker-src 'self' blob:",
              "connect-src 'self'",
              "img-src 'self' data: https://i.scdn.co https://coverartarchive.org https://archive.org https://*.archive.org https://upload.wikimedia.org https://thumb.wikimedia.org",
              'frame-src https://open.spotify.com',
            ].join('; '),
          },
          injectTo: 'head-prepend' as const,
        }],
      },
    }] : []),
  ],
  base: './',
  envPrefix: [],
  publicDir: mode === 'github-pages' ? false : undefined,
  server: {
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.owner-review/**'] },
    watch: { ignored: ['**/.owner-review/**'] },
  },
}))
