import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopState, LocalSettings } from '../core/desktopState.js'

const api = {
  getState: (): Promise<DesktopState> => ipcRenderer.invoke('state:get'),
  onState: (callback: (state: DesktopState) => void): (() => void) => {
    const listener = (_event: unknown, state: DesktopState) => callback(state)
    ipcRenderer.on('state:updated', listener)
    return () => ipcRenderer.removeListener('state:updated', listener)
  },
  onSettings: (callback: () => void): (() => void) => {
    const listener = () => callback()
    ipcRenderer.on('settings:open', listener)
    return () => ipcRenderer.removeListener('settings:open', listener)
  },
  onError: (callback: (message: string) => void): (() => void) => {
    const listener = (_event: unknown, message: string) => callback(message)
    ipcRenderer.on('state:error', listener)
    return () => ipcRenderer.removeListener('state:error', listener)
  },
  login: (email: string, password: string): Promise<DesktopState> =>
    ipcRenderer.invoke('state:login', { email, password }),
  listTeams: (): Promise<{ id: string; name: string; organizationName: string }[]> =>
    ipcRenderer.invoke('state:teams'),
  register: (input: {
    name: string
    email: string
    password: string
    teamId: string
  }): Promise<DesktopState> => ipcRenderer.invoke('state:register', input),
  logout: (): Promise<DesktopState> => ipcRenderer.invoke('state:logout'),
  start: (): Promise<DesktopState> => ipcRenderer.invoke('state:start'),
  stop: (): Promise<DesktopState> => ipcRenderer.invoke('state:stop'),
  upload: (): Promise<DesktopState> => ipcRenderer.invoke('state:upload'),
  cancelUpload: (): Promise<DesktopState> => ipcRenderer.invoke('state:cancel-upload'),
  setWorkNote: (note: string): Promise<DesktopState> => ipcRenderer.invoke('state:work-note', note),
  updateSettings: (patch: Partial<LocalSettings>): Promise<DesktopState> =>
    ipcRenderer.invoke('state:settings', patch),
  retryFailed: (): Promise<DesktopState> => ipcRenderer.invoke('state:retry'),
  refreshPolicy: (): Promise<DesktopState> => ipcRenderer.invoke('state:refresh-policy'),
  payments: (method: 'GET' | 'POST' | 'PATCH', path: string, json?: unknown): Promise<unknown> =>
    ipcRenderer.invoke('payments:call', { method, path, json }),
  chat: (method: 'GET' | 'POST', path: string, json?: unknown): Promise<unknown> =>
    ipcRenderer.invoke('chat:call', { method, path, json }),
  reportHistory: (path: string): Promise<unknown> =>
    ipcRenderer.invoke('reports:history', { path }),
  uploadReportImage: (input: {
    contentType: string
    data: string
  }): Promise<{ id: string; path: string }> => ipcRenderer.invoke('reports:image-upload', input),
  readReportImage: (path: string): Promise<{ contentType: string; data: string }> =>
    ipcRenderer.invoke('reports:image-read', { path }),
  submitReport: (
    kind: 'DAILY' | 'WEEKLY',
    answers: { fieldId: string; text: string }[],
  ): Promise<DesktopState> => ipcRenderer.invoke('state:submit-report', { kind, answers }),
}

export type ScreenVaultApi = typeof api

contextBridge.exposeInMainWorld('screenvault', api)
