import sharp from 'sharp'
import { ApiError } from './errors.js'
import { errorCodes } from '@screenvault/types'

export async function assertImageMatches(buffer: Buffer, contentType: string): Promise<void> {
  let metadata: sharp.Metadata
  try {
    metadata = await sharp(buffer, { failOn: 'error' }).metadata()
  } catch {
    throw new ApiError(
      400,
      errorCodes.VALIDATION_ERROR,
      'The uploaded file is not a readable image.',
    )
  }
  const expected = contentType === 'image/webp' ? 'webp' : 'jpeg'
  if (!metadata.width || !metadata.height || metadata.format !== expected) {
    throw new ApiError(400, errorCodes.VALIDATION_ERROR, 'Content type does not match the image.')
  }
}

export function createThumbnail(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .rotate()
    .resize({ width: 480, withoutEnlargement: true })
    .webp({ quality: 60 })
    .toBuffer()
}
