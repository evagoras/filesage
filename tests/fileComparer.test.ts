// fileComparer.test.ts
import { test, expect } from '@playwright/test'
import * as fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import { Readable } from 'stream'
import axios, { AxiosRequestConfig } from 'axios'
import { createHash } from 'crypto'
import { expectFilesToBeEqual, FileSageConfig } from '../src/fileComparer'

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
  axios.head = async () => ({ headers } as any)
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
  for (const f of await fs.readdir(tmp)) {
    await fs.unlink(path.join(tmp, f))
  }
  await fs.rmdir(tmp)
  FileSageConfig.remoteComparisonStrategies = [
    'content-length','etag','partial-hash','stream-hash','stream-buffer-compare','download-buffer','download-hash'
  ]
  FileSageConfig.partialHashChunkSize = 64 * 1024
})

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

test('local binary mismatch', async () => {
  const p1 = path.join(tmp, 'a.bin')
  const p2 = path.join(tmp, 'b.bin')
  await fs.writeFile(p1, sampleBuffer)
  await fs.writeFile(p2, Buffer.from([9,8,7]))
  await expect(expectFilesToBeEqual(p1, p2)).rejects.toThrow(/Size mismatch/)
})

test('remote content-length strategy', async () => {
  const { p1 } = await makeFiles('c.txt', sampleText)
  stubAxiosHead({ 'content-length': String(Buffer.byteLength(sampleText)) })
  await expectFilesToBeEqual(p1, 'http://example.com/remote.txt')
})

test('remote etag strategy', async () => {
  const { p1 } = await makeFiles('d.txt', sampleText)
  const localHash = createHash('sha256').update(Buffer.from(sampleText)).digest('hex')
  stubAxiosHead({ 'content-length': '0', etag: localHash })
  await expectFilesToBeEqual(p1, 'http://example.com/remote.txt')
})

test('remote partial-hash strategy', async () => {
  const { p1 } = await makeFiles('e.txt', Buffer.from('abcdefghij'))
  FileSageConfig.remoteComparisonStrategies = ['partial-hash']
  FileSageConfig.partialHashChunkSize = 3
  axios.get = async (_url: string, opts: AxiosRequestConfig = {}) => {
    const range = (opts.headers?.Range as string) || ''
    if (range === 'bytes=0-2') {
      return { data: Buffer.from('abc'), headers: { 'content-range': 'bytes 3/10' } } as any
    } else {
      return { data: Buffer.from('hij'), headers: { 'content-range': 'bytes 3/10' } } as any
    }
  }
  await expectFilesToBeEqual(p1, 'http://example.com/remote.txt')
})

test('remote stream-hash strategy', async () => {
  const { p1 } = await makeFiles('f.txt', sampleText)
  FileSageConfig.remoteComparisonStrategies = ['stream-hash']
  stubAxiosGetMixed(Buffer.from(sampleText))
  await expectFilesToBeEqual(p1, 'http://example.com/remote.txt')
})

test('remote stream-buffer-compare strategy', async () => {
  const buf = Buffer.from('1234567890')
  const { p1 } = await makeFiles('g.bin', buf)
  FileSageConfig.remoteComparisonStrategies = ['stream-buffer-compare']
  stubAxiosGetMixed(buf)
  await expectFilesToBeEqual(p1, 'http://example.com/remote.bin')
})

test('remote download-buffer & download-hash', async () => {
  const buf = Buffer.from([1,2,3])
  const { p1 } = await makeFiles('h.bin', buf)
  FileSageConfig.remoteComparisonStrategies = ['download-buffer','download-hash']
  stubAxiosGetMixed(buf)
  await expectFilesToBeEqual(p1, 'http://example.com/remote.bin')
})

test('no matching strategy throws', async () => {
  const { p1 } = await makeFiles('i.txt', sampleText)
  FileSageConfig.remoteComparisonStrategies = ['content-length']
  stubAxiosHead({ 'content-length': '0' })
  await expect(expectFilesToBeEqual(p1, 'http://example.com/remote.txt'))
    .rejects.toThrow(/No remote match/)
})
