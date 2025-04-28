import * as fs from 'fs'
import { promises as fsp } from 'fs'
import { createHash } from 'crypto'
import path from 'path'
import axios from 'axios'
import { pipeline } from 'stream/promises'

// Strategy Types
export type ComparisonStrategy =
  | 'etag'
  | 'content-length'
  | 'partial-hash'
  | 'stream-hash'
  | 'stream-buffer-compare'
  | 'download-buffer'
  | 'download-hash'

export interface FileSageConfigType {
  textMaxSizeBytes: number
  binaryMaxSizeBytes: number
  remoteComparisonStrategies: ComparisonStrategy[]
  remoteTimeoutMs: number
  remoteMaxRetries: number
  partialHashChunkSize: number
  chunkCompareSize: number
  mimeTypeCheckEnabled: boolean
  preferPartialHash: boolean
}

// Default Configuration
export const FileSageConfig: FileSageConfigType = {
  textMaxSizeBytes: 50 * 1024,
  binaryMaxSizeBytes: 100 * 1024,
  remoteComparisonStrategies: ['etag', 'content-length', 'partial-hash', 'stream-hash'],
  remoteTimeoutMs: 8000,
  remoteMaxRetries: 2,
  partialHashChunkSize: 64 * 1024,
  chunkCompareSize: 512 * 1024,
  mimeTypeCheckEnabled: false,
  preferPartialHash: true
}

// Helper to allow user override
export function configureFileSage(options: Partial<FileSageConfigType>) {
  Object.assign(FileSageConfig, options)
}

// Internals
const textFileExtensions = ['.txt', '.csv', '.json', '.xml', '.html', '.md']

function isTextFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  return textFileExtensions.includes(ext)
}

function isUrl(path: string): boolean {
  return path.startsWith('http://') || path.startsWith('https://')
}

async function getFileSize(filePath: string): Promise<number> {
  const stats = await fsp.stat(filePath)
  return stats.size
}

async function retry<T>(fn: () => Promise<T>, retries = FileSageConfig.remoteMaxRetries): Promise<T> {
  let attempt = 0
  while (attempt <= retries) {
    try {
      return await fn()
    } catch (error) {
      if (attempt === retries) {
        throw error
      }
      attempt++
    }
  }
  throw new Error('Retry logic failed unexpectedly')
}

async function fetchHead(url: string) {
  try {
    const response = await axios.head(url, { timeout: FileSageConfig.remoteTimeoutMs })
    return {
      contentLength: Number(response.headers['content-length'] || 0),
      etag: response.headers['etag'] ? response.headers['etag'].replace(/"/g, '') : undefined,
      contentType: response.headers['content-type']
    }
  } catch (error: any) {
    if (error.response && error.response.status === 405) {
      const response = await axios.get(url, { timeout: FileSageConfig.remoteTimeoutMs })
      return {
        contentLength: Number(response.headers['content-length'] || 0),
        etag: response.headers['etag'] ? response.headers['etag'].replace(/"/g, '') : undefined,
        contentType: response.headers['content-type']
      }
    }
    throw error
  }
}

async function downloadRemoteFile(url: string, tempPath: string): Promise<void> {
  await retry(async () => {
    const response = await axios.get(url, { responseType: 'stream', timeout: FileSageConfig.remoteTimeoutMs })
    const writer = fs.createWriteStream(tempPath)
    await new Promise<void>((resolve, reject) => {
      response.data.pipe(writer)
      writer.on('finish', () => resolve())
      writer.on('error', reject)
    })
  })
}

async function streamHashFromUrl(url: string): Promise<string> {
  return await retry(async () => {
    const response = await axios.get(url, { responseType: 'stream', timeout: FileSageConfig.remoteTimeoutMs })
    const hash = createHash('sha256')
    return new Promise<string>((resolve, reject) => {
      response.data.on('data', (chunk: Buffer) => hash.update(chunk))
      response.data.on('end', () => resolve(hash.digest('hex')))
      response.data.on('error', reject)
    })
  })
}

async function hashPartial(filePath: string): Promise<string> {
  const stats = await fsp.stat(filePath)
  const size = stats.size
  const chunkSize = FileSageConfig.partialHashChunkSize
  const fd = await fsp.open(filePath, 'r')

  try {
    const hash = createHash('sha256')
    const buffers: Buffer[] = []

    const headBuffer = Buffer.alloc(Math.min(chunkSize, size))
    await fd.read(headBuffer, 0, headBuffer.length, 0)
    buffers.push(headBuffer)

    if (size > chunkSize * 2) {
      const middlePos = Math.floor(size / 2) - Math.floor(chunkSize / 2)
      const middleBuffer = Buffer.alloc(Math.min(chunkSize, size))
      await fd.read(middleBuffer, 0, middleBuffer.length, middlePos)
      buffers.push(middleBuffer)
    }

    if (size > chunkSize) {
      const tailPos = size - chunkSize
      const tailBuffer = Buffer.alloc(Math.min(chunkSize, size))
      await fd.read(tailBuffer, 0, tailBuffer.length, tailPos)
      buffers.push(tailBuffer)
    }

    for (const buf of buffers) {
      hash.update(buf)
    }

    return hash.digest('hex')
  } finally {
    await fd.close()
  }
}

async function fullHash(filePath: string): Promise<string> {
  const data = await fsp.readFile(filePath)
  return createHash('sha256').update(data).digest('hex')
}

async function smartHash(filePath: string): Promise<string> {
  return FileSageConfig.preferPartialHash ? hashPartial(filePath) : fullHash(filePath)
}

async function compareFilesByString(file1: string, file2: string): Promise<void> {
  const [content1, content2] = await Promise.all([
    fsp.readFile(file1, 'utf8'),
    fsp.readFile(file2, 'utf8')
  ])
  if (content1 !== content2) {
    throw new Error(`Text file contents differ: ${file1} vs ${file2}`)
  }
}

async function compareFilesByBuffer(file1: string, file2: string): Promise<void> {
  const [buffer1, buffer2] = await Promise.all([
    fsp.readFile(file1),
    fsp.readFile(file2)
  ])
  if (!buffer1.equals(buffer2)) {
    throw new Error(`Binary file contents differ: ${file1} vs ${file2}`)
  }
}

async function compareFilesByHash(file1: string, file2: string): Promise<void> {
  const [hash1, hash2] = await Promise.all([
    smartHash(file1),
    smartHash(file2)
  ])
  if (hash1 !== hash2) {
    throw new Error(`File hashes differ: ${file1} vs ${file2}`)
  }
}

async function streamBufferCompare(file1: string, url: string): Promise<void> {
  const readStream = fs.createReadStream(file1, { highWaterMark: FileSageConfig.chunkCompareSize })
  const response = await axios.get(url, { responseType: 'stream', timeout: FileSageConfig.remoteTimeoutMs })
  const remoteStream = response.data

  return new Promise<void>((resolve, reject) => {
    const reader = readStream[Symbol.asyncIterator]()
    const remoteReader = remoteStream[Symbol.asyncIterator]()

    async function compareChunks() {
      try {
        while (true) {
          const [localResult, remoteResult] = await Promise.all([reader.next(), remoteReader.next()])
          if (localResult.done && remoteResult.done) {
            resolve()
            break
          }
          if (localResult.done || remoteResult.done) {
            reject(new Error('Files have different lengths'))
            break
          }
          if (Buffer.compare(localResult.value, remoteResult.value) !== 0) {
            reject(new Error('Chunks differ'))
            break
          }
        }
      } catch (error) {
        reject(error)
      }
    }    

    compareChunks()
  })
}

// Main Entry
export async function expectFilesToBeEqual(filePath1: string, filePath2: string): Promise<void> {
  const isRemote = isUrl(filePath2)

  if (!isRemote) {
    const [size1, size2] = await Promise.all([
      getFileSize(filePath1),
      getFileSize(filePath2)
    ])

    if (size1 !== size2) {
      throw new Error(`Files have different sizes: ${filePath1} (${size1}) vs ${filePath2} (${size2})`)
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
  } else {
    const localSize = await getFileSize(filePath1)
    const { contentLength, etag, contentType } = await fetchHead(filePath2)

    if (FileSageConfig.mimeTypeCheckEnabled) {
      if (contentType && contentType.startsWith('text/') !== isTextFile(filePath1)) {
        throw new Error(`MIME type mismatch between ${filePath1} and ${filePath2}`)
      }
    }

    for (const strategy of FileSageConfig.remoteComparisonStrategies) {
      if (strategy === 'etag') {
        const localHash = await smartHash(filePath1)
        if (etag && etag === localHash) {
          return
        }
      }

      if (strategy === 'content-length') {
        if (localSize === contentLength) {
          return
        }
      }

      if (strategy === 'partial-hash') {
        const [localPartial, remotePartial] = await Promise.all([
          smartHash(filePath1),
          streamHashFromUrl(filePath2)
        ])
        if (localPartial === remotePartial) {
          return
        }
      }

      if (strategy === 'stream-hash') {
        const [localFull, remoteFull] = await Promise.all([
          smartHash(filePath1),
          streamHashFromUrl(filePath2)
        ])
        if (localFull === remoteFull) {
          return
        }
      }

      if (strategy === 'stream-buffer-compare') {
        await streamBufferCompare(filePath1, filePath2)
        return
      }

      if (strategy === 'download-buffer' || strategy === 'download-hash') {
        const tempPath = path.join(__dirname, `../temp/temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.bin`)
        await fsp.mkdir(path.dirname(tempPath), { recursive: true })
        await downloadRemoteFile(filePath2, tempPath)
        if (strategy === 'download-buffer') {
          await compareFilesByBuffer(filePath1, tempPath)
        } else {
          await compareFilesByHash(filePath1, tempPath)
        }
        await fsp.unlink(tempPath)
        return
      }
    }

    throw new Error(`Remote file did not match by any strategy: ${filePath1} vs ${filePath2}`)
  }
}
