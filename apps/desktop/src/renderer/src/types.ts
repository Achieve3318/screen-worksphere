import type { ScreenVaultApi } from '../../preload/index'

declare global {
  interface Window {
    screenvault: ScreenVaultApi
  }
}

export {}
