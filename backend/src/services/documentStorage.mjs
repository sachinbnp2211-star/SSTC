import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultStorageDirectory = fileURLToPath(new URL('../../private-document-storage/', import.meta.url))
const storageDirectory = path.resolve(defaultStorageDirectory)
const storageIdPattern = /^[0-9a-f-]{36}$/
const extensions = new Set(['.pdf', '.png', '.jpg', '.txt'])

async function ensureStorageDirectory() {
  await mkdir(storageDirectory, { recursive: true, mode: 0o700 })
}

function resolveStoragePath(storageId, extension) {
  if (!storageIdPattern.test(storageId)) {
    throw new Error('Invalid private storage reference.')
  }
  if (extension && !extensions.has(extension)) {
    throw new Error('Invalid private storage extension.')
  }
  const fileName = `${storageId}${extension || ''}`
  const fullPath = path.resolve(storageDirectory, fileName)
  if (path.dirname(fullPath) !== storageDirectory) {
    throw new Error('Invalid private storage reference.')
  }
  return fullPath
}

export async function storeOriginal(buffer, extension) {
  await ensureStorageDirectory()
  const storageId = randomUUID()
  const storagePath = resolveStoragePath(storageId, extension)
  const handle = await open(storagePath, 'wx', 0o600)
  try {
    await handle.writeFile(buffer)
  } catch (error) {
    await handle.close()
    await rm(storagePath, { force: true })
    throw error
  }
  await handle.close()
  return storageId
}

export async function storeExtractedText(storageId, text) {
  await ensureStorageDirectory()
  const storagePath = resolveStoragePath(storageId, '.txt')
  const handle = await open(storagePath, 'wx', 0o600)
  try {
    await handle.writeFile(text, 'utf8')
  } catch (error) {
    await handle.close()
    await rm(storagePath, { force: true })
    throw error
  }
  await handle.close()
  return storageId
}

export async function readOriginal(storageId, extension) {
  return readFile(resolveStoragePath(storageId, extension))
}

export async function readExtractedText(storageId) {
  return readFile(resolveStoragePath(storageId, '.txt'), 'utf8')
}

export async function removeStorageFile(storageId, extension) {
  await rm(resolveStoragePath(storageId, extension), { force: true })
}
