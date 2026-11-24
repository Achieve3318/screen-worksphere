import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const windowsForeground = [
  "Add-Type -TypeDefinition @'",
  'using System;',
  'using System.Text;',
  'using System.Runtime.InteropServices;',
  'public static class SvForeground {',
  '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
  '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);',
  '  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);',
  '}',
  "'@",
  '$handle = [SvForeground]::GetForegroundWindow()',
  '$processId = [uint32]0',
  '[void][SvForeground]::GetWindowThreadProcessId($handle, [ref]$processId)',
  '$builder = New-Object System.Text.StringBuilder 512',
  '[void][SvForeground]::GetWindowText($handle, $builder, $builder.Capacity)',
  "$name = ''",
  '$proc = $null',
  'if ($processId -ne 0) {',
  '  $proc = Get-Process -Id $processId -ErrorAction SilentlyContinue',
  '  if ($proc) { $name = [string]$proc.ProcessName }',
  '}',
  '$title = ($builder.ToString() -replace "[`r`n]+", " ").Trim()',
  '$app = $name',
  'if ($proc) {',
  '  try {',
  '    $desc = [string]$proc.MainModule.FileVersionInfo.FileDescription',
  '    if ($desc) { $app = $desc.Trim() }',
  '  } catch {}',
  '}',
  '$payload = $app + [char]10 + $name + [char]10 + $title',
  '[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($payload))',
].join('\n')

const encodedWindowsForeground = Buffer.from(windowsForeground, 'utf16le').toString('base64')

export type ForegroundWindow = {
  app: string | null
  processName: string | null
  title: string | null
}

/** Foreground program and window title. Returns nulls when the OS cannot answer. */
export async function foregroundWindow(): Promise<ForegroundWindow> {
  try {
    if (process.platform === 'win32') {
      const root = process.env.SystemRoot || 'C:\\Windows'
      const powershell = `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
      const { stdout } = await execFileAsync(
        powershell,
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedWindowsForeground],
        { timeout: 8000, windowsHide: true },
      )
      return decodeForeground(stdout)
    }
    if (process.platform === 'darwin') {
      const { stdout } = await execFileAsync(
        'osascript',
        [
          '-e',
          'tell application "System Events" to get {name, name, name of front window} of first process whose frontmost is true',
        ],
        { timeout: 4000 },
      )
      const [app, processName, title] = stdout.split(',').map((part) => part.trim())
      return { app: app || null, processName: processName || null, title: title || null }
    }
    if (process.platform === 'linux') {
      const { stdout } = await execFileAsync('xdotool', ['getactivewindow', 'getwindowname'], {
        timeout: 2000,
      })
      const title = stdout.trim() || null
      return { app: title, processName: null, title }
    }
    return { app: null, processName: null, title: null }
  } catch (error) {
    console.error('Foreground window lookup failed.', error)
    return { app: null, processName: null, title: null }
  }
}

export function decodeForeground(stdout: string): ForegroundWindow {
  const token = stdout.match(/[A-Za-z0-9+/]{8,}={0,2}/)?.[0]
  if (!token) return { app: null, processName: null, title: null }
  const [app, processName, title] = Buffer.from(token, 'base64').toString('utf8').split('\n')
  const program = app?.trim() || processName?.trim() || null
  return {
    app: program,
    processName: processName?.trim() || program,
    title: title?.trim() || null,
  }
}

/**
 * Metered-link detection is platform specific and often unavailable.
 * "unknown" does not block automatic upload; only an explicit "metered" result does.
 */
export function detectMeteredNetwork(): Promise<'metered' | 'unmetered' | 'unknown'> {
  return Promise.resolve('unknown')
}
