/**
 * Image redaction runs after compression and before encryption.
 * The default implementation returns the image unchanged.
 * A future OCR pass can replace this function without changing capture scheduling,
 * the upload queue, or the encrypted file format.
 */
export async function redactSensitiveRegions(image: Buffer): Promise<Buffer> {
  return image
}
