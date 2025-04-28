import * as fs from 'fs'
import { promises as fsp } from 'fs'
import { createHash } from 'crypto'
import path from 'path'
import axios from 'axios'

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
  remoteComparisonStrategies: [
    'content-length',
    'etag',
    'partial-hash',
    'stream-hash',
    'stream-buffer-compare',
    'download-buffer',
    'download-hash'
  ],
  remoteTimeoutMs: 8000,
  remoteMaxRetries: 2,
  partialHashChunkSize: 64 * 1024,
  chunkCompareSize: 512 * 1024,
  mimeTypeCheckEnabled: false,
  preferPartialHash: true
}

// Allow user override
export function configureFileSage(options: Partial<FileSageConfigType>) {
  Object.assign(FileSageConfig, options)
}

// Helpers
const textFileExtensions = ['.txt', '.csv', '.json', '.xml', '.html', '.md']
function isTextFile(p: string): boolean {
  return textFileExtensions.includes(path.extname(p).toLowerCase())
}
function isUrl(p: string): boolean {
  return p.startsWith('http://') || p.startsWith('https://')
}
async function getFileSize(p: string): Promise<number> {
  return (await fsp.stat(p)).size
}
async function retry<T>(fn: () => Promise<T>, retries = FileSageConfig.remoteMaxRetries): Promise<T> {
  let attempt = 0
  while (attempt <= retries) {
    try {
      return await fn()
    } catch (err) {
      if (attempt === retries) throw err
      attempt++
    }
  }
  throw new Error('Retry logic failed')
}

// Fetch headers
async function fetchHead(url: string) {
  const headers = { 'Accept-Encoding': 'identity' }
  try {
    const resp = await axios.head(url, { timeout: FileSageConfig.remoteTimeoutMs, headers })
    return {
      contentLength: Number(resp.headers['content-length'] || 0),
      etag: resp.headers['etag']?.replace(/"/g, '') || undefined,
      contentType: resp.headers['content-type']
    }
  } catch (err: any) {
    if (err.response?.status === 405) {
      const resp = await axios.get(url, { timeout: FileSageConfig.remoteTimeoutMs, headers })
      return {
        contentLength: Number(resp.headers['content-length'] || 0),
        etag: resp.headers['etag']?.replace(/"/g, '') || undefined,
        contentType: resp.headers['content-type']
      }
    }
    throw err
  }
}

// Download remote file
async function downloadRemoteFile(url: string, dest: string): Promise<void> {
  await retry(async () => {
    const resp = await axios.get(url, {
      responseType: 'stream',
      timeout: FileSageConfig.remoteTimeoutMs,
      headers: { 'Accept-Encoding': 'identity' }
    })
    await new Promise<void>((res, rej) => {
      resp.data.pipe(fs.createWriteStream(dest))
        .on('finish', res)
        .on('error', rej)
    })
  })
}

// Stream-hash from URL
async function streamHashFromUrl(url: string): Promise<string> {
  return retry(async () => {
    const resp = await axios.get(url, {
      responseType: 'stream',
      timeout: FileSageConfig.remoteTimeoutMs,
      headers: { 'Accept-Encoding': 'identity' }
    })
    const hash = createHash('sha256')
    return new Promise<string>((resolve, reject) => {
      resp.data.on('data', (c: Buffer) => hash.update(c))
      resp.data.on('end', () => resolve(hash.digest('hex')))
      resp.data.on('error', reject)
    })
  })
}

// Local partial hash
async function hashPartial(p: string): Promise<string> {
  const size = (await fsp.stat(p)).size
  const chunk = FileSageConfig.partialHashChunkSize
  const fd = await fsp.open(p, 'r')
  try {
    const hash = createHash('sha256')
    const headLen = Math.min(chunk, size)
    const headBuf = Buffer.alloc(headLen)
    await fd.read(headBuf, 0, headLen, 0)
    hash.update(headBuf)
    if (size > chunk) {
      const tailPos = size - chunk
      const tailLen = Math.min(chunk, size)
      const tailBuf = Buffer.alloc(tailLen)
      await fd.read(tailBuf, 0, tailLen, tailPos)
      hash.update(tailBuf)
    }
    return hash.digest('hex')
  } finally {
    await fd.close()
  }
}

// Remote partial hash
async function remotePartialHash(url: string): Promise<string> {
  const chunk = FileSageConfig.partialHashChunkSize
  const h1 = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: FileSageConfig.remoteTimeoutMs,
    headers: { 'Accept-Encoding': 'identity', Range: `bytes=0-${chunk-1}` }
  })
  const total = parseInt(h1.headers['content-range']?.split('/')[1] || '0', 10)
  const start = Math.max(0, total - chunk)
  const h2 = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: FileSageConfig.remoteTimeoutMs,
    headers: { 'Accept-Encoding': 'identity', Range: `bytes=${start}-${total-1}` }
  })
  const hash = createHash('sha256')
  hash.update(Buffer.from(h1.data as ArrayBuffer)).update(Buffer.from(h2.data as ArrayBuffer))
  return hash.digest('hex')
}

// Full local hash
async function fullHash(p: string): Promise<string> {
  const data = await fsp.readFile(p)
  return createHash('sha256').update(data).digest('hex')
}
async function smartHash(p: string): Promise<string> {
  return FileSageConfig.preferPartialHash ? hashPartial(p) : fullHash(p)
}

// Comparison helpers
async function compareFilesByString(f1: string, f2: string): Promise<void> {
  const [a, b] = await Promise.all([ fsp.readFile(f1, 'utf8'), fsp.readFile(f2, 'utf8') ])
  if (a !== b) throw new Error('Text contents differ')
}
async function compareFilesByBuffer(f1: string, f2: string): Promise<void> {
  const [a, b] = await Promise.all([ fsp.readFile(f1), fsp.readFile(f2) ])
  if (!a.equals(b)) throw new Error('Binary contents differ')
}

// Stream-Buffer compare from URL
async function streamBufferCompare(local: string, url: string): Promise<void> {
  const ls = fs.createReadStream(local, { highWaterMark: FileSageConfig.chunkCompareSize })
  const resp = await axios.get(url, {
    responseType: 'stream',
    timeout: FileSageConfig.remoteTimeoutMs,
    headers: { 'Accept-Encoding': 'identity' }
  })
  const rs = resp.data
  const li = ls[Symbol.asyncIterator]()
  const ri = rs[Symbol.asyncIterator]()
  while (true) {
    const [l, r] = await Promise.all([ li.next(), ri.next() ])
    if (l.done && r.done) return
    if (l.done || r.done) throw new Error('Stream lengths differ')
    if (Buffer.compare(l.value, r.value) !== 0) throw new Error('Stream chunk mismatch')
  }
}

// Main entry
export async function expectFilesToBeEqual(path1: string, path2: string): Promise<void> {
  if (!isUrl(path2)) {
    const [s1, s2] = await Promise.all([ getFileSize(path1), getFileSize(path2) ])
    if (s1 !== s2) throw new Error(`Size mismatch ${s1} vs ${s2}`)
    if (isTextFile(path1)) {
      await compareFilesByString(path1, path2)
    } else {
      await compareFilesByBuffer(path1, path2)
    }
    return
  }
  // Remote case
  const localSize = await getFileSize(path1)
  const head = await fetchHead(path2)
  if (FileSageConfig.mimeTypeCheckEnabled && head.contentType) {
    if (head.contentType.startsWith('text/') !== isTextFile(path1)) {
      throw new Error('MIME type mismatch')
    }
  }
  for (const strat of FileSageConfig.remoteComparisonStrategies) {
    try {
      switch (strat) {
        case 'content-length':
          if (localSize === head.contentLength) return
          break
        case 'etag':
          if (head.etag && (await smartHash(path1)) === head.etag) return
          break
        case 'partial-hash': {
          const lp = await hashPartial(path1)
          const rp = await remotePartialHash(path2)
          if (lp === rp) return
          break
        }
        case 'stream-hash':
          if ((await smartHash(path1)) === await streamHashFromUrl(path2)) return
          break
        case 'stream-buffer-compare':
          await streamBufferCompare(path1, path2)
          return
        case 'download-buffer': {
          const tmp = path.join(__dirname, `../temp/${Date.now()}_${path.basename(path2)}`)
          await downloadRemoteFile(path2, tmp)
          await compareFilesByBuffer(path1, tmp)
          await fsp.unlink(tmp)
          return
        }
        case 'download-hash': {
          const tmp2 = path.join(__dirname, `../temp/${Date.now()}_${path.basename(path2)}`)
          await downloadRemoteFile(path2, tmp2)
          await compareFilesByBuffer(path1, tmp2)
          await fsp.unlink(tmp2)
          return
        }
      }
    } catch {
      continue
    }
  }
  throw new Error(`No remote match for ${path1} vs ${path2}`)
}
