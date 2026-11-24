import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { isTrustedApiUrl } from '../../packages/shared/src/backoff.ts'

const shared = resolve(__dirname, '../../packages/shared/src/index.ts')
const types = resolve(__dirname, '../../packages/types/src/index.ts')

function productionApiUrl(): string {
  const fromEnv = process.env.SCREENVAULT_API_URL?.trim()
  if (fromEnv) return fromEnv
  const file = resolve(__dirname, '.env.production')
  if (!existsSync(file)) return ''
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = /^SCREENVAULT_API_URL=(.*)$/.exec(trimmed)
    if (!match) continue
    return match[1].trim().replace(/^['"]|['"]$/g, '')
  }
  return ''
}

export default defineConfig(({ command }) => {
  const apiUrl = command === 'build' ? productionApiUrl() : ''
  if (command === 'build' && apiUrl && !isTrustedApiUrl(apiUrl)) {
    throw new Error(
      'SCREENVAULT_API_URL must be https:// for a public server. http:// is allowed for localhost and private network addresses.',
    )
  }
  return {
    main: {
      define: {
        'process.env.SCREENVAULT_API_URL': JSON.stringify(command === 'build' ? apiUrl : ''),
      },
      plugins: [externalizeDepsPlugin({ exclude: ['@screenvault/shared', '@screenvault/types'] })],
      resolve: { alias: { '@screenvault/shared': shared, '@screenvault/types': types } },
    },
    preload: {
      plugins: [externalizeDepsPlugin({ exclude: ['@screenvault/shared'] })],
      resolve: { alias: { '@screenvault/shared': shared } },
    },
    renderer: {
      server: { host: '127.0.0.1' },
      optimizeDeps: { include: ['ckeditor5'] },
      resolve: {
        alias: {
          '@screenvault/shared/brand': resolve(__dirname, '../../packages/shared/src/brand.ts'),
        },
      },
      plugins: [react(), tailwindcss()],
    },
  }
})
