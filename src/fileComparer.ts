import { promises as fs } from 'fs'
import { createHash } from 'crypto'
import path from 'path'

// Types
export interface FileSageConfigType {
    textMaxSizeBytes: number
    binaryMaxSizeBytes: number
}
  
// Default Configuration
export const FileSageConfig: FileSageConfigType = {
    textMaxSizeBytes: 50 * 1024,     // 50 KB
    binaryMaxSizeBytes: 100 * 1024   // 100 KB (default, adjust if needed)
}
  
// Optional Helper Function
export function configureFileSage(options: Partial<FileSageConfigType>) {
    Object.assign(FileSageConfig, options)
}  

const textFileExtensions = ['.txt', '.csv', '.json', '.xml', '.html', '.md']

function isTextFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  return textFileExtensions.includes(ext)
}

async function getFileSize(filePath: string): Promise<number> {
  const stats = await fs.stat(filePath)
  return stats.size
}

async function hashFile(filePath: string): Promise<string> {
  const data = await fs.readFile(filePath)
  return createHash('sha256').update(data).digest('hex')
}

async function compareFilesByString(file1: string, file2: string): Promise<void> {
  const [content1, content2] = await Promise.all([
    fs.readFile(file1, 'utf8'),
    fs.readFile(file2, 'utf8')
  ])
  if (content1 !== content2) {
    throw new Error(`Text file contents differ: ${file1} vs ${file2}`)
  }
}

async function compareFilesByBuffer(file1: string, file2: string): Promise<void> {
  const [buffer1, buffer2] = await Promise.all([
    fs.readFile(file1),
    fs.readFile(file2)
  ])
  if (!buffer1.equals(buffer2)) {
    throw new Error(`Binary file contents differ: ${file1} vs ${file2}`)
  }
}

async function compareFilesByHash(file1: string, file2: string): Promise<void> {
  const [hash1, hash2] = await Promise.all([
    hashFile(file1),
    hashFile(file2)
  ])
  if (hash1 !== hash2) {
    throw new Error(`File hashes differ: ${file1} vs ${file2}`)
  }
}

export async function expectFilesToBeEqual(filePath1: string, filePath2: string): Promise<void> {
  const [size1, size2] = await Promise.all([
    getFileSize(filePath1),
    getFileSize(filePath2)
  ])

  if (size1 !== size2) {
    throw new Error(`Files have different sizes: ${filePath1} (${size1} bytes) vs ${filePath2} (${size2} bytes)`)
  }

  const isText = isTextFile(filePath1)

  if (isText) {
    if (size1 <= FileSageConfig.textMaxSizeBytes) {
      await compareFilesByString(filePath1, filePath2)
    } else {
      await compareFilesByHash(filePath1, filePath2)
    }
  } else {
    if (size1 <= FileSageConfig.binaryMaxSizeBytes) {
      await compareFilesByBuffer(filePath1, filePath2)
    } else {
      await compareFilesByHash(filePath1, filePath2)
    }
  }
}
