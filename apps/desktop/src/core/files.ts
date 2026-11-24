import { mkdir, open, rename } from 'node:fs/promises'
import path from 'node:path'

export async function atomicWriteFile(filePath: string, bytes: Buffer): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.tmp`
  const handle = await open(temporary, 'w')
  try {
    await handle.write(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporary, filePath)
}
