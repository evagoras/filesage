// fileComparer.test.ts
import { test, expect } from '@playwright/test'
import * as fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import { Readable } from 'stream'
import axios, { AxiosRequestConfig } from 'axios'
import { createHash } from 'crypto'
import { expectFilesToBeEqual, FileSageConfig, ComparisonPolicy } from '../src/fileComparer'

// Default remote comparison policies for resetting config
const defaultPolicies: ComparisonPolicy[] = [
  { name: 'content-length' },
  { name: 'etag', expectedEtag: '' },
  { name: 'partial-hash' },
  { name: 'stream-hash' },
  { name: 'stream-buffer-compare' },
  { name: 'download-buffer' },
  { name: 'download-hash' }
]

const tmp = path.join(__dirname, 'temp')
const remoteTemp = path.join(__dirname, '../temp')
const sampleText = 'Hello, FileSage!'
const sampleBuffer = Buffer.from([0, 1, 2, 3, 4, 5])

// ensure FileSage's temp dir exists
test.beforeAll(() => {
  fsSync.mkdirSync(remoteTemp, { recursive: true })
})

// clean up FileSage temp dir
test.afterAll(() => {
  try { fsSync.rmdirSync(remoteTemp) } catch {}
})

// Helper: write & copy a pair of files
async function makeFiles(name: string, content: string | Buffer) {
  const p1 = path.join(tmp, `${name}1`)
  const p2 = path.join(tmp, `${name}2`)
  await fs.writeFile(p1, content)
  await fs.writeFile(p2, content)
  return { p1, p2 }
}

// Stub HEAD responses
function stubAxiosHead(headers: Record<string, string>) {
  axios.head = async () => ({ status: 200, headers } as any)
}

// Stub GET for stream and download
function stubAxiosGetMixed(data: Buffer, headers: Record<string,string> = {}) {
  axios.get = async (_url: string, opts: AxiosRequestConfig = {}) => {
    if (opts.responseType === 'stream') {
      return { data: Readable.from([data]) } as any
    } else {
      return { data: data.buffer, headers } as any
    }
  }
}

test.beforeEach(async () => {
  await fs.mkdir(tmp, { recursive: true })
})

test.afterEach(async () => {
  // clean up temp
  for (const f of await fs.readdir(tmp)) {
    await fs.unlink(path.join(tmp, f))
  }
  await fs.rmdir(tmp)
  // reset config
  FileSageConfig.remoteComparisonPolicies = [...defaultPolicies]
  FileSageConfig.partialHashChunkSize = 64 * 1024
  FileSageConfig.mimeTypeCheckEnabled = false
  FileSageConfig.preferPartialHash = true
})

// Local comparisons
test('local text match', async () => {
  const { p1, p2 } = await makeFiles('test.txt', sampleText)
  await expectFilesToBeEqual(p1, p2)
})

test('local text mismatch', async () => {
  const p1 = path.join(tmp, 'a.txt')
  const p2 = path.join(tmp, 'b.txt')
  await fs.writeFile(p1, 'foo')
  await fs.writeFile(p2, 'bar')
  await expect(expectFilesToBeEqual(p1, p2)).rejects.toThrow(/Text contents differ/)
})

test('local binary match', async () => {
  const { p1, p2 } = await makeFiles('test.bin', sampleBuffer)
  await expectFilesToBeEqual(p1, p2)
})

test('local binary mismatch by size', async () => {
  const p1 = path.join(tmp, 'a.bin')
  const p2 = path.join(tmp, 'b.bin')
  await fs.writeFile(p1, sampleBuffer)
  await fs.writeFile(p2, Buffer.from([9,8,7]))
  await expect(expectFilesToBeEqual(p1, p2)).rejects.toThrow(/Size mismatch/)
})

// Remote content-length
test('remote content-length match', async () => {
  const { p1 } = await makeFiles('c.txt', sampleText)
  // isolate only content-length policy
  FileSageConfig.remoteComparisonPolicies = [{ name: 'content-length' }]
  stubAxiosHead({ 'content-length': String(Buffer.byteLength(sampleText)) })
  await expectFilesToBeEqual(p1, 'http://example.com/remote.txt')
})

test('remote content-length mismatch', async () => {
  const { p1 } = await makeFiles('c2.txt', sampleText)
  // isolate only content-length policy
  FileSageConfig.remoteComparisonPolicies = [{ name: 'content-length' }]
  stubAxiosHead({ 'content-length': '0' })
  await expect(expectFilesToBeEqual(p1, 'http://example.com/remote.txt'))
    .rejects.toThrow(/Content-Length check failed/)
})

// Remote ETag
test('remote etag requires expectedEtag throws', async () => {
  const { p1 } = await makeFiles('d1.txt', sampleText)
  FileSageConfig.remoteComparisonPolicies = [{ name: 'etag', expectedEtag: '' }]
  stubAxiosHead({ etag: 'abc' })
  await expect(expectFilesToBeEqual(p1, 'http://example.com/remote.txt'))
    .rejects.toThrow(/ETag policy requires expectedEtag/)
})

test('remote etag match', async () => {
  const { p1 } = await makeFiles('d2.txt', sampleText)
  const localHash = createHash('sha256').update(Buffer.from(sampleText)).digest('hex')
  FileSageConfig.remoteComparisonPolicies = [{ name: 'etag', expectedEtag: localHash }]
  stubAxiosHead({ etag: localHash })
  await expectFilesToBeEqual(p1, 'http://example.com/remote.txt')
})

test('remote etag mismatch', async () => {
  const { p1 } = await makeFiles('d3.txt', sampleText)
  FileSageConfig.remoteComparisonPolicies = [{ name: 'etag', expectedEtag: 'wrong' }]
  stubAxiosHead({ etag: 'right' })
  await expect(expectFilesToBeEqual(p1, 'http://example.com/remote.txt'))
    .rejects.toThrow(/ETag check failed/)
})

// Remote partial-hash
test('remote partial-hash match', async () => {
  const buf = Buffer.from('abcdefghij')
  const { p1 } = await makeFiles('e1.txt', buf)
  FileSageConfig.remoteComparisonPolicies = [{ name: 'partial-hash' }]
  FileSageConfig.partialHashChunkSize = 3
  axios.get = async (_url: string, opts: AxiosRequestConfig = {}) => {
    const range = (opts.headers?.Range as string) || ''
    if (range === 'bytes=0-2') {
      return { data: Buffer.from('abc'), headers: { 'content-range': 'bytes 0-2/10' } } as any
    } else {
      return { data: Buffer.from('hij'), headers: { 'content-range': 'bytes 7-9/10' } } as any
    }
  }
  await expectFilesToBeEqual(p1, 'http://example.com/remote.txt')
})

test('remote partial-hash mismatch', async () => {
  const buf = Buffer.from('abcdefghij')
  const { p1 } = await makeFiles('e2.txt', buf)
  FileSageConfig.remoteComparisonPolicies = [{ name: 'partial-hash' }]
  FileSageConfig.partialHashChunkSize = 3
  axios.get = async (_url: string, opts: AxiosRequestConfig = {}) => {
    const range = (opts.headers?.Range as string) || ''
    if (range === 'bytes=0-2') {
      return { data: Buffer.from('abc'), headers: { 'content-range': 'bytes 0-2/10' } } as any
    } else {
      return { data: Buffer.from('hii'), headers: { 'content-range': 'bytes 7-9/10' } } as any
    }
  }
  await expect(expectFilesToBeEqual(p1, 'http://example.com/remote.txt'))
    .rejects.toThrow(/Partial-hash check failed/)
})

// Remote stream-hash
test('remote stream-hash match', async () => {
  const { p1 } = await makeFiles('f.txt', sampleText)
  FileSageConfig.remoteComparisonPolicies = [{ name: 'stream-hash' }]
  stubAxiosGetMixed(Buffer.from(sampleText))
  await expectFilesToBeEqual(p1, 'http://example.com/remote.txt')
})

test('remote stream-hash mismatch', async () => {
  const { p1 } = await makeFiles('f2.txt', sampleText)
  FileSageConfig.remoteComparisonPolicies = [{ name: 'stream-hash' }]
  stubAxiosGetMixed(Buffer.from('other text'))
  await expect(expectFilesToBeEqual(p1, 'http://example.com/remote.txt'))
    .rejects.toThrow(/Stream-hash check failed/)
})

// Remote stream-buffer-compare
test('remote stream-buffer-compare match', async () => {
  const buf = Buffer.from('1234567890')
  const { p1 } = await makeFiles('g1.bin', buf)
  FileSageConfig.remoteComparisonPolicies = [{ name: 'stream-buffer-compare' }]
  stubAxiosGetMixed(buf)
  await expectFilesToBeEqual(p1, 'http://example.com/remote.bin')
})

test('remote stream-buffer-compare mismatch', async () => {
  const { p1 } = await makeFiles('g2.bin', Buffer.from('abcd'))
  FileSageConfig.remoteComparisonPolicies = [{ name: 'stream-buffer-compare' }]
  stubAxiosGetMixed(Buffer.from('efgh'))
  await expect(expectFilesToBeEqual(p1, 'http://example.com/remote.bin'))
    .rejects.toThrow(/Stream chunk mismatch/)
})

// Remote download-buffer
test('remote download-buffer match', async () => {
  const buf = Buffer.from([1,2,3])
  const { p1 } = await makeFiles('h1.bin', buf)
  FileSageConfig.remoteComparisonPolicies = [{ name: 'download-buffer' }]
  stubAxiosGetMixed(buf)
  await expectFilesToBeEqual(p1, 'http://example.com/remote.bin')
})

test('remote download-buffer mismatch', async () => {
  const { p1 } = await makeFiles('h2.bin', Buffer.from([1,2,3]))
  FileSageConfig.remoteComparisonPolicies = [{ name: 'download-buffer' }]
  stubAxiosGetMixed(Buffer.from([4,5,6]))
  await expect(expectFilesToBeEqual(p1, 'http://example.com/remote.bin'))
    .rejects.toThrow(/Binary contents differ/)
})

// Remote download-hash
test('remote download-hash match', async () => {
  const buf = Buffer.from([9,8,7])
  const { p1 } = await makeFiles('h3.bin', buf)
  FileSageConfig.remoteComparisonPolicies = [{ name: 'download-hash' }]
  stubAxiosGetMixed(buf)
  await expectFilesToBeEqual(p1, 'http://example.com/remote.bin')
})

test('remote download-hash mismatch', async () => {
  const { p1 } = await makeFiles('h4.bin', Buffer.from([9,8,7]))
  FileSageConfig.remoteComparisonPolicies = [{ name: 'download-hash' }]
  stubAxiosGetMixed(Buffer.from([7,8,9]))
  await expect(expectFilesToBeEqual(p1, 'http://example.com/remote.bin'))
    .rejects.toThrow(/Download-hash check failed/)
})

// MIME type check
test('remote mime-type mismatch', async () => {
  // create a .txt file so isTextFile() recognizes it
  const p1 = path.join(tmp, 'm1.txt')
  await fs.writeFile(p1, 'text file')
  FileSageConfig.remoteComparisonPolicies = [{ name: 'content-length' }]
  FileSageConfig.mimeTypeCheckEnabled = true
  stubAxiosHead({
    'content-length': String(Buffer.byteLength('text file')),
    'content-type': 'application/octet-stream'
  })
  await expect(expectFilesToBeEqual(p1, 'http://example.com/remote.txt'))
    .rejects.toThrow(/MIME mismatch/)
})
