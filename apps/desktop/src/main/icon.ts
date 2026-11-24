import { readFileSync } from 'node:fs'
import { nativeImage, type NativeImage } from 'electron'
import appIconPath from '../../resources/icon.ico?asset'
import tray16Path from '../../resources/tray-16.png?asset'
import tray32Path from '../../resources/tray-32.png?asset'

export function appIcon(): NativeImage {
  return nativeImage.createFromPath(appIconPath)
}

export function trayImage(): NativeImage {
  const image = nativeImage.createEmpty()
  image.addRepresentation({ scaleFactor: 1, buffer: readFileSync(tray16Path) })
  image.addRepresentation({ scaleFactor: 2, buffer: readFileSync(tray32Path) })
  return image
}
