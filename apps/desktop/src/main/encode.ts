import sharp from 'sharp'
import type { EncodedImage } from '../core/capturePipeline.js'

export async function encodeImage(
  png: Buffer,
  options: { format: 'WEBP' | 'JPEG'; quality: number; maxWidth: number | null },
): Promise<EncodedImage> {
  const source = sharp(png, { failOn: 'none' })
  const metadata = await source.metadata()
  const originalWidth = metadata.width ?? 1
  const originalHeight = metadata.height ?? 1
  let pipeline = sharp(png, { failOn: 'none' })
  if (options.maxWidth && originalWidth > options.maxWidth) {
    pipeline = pipeline.resize({ width: options.maxWidth, withoutEnlargement: true })
  }
  const quality = Math.min(100, Math.max(40, Math.round(options.quality)))
  try {
    if (options.format === 'WEBP') {
      const bytes = await pipeline.webp({ quality }).toBuffer()
      const sized = await sharp(bytes).metadata()
      return {
        bytes,
        contentType: 'image/webp',
        width: sized.width ?? originalWidth,
        height: sized.height ?? originalHeight,
        originalWidth,
        originalHeight,
      }
    }
  } catch {
    // Fall through to JPEG when WebP encoding is unavailable.
  }
  const bytes = await sharp(png, { failOn: 'none' })
    .resize(options.maxWidth ? { width: options.maxWidth, withoutEnlargement: true } : undefined)
    .jpeg({ quality })
    .toBuffer()
  const sized = await sharp(bytes).metadata()
  return {
    bytes,
    contentType: 'image/jpeg',
    width: sized.width ?? originalWidth,
    height: sized.height ?? originalHeight,
    originalWidth,
    originalHeight,
  }
}
