// @ts-check

import { test, expect } from '@playwright/test'
import { expectFilesToBeEqual } from '../src/fileComparer'
import { promises as fs } from 'fs'
import path from 'path'

let tempDir: string

test.beforeEach(async () => {
  tempDir = path.join(__dirname, 'temp')
  await fs.mkdir(tempDir, { recursive: true })
})

test.afterEach(async () => {
  const files = await fs.readdir(tempDir)
  await Promise.all(files.map(file => fs.unlink(path.join(tempDir, file))))
  await fs.rmdir(tempDir)
})

test('should confirm two identical text files are equal', async () => {
  const file1 = path.join(tempDir, 'test1.txt')
  const file2 = path.join(tempDir, 'test2.txt')

  await fs.writeFile(file1, 'Hello World!')
  await fs.copyFile(file1, file2)

  await expectFilesToBeEqual(file1, file2)
})

test('should confirm two identical binary files are equal', async () => {
  const file1 = path.join(tempDir, 'test1.pdf')
  const file2 = path.join(tempDir, 'test2.pdf')

  const buffer = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9])
  await fs.writeFile(file1, buffer)
  await fs.copyFile(file1, file2)

  await expectFilesToBeEqual(file1, file2)
})

test('should compare local vs remote file by buffer', async () => {
  const localPath = './assets/sample1.png'
  const remoteUrl = 'https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png'

  await expectFilesToBeEqual(localPath, remoteUrl)
})
