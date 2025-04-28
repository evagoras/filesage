# FileSage

[![CI](https://github.com/evagoras/filesage/actions/workflows/ci.yml/badge.svg)](https://github.com/evagoras/filesage/actions/workflows/ci.yml)
![Node.js](https://img.shields.io/badge/node-%3E%3D22.0.0-green)
![License](https://img.shields.io/badge/license-MIT-blue)

Smart, safe, and scalable file comparison toolkit for Node.js and TypeScript projects.

## Install

npm install filesage

## Usage

```typescript
import { expectFilesToBeEqual } from 'filesage'

await expectFilesToBeEqual('path/to/file1', 'path/to/file2')
```

✅ Works for:
- Local vs Local files
- Local vs Remote URL files

## ⚙️ Configuration

FileSage allows you to customize internal performance thresholds easily.

### Default thresholds

Setting | Default Value | Description
:-------|:--------------|:-----------
textMaxSizeBytes | 50 KB | Max size for fast text compare (string)
binaryMaxSizeBytes | 100 KB | Max size for fast binary compare (buffer)
preferPartialHash | true | Use partial hashing instead of full hashing
remoteComparisonStrategies | ['etag', 'content-length', 'partial-hash', 'stream-hash'] | Strategies for remote URL comparison
remoteTimeoutMs | 8000 | Timeout for remote HEAD/GET requests (ms)
remoteMaxRetries | 2 | Retries for remote requests
partialHashChunkSize | 64 KB | Size of chunks used for partial hashes
chunkCompareSize | 512 KB | Chunk size for stream-buffer comparisons
mimeTypeCheckEnabled | false | Check MIME types for text vs binary

---

### How to customize

You can override the defaults globally in your project:

```typescript
import { FileSageConfig } from 'filesage'

// Example: Increase text threshold to 80 KB
FileSageConfig.textMaxSizeBytes = 80 * 1024

// Example: Use full hashing instead of partial
FileSageConfig.preferPartialHash = false

// Example: Customize remote comparison strategies
FileSageConfig.remoteComparisonStrategies = ['etag', 'content-length', 'stream-buffer-compare']
```

✅ Configuration changes apply immediately for all future file comparisons.
✅ No rebuild or restart is necessary.

Or use the helper function:

```typescript
import { configureFileSage } from 'filesage'

configureFileSage({
  textMaxSizeBytes: 80 * 1024,
  remoteTimeoutMs: 10000,
  preferPartialHash: false
})
```

---

## 📚 Remote File Comparison Strategies

When comparing a local file to a remote URL, FileSage uses these strategies:

Strategy | Meaning
:--------|:-------
etag | Compare using ETag header
content-length | Compare file sizes
partial-hash | Compare partial SHA256 hash
stream-hash | Compare full streamed hash
stream-buffer-compare | Compare streamed chunks directly
download-buffer | Download remote file and compare by buffer
download-hash | Download remote file and compare by hash

✅ You can customize the priority and order of strategies!
✅ FileSage will try them in order until one matches.

---

## Features

- Text and binary file support
- Smart small/large file handling
- Remote URL vs local file comparison
- Automatic fallback strategies
- Strict TypeScript with excellent types
- Playwright-tested
- MIT License

---

## Related Tools

- FileSage Dev Tools — Benchmark and tune file comparisons.

---

## License

MIT
