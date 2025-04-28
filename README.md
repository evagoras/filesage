# FileSage

[![CI](https://github.com/evagoras/filesage/actions/workflows/ci.yml/badge.svg)](https://github.com/evagoras/filesage/actions/workflows/ci.yml)
![Node.js](https://img.shields.io/badge/node-%3E%3D22.0.0-green)
![License](https://img.shields.io/badge/license-MIT-blue)

Smart, safe, and scalable file comparison toolkit for Node.js and TypeScript projects.

## Install

```bash
npm install filesage
```

## Usage

```typescript
import { expectFilesToBeEqual } from 'filesage'

await expectFilesToBeEqual('path/to/file1', 'path/to/file2')
```

✅ Works for:
- Local vs Local files (text or binary)
- Local vs Remote URL files

## ⚙️ Configuration

FileSage lets you tailor comparison behavior to your needs.

### Default Configuration

| Setting                      | Default Value                                                                                                 | Description                                            |
|------------------------------|---------------------------------------------------------------------------------------------------------------|--------------------------------------------------------|
| `remoteComparisonStrategies` | `['content-length','etag','partial-hash','stream-hash','stream-buffer-compare','download-buffer','download-hash']` | Order and priority of remote comparison strategies     |
| `remoteTimeoutMs`            | `8000`                                                                                                        | Timeout for HTTP HEAD/GET requests (milliseconds)      |
| `remoteMaxRetries`           | `2`                                                                                                           | Number of retries for transient network errors         |
| `partialHashChunkSize`       | `64 KB`                                                                                                       | Byte count for head/tail ranges in partial-hash       |
| `chunkCompareSize`           | `512 KB`                                                                                                      | Chunk size for streaming chunk-wise buffer compares   |
| `mimeTypeCheckEnabled`       | `false`                                                                                                       | Enforce MIME type matching between local & remote      |
| `preferPartialHash`          | `true`                                                                                                        | Use partial-hash locally instead of full-file hashing |

---

### Customization

You can override configuration globally, e.g.:  

```typescript
import { configureFileSage } from 'filesage'

configureFileSage({
  remoteTimeoutMs: 10000,
  preferPartialHash: false,
  remoteComparisonStrategies: ['etag', 'content-length', 'download-hash']
})
```

Or directly modify the config object:

```typescript
import { FileSageConfig } from 'filesage'

FileSageConfig.remoteComparisonStrategies = [
  'etag',
  'content-length',
  'partial-hash'
]
FileSageConfig.remoteMaxRetries = 3
```

No restart or rebuild is required—changes apply immediately.

---

## 📚 Remote File Comparison Strategies

| Strategy                 | Description                                                                                             |
|--------------------------|---------------------------------------------------------------------------------------------------------|
| `etag`                   | Compare local SHA (or partial SHA) to the server’s ETag header                                         |
| `content-length`         | Compare local file size to server’s `Content-Length` header                                            |
| `partial-hash`           | Fetch only head + tail byte ranges, hash them, and compare                                             |
| `stream-hash`            | Stream entire file through SHA-256 and compare digests                                                  |
| `stream-buffer-compare`  | Stream local and remote in parallel, compare each chunk                                                |
| `download-buffer`        | Download full file into buffer, then `Buffer.equals(...)` for comparison                               |
| `download-hash`          | Download full file, compute SHA-256, and compare digests                                               |

✅ Strategies are tried in order until one succeeds, minimizing data transfer and CPU work.

---

## Features

- **Local vs Local**: exact text or binary comparisons (string vs buffer).
- **Local vs Remote**: pluggable strategies with configurable priority.
- **Low-memory streaming**: compare large files without full buffering.
- **Partial-hash optimization**: quick probabilistic checks for huge assets.
- **Strictly typed**: full TypeScript definitions, seamless Node.js v22+ support.
- **Playwright-tested**: end-to-end tests ensure reliability.

---

## Related Tools

- **FileSage Dev Tools** — Benchmark & tune file comparison performance.

---

## License

MIT

