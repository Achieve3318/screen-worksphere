import { join } from 'node:path'
import { app, BrowserWindow, Menu, powerMonitor, session } from 'electron'
import { z } from 'zod'
import { brand } from '@screenvault/shared'
import { DesktopRuntime } from './runtime.js'
import { appIcon, trayImage } from './icon.js'
import { TrayController } from './tray.js'

const settingsPatch = z
  .object({
    launchOnStartup: z.boolean(),
    startMonitoringOnLaunch: z.boolean(),
    minimizeToTray: z.boolean(),
    showCaptureNotifications: z.boolean(),
    shortcutEnabled: z.boolean(),
    shortcut: z.string().min(1).max(80),
    apiUrl: z.string().url(),
  })
  .partial()

let window: BrowserWindow | null = null
let quitting = false
let systemExit = false
let runtime: DesktopRuntime

function broadcast(): void {
  const state = runtime.snapshot()
  window?.webContents.send('state:updated', state)
  rebuildTray(state)
}

const tray = new TrayController()

function rebuildTray(state: ReturnType<DesktopRuntime['snapshot']>): void {
  tray.update({
    state,
    icon: trayImage(),
    onOpen: () => showWindow(),
    onSignOut: () => {
      void runtime.logout().then(() => broadcast())
    },
  })
}

function showWindow(): void {
  if (!window || window.isDestroyed()) return
  window.setSkipTaskbar(false)
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

function stayInTray(): boolean {
  if (quitting) return false
  try {
    return runtime.snapshot().settings.minimizeToTray
  } catch {
    return true
  }
}

function hideToTray(): void {
  if (!window || window.isDestroyed()) return
  window.setSkipTaskbar(true)
  window.hide()
}

async function createWindow(): Promise<void> {
  window = new BrowserWindow({
    width: 440,
    height: 640,
    minWidth: 400,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0c121c',
    title: brand.productName,
    icon: appIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.on('ready-to-show', () => window?.show())
  window.on('close', (event) => {
    if (!stayInTray()) return
    event.preventDefault()
    hideToTray()
  })
  window.on('minimize', (event) => {
    if (!stayInTray()) return
    event.preventDefault()
    hideToTray()
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => {
    const current = window?.webContents.getURL()
    if (current && event.url !== current) event.preventDefault()
  })
  if (app.isPackaged) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; script-src 'self'",
          ],
        },
      })
    })
    await window.loadFile(join(__dirname, '../renderer/index.html'))
  } else if (process.env.ELECTRON_RENDERER_URL) {
    await loadDevServer(window, process.env.ELECTRON_RENDERER_URL)
  }
}

async function loadDevServer(target: BrowserWindow, url: string): Promise<void> {
  const candidates = [url]
  if (url.includes('localhost')) {
    candidates.push(url.replaceAll('localhost', '127.0.0.1'), url.replaceAll('localhost', '[::1]'))
  }
  let lastError: unknown
  for (const candidate of candidates) {
    try {
      await target.loadURL(candidate)
      return
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('The window could not load the interface.')
}

app.setName(brand.productName)
app.setPath('userData', join(app.getPath('appData'), brand.dataDirName))
app.setAppUserModelId('com.screenvault.desktop')

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null)
    runtime = new DesktopRuntime(app.getPath('userData'), broadcast)
    await runtime.init()
    const { ipcMain } = await import('electron')
    ipcMain.handle('state:get', () => runtime.snapshot())
    ipcMain.handle('state:login', async (_event, payload: unknown) => {
      const body = z
        .object({ email: z.string().email(), password: z.string().min(1) })
        .parse(payload)
      await runtime.login(body.email, body.password)
      return runtime.snapshot()
    })
    ipcMain.handle('state:teams', async () => runtime.listTeams())
    ipcMain.handle('state:register', async (_event, payload: unknown) => {
      const body = z
        .object({
          name: z.string().trim().min(1).max(120),
          email: z.string().email(),
          password: z.string().min(1),
          teamId: z.string().uuid(),
        })
        .parse(payload)
      await runtime.register(body.name, body.email, body.password, body.teamId)
      return runtime.snapshot()
    })
    ipcMain.handle('state:logout', async () => {
      await runtime.logout()
      return runtime.snapshot()
    })
    ipcMain.handle('state:start', async () => {
      await runtime.start()
      return runtime.snapshot()
    })
    ipcMain.handle('state:stop', () => runtime.snapshot())
    ipcMain.handle('state:upload', async () => {
      await runtime.uploadNow()
      return runtime.snapshot()
    })
    ipcMain.handle('state:cancel-upload', () => {
      runtime.cancelUpload()
      return runtime.snapshot()
    })
    ipcMain.handle('state:work-note', async (_event, note: unknown) => {
      await runtime.setWorkNote(z.string().parse(note))
      return runtime.snapshot()
    })
    ipcMain.handle('state:settings', async (_event, patch: unknown) => {
      await runtime.updateSettings(settingsPatch.parse(patch))
      return runtime.snapshot()
    })
    ipcMain.handle('state:retry', async () => {
      await runtime.retryFailed()
      return runtime.snapshot()
    })
    ipcMain.handle('reports:history', async (_event, payload: unknown) => {
      const body = z
        .object({
          path: z.string().regex(/^\/api\/v1\/reports\/mine(\?|$)/),
        })
        .parse(payload)
      return runtime.reportsCall(body.path)
    })
    ipcMain.handle('chat:call', async (_event, payload: unknown) => {
      const body = z
        .object({
          method: z.enum(['GET', 'POST']),
          path: z.string().regex(/^\/api\/v1\/chat(\/|\?|$)/),
          json: z.unknown().optional(),
        })
        .parse(payload)
      return runtime.chatCall(body.method, body.path, body.json)
    })
    ipcMain.handle('payments:call', async (_event, payload: unknown) => {
      const body = z
        .object({
          method: z.enum(['GET', 'POST', 'PATCH']),
          path: z.string().regex(/^\/api\/v1\/payments(\/|\?|$)/),
          json: z.unknown().optional(),
        })
        .parse(payload)
      return runtime.paymentsCall(body.method, body.path, body.json)
    })
    ipcMain.handle('state:refresh-policy', async () => {
      await runtime.refreshPolicy()
      return runtime.snapshot()
    })
    ipcMain.handle('reports:image-upload', async (_event, payload: unknown) => {
      const body = z
        .object({
          contentType: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
          data: z.string().min(1).max(8_000_000),
        })
        .parse(payload)
      return runtime.uploadReportImage(body.contentType, body.data)
    })
    ipcMain.handle('reports:image-read', async (_event, payload: unknown) => {
      const body = z
        .object({ path: z.string().regex(/^\/api\/v1\/reports\/images\/[0-9a-f-]{36}$/i) })
        .parse(payload)
      return runtime.readReportImage(body.path)
    })
    ipcMain.handle('state:submit-report', async (_event, payload: unknown) => {
      const body = z
        .object({
          kind: z.enum(['DAILY', 'WEEKLY']),
          answers: z
            .array(
              z.object({
                fieldId: z.string().uuid(),
                text: z.string().trim().min(1).max(20000),
              }),
            )
            .max(20),
        })
        .parse(payload)
      await runtime.submitReport(body.kind, body.answers)
      return runtime.snapshot()
    })
    Menu.setApplicationMenu(null)
    app.setLoginItemSettings({ openAtLogin: runtime.snapshot().settings.launchOnStartup })
    await createWindow()
    broadcast()
  })
  app.on('before-quit', (event) => {
    if (!systemExit) {
      event.preventDefault()
      hideToTray()
      return
    }
    quitting = true
    tray.destroy()
    runtime?.shutdown()
  })
  const beginSystemExit = (): void => {
    if (systemExit) return
    systemExit = true
    quitting = true
    // Persist shutdown immediately; reboot often kills the process mid-request.
    void runtime?.reportShutdown().catch(() => undefined)
    tray.destroy()
    runtime?.shutdown()
    app.quit()
  }
  // Windows fires session-end on reboot/logoff; typings omit it on some Electron versions.
  app.on('session-end' as 'will-quit', () => beginSystemExit())
  powerMonitor.on('shutdown', () => beginSystemExit())
  app.on('window-all-closed', () => {
    // The window hides to the tray. Users cannot quit from the app UI.
  })
}
