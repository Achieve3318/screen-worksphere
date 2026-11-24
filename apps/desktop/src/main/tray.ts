import { Menu, Tray, type NativeImage } from 'electron'
import { brand } from '@screenvault/shared'
import type { DesktopState } from '../core/desktopState.js'

export class TrayController {
  private tray: Tray | null = null

  update(input: {
    state: DesktopState
    icon: NativeImage
    onOpen: () => void
    onSignOut?: () => void
  }): void {
    if (!this.tray) {
      this.tray = new Tray(input.icon)
      this.tray.on('click', input.onOpen)
      this.tray.on('double-click', input.onOpen)
    } else {
      this.tray.setImage(input.icon)
    }
    this.tray.setToolTip(`${brand.productName} — ${input.state.activityLabel}`)
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: brand.productName, enabled: false },
        { type: 'separator' },
        {
          label: `Network Status: ${input.state.activity === 'offline' ? 'Offline' : 'Online'}`,
          enabled: false,
        },
        { type: 'separator' },
        { label: `Open ${brand.productName}`, click: input.onOpen },
        ...(input.state.signedIn && input.onSignOut
          ? [{ label: 'Sign out', click: input.onSignOut }]
          : []),
      ]),
    )
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }
}
