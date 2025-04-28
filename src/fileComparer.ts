import * as fs from 'fs'
import { promises as fsp } from 'fs'
import { createHash } from 'crypto'
import path from 'path'
import axios from 'axios'

// --- Policy Types ---
export type ComparisonPolicy =
  | { name: 'content-length' }
  | { name: 'etag'; expectedEtag: string }
  | { name: 'partial-hash' }
  | { name: 'stream-hash' }
  | { name: 'stream-buffer-compare' }
  | { name: 'download-buffer' }
  | { name: 'download-hash' }

// --- Configuration ---
export interface FileSageConfigType {
  remoteComparisonPolicies: ComparisonPolicy[]
  remoteTimeoutMs: number
  remoteMaxRetries: number
  partialHashChunkSize: number
  chunkCompareSize: number
  mimeTypeCheckEnabled: boolean
  preferPartialHash: boolean
}

export const FileSageConfig: FileSageConfigType = {
  remoteComparisonPolicies: [
    { name: 'content-length' },
    { name: 'etag', expectedEtag: '' },
    { name: 'partial-hash' },
    { name: 'stream-hash' },
    { name: 'stream-buffer-compare' },
    { name: 'download-buffer' },
    { name: 'download-hash' }
  ],
  remoteTimeoutMs: 8000,
  remoteMaxRetries: 2,
  partialHashChunkSize: 64 * 1024,
  chunkCompareSize: 512 * 1024,
  mimeTypeCheckEnabled: false,
  preferPartialHash: true
}

export function configureFileSage(options: Partial<FileSageConfigType>) {
  Object.assign(FileSageConfig, options)
}

// --- Internals ---
const textFileExtensions = ['.txt', '.csv', '.json', '.xml', '.html', '.md']
function isTextFile(p: string): boolean {
  return textFileExtensions.includes(path.extname(p).toLowerCase())
}
function isUrl(p: string): boolean {
  return /^https?:\/\//i.test(p)
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
  throw new Error('Retry logic failed unexpectedly')
}

// Fetch HEAD with optional extra headers (e.g. If-None-Match)
async function fetchHead(
  url: string,
  extraHeaders: Record<string,string> = {}
): Promise<{ status: number; etag?: string; contentLength: number; contentType?: string }> {
  const resp = await retry(() =>
    axios.head(url, {
      timeout: FileSageConfig.remoteTimeoutMs,
      headers: { 'Accept-Encoding': 'identity', ...extraHeaders }
    })
  )
  return {
    status: resp.status,
    etag: resp.headers['etag']?.replace(/"/g, ''),
    contentLength: Number(resp.headers['content-length'] || 0),
    contentType: resp.headers['content-type']
  }
}

// Download remote URL to a local temp file
async function downloadRemoteFile(url: string, dest: string): Promise<void> {
  await retry(async () => {
    const resp = await axios.get(url, {
      responseType: 'stream',
      timeout: FileSageConfig.remoteTimeoutMs,
      headers: { 'Accept-Encoding': 'identity' }
    })
    await new Promise<void>((res, rej) => {
      resp.data
        .pipe(fs.createWriteStream(dest))
        .on('finish', res)
        .on('error', rej)
    })
  })
}

// Compute SHA-256 by streaming the URL
async function streamHashFromUrl(url: string): Promise<string> {
  const resp = await retry(() =>
    axios.get(url, {
      responseType: 'stream',
      timeout: FileSageConfig.remoteTimeoutMs,
      headers: { 'Accept-Encoding': 'identity' }
    })
  )
  const hash = createHash('sha256')
  return new Promise<string>((resolve, reject) => {
    resp.data.on('data', (c: Buffer) => hash.update(c))
    resp.data.on('end', () => resolve(hash.digest('hex')))
    resp.data.on('error', reject)
  })
}

// Compute partial SHA-256 locally (head + tail)
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

// Compute partial SHA-256 remotely via two ranged GETs
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
  hash.update(Buffer.from(h1.data as ArrayBuffer))
  hash.update(Buffer.from(h2.data as ArrayBuffer))
  return hash.digest('hex')
}

// Compute full SHA-256 locally
async function fullHash(p: string): Promise<string> {
  const data = await fsp.readFile(p)
  return createHash('sha256').update(data).digest('hex')
}

// Choose partial or full
async function smartHash(p: string): Promise<string> {
  return FileSageConfig.preferPartialHash ? hashPartial(p) : fullHash(p)
}

// Compare two local files as text
async function compareFilesByString(f1: string, f2: string): Promise<void> {
  const [a, b] = await Promise.all([ fsp.readFile(f1, 'utf8'), fsp.readFile(f2, 'utf8') ])
  if (a !== b) throw new Error(`Text contents differ: ${f1} vs ${f2}`)
}

// Compare two local files as binary
async function compareFilesByBuffer(f1: string, f2: string): Promise<void> {
  const [a, b] = await Promise.all([ fsp.readFile(f1), fsp.readFile(f2) ])
  if (!a.equals(b)) throw new Error(`Binary contents differ: ${f1} vs ${f2}`)
}

// Stream-buffer compare between local file and URL
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
    if (l.done || r.done) throw new Error('Stream length mismatch')
    if (Buffer.compare(l.value, r.value) !== 0) throw new Error('Stream chunk mismatch')
  }
}

// --- Main Entry Point ---
export async function expectFilesToBeEqual(path1: string, path2: string): Promise<void> {
  // Local vs Local?
  if (!isUrl(path2)) {
    const [s1, s2] = await Promise.all([ getFileSize(path1), getFileSize(path2) ])
    if (s1 !== s2) throw new Error(`Size mismatch: ${s1} vs ${s2}`)
    if (isTextFile(path1)) {
      await compareFilesByString(path1, path2)
    } else {
      await compareFilesByBuffer(path1, path2)
    }
    return
  }

  // Local vs Remote
  const localSize = await getFileSize(path1)
  const headBase = await fetchHead(path2)
  if (FileSageConfig.mimeTypeCheckEnabled && headBase.contentType) {
    const isText = isTextFile(path1)
    if (headBase.contentType.startsWith('text/') !== isText) {
      throw new Error(`MIME mismatch: ${headBase.contentType} vs ${path1}`)
    }
  }

  // Iterate policies; on first failure, stop
  for (const policy of FileSageConfig.remoteComparisonPolicies) {
    switch (policy.name) {
      case 'content-length':
        if (localSize !== headBase.contentLength) {
          throw new Error(`Content-Length check failed: local=${localSize}, remote=${headBase.contentLength}`)
        }
        break

      case 'etag':
        if (!policy.expectedEtag) {
          throw new Error(`ETag policy requires expectedEtag`)
        }
        // conditional HEAD
        const headCond = await fetchHead(path2, { 'If-None-Match': policy.expectedEtag })
        if (headCond.status === 304 || headCond.etag === policy.expectedEtag) {
          break
        }
        throw new Error(`ETag check failed: expected=${policy.expectedEtag}, remote=${headCond.etag}`)

      case 'partial-hash':
        {
          const lp = await hashPartial(path1)
          const rp = await remotePartialHash(path2)
          if (lp !== rp) {
            throw new Error(`Partial-hash check failed: local=${lp}, remote=${rp}`)
          }
        }
        break

      case 'stream-hash':
        {
          const lh = await smartHash(path1)
          const rh = await streamHashFromUrl(path2)
          if (lh !== rh) {
            throw new Error(`Stream-hash check failed: local=${lh}, remote=${rh}`)
          }
        }
        break

      case 'stream-buffer-compare':
        await streamBufferCompare(path1, path2)
        break

      case 'download-buffer':
        {
          const tmpFile = path.join(__dirname, `../temp/${Date.now()}_${path.basename(path2)}`)
          await downloadRemoteFile(path2, tmpFile)
          try {
            await compareFilesByBuffer(path1, tmpFile)
          } finally {
            await fsp.unlink(tmpFile)
          }
        }
        break

      case 'download-hash':
        {
          const tmpFile = path.join(__dirname, `../temp/${Date.now()}_${path.basename(path2)}`)
          await downloadRemoteFile(path2, tmpFile)
          try {
            const lh = await smartHash(path1)
            const rh = await fullHash(tmpFile)
            if (lh !== rh) {
              throw new Error(`Download-hash check failed: local=${lh}, remote=${rh}`)
            }
          } finally {
            await fsp.unlink(tmpFile)
          }
        }
        break
    }
    // if we reach here, this policy passed—continue to next
  }
}
