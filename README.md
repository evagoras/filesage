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

await expectFilesToBeEqual(
  'path/to/local.file',
  'path/to/other.file'
)
```

✅ Works for:
- **Local vs Local** (text or binary)
- **Local vs Remote URL**

## ⚙️ Configuration
FileSage lets you tailor exactly which checks run (and in what order) when comparing to a **remote URL**.

### Default Configuration

| Setting | Default Value | Description |
|-|-|-|
| `comparisonPolicies`   | [<br>&nbsp;&nbsp;&nbsp;&nbsp;{ name: 'content-length' },<br>&nbsp;&nbsp;&nbsp;&nbsp;{ name: 'etag', expectedEtag: '' },<br>&nbsp;&nbsp;&nbsp;&nbsp;{ name: 'partial-hash' },<br>&nbsp;&nbsp;&nbsp;&nbsp;{ name: 'stream-hash' },<br>&nbsp;&nbsp;&nbsp;&nbsp;{ name: 'stream-buffer-compare' },<br>&nbsp;&nbsp;&nbsp;&nbsp;{ name: 'download-buffer' },<br>&nbsp;&nbsp;&nbsp;&nbsp;{ name: 'download-hash' }<br>] | Which policies to try, in order—first failure throws  |
| `remoteTimeoutMs` | `8000` | HTTP HEAD/GET timeout (ms) |
| `remoteMaxRetries` | `2` | Retries for transient network errors |
| `partialHashChunkSize` | `64 * 1024` (64 KB) | Byte count for head/tail ranges in partial-hash |
| `chunkCompareSize` | `512 * 1024` (512 KB) | Chunk size for stream-buffer compares |
| `mimeTypeCheckEnabled` | `false` | Enforce MIME subtype match |
| `preferPartialHash` | `true` | Use partial-hash locally instead of full hash |

### Global Overrides
You can override **any** of these at runtime—no rebuild or restart needed:

```typescript
import { configureFileSage } from 'filesage'

configureFileSage({
  remoteTimeoutMs: 10000,
  preferPartialHash: false,
  comparisonPolicies: [
    { name: 'etag', expectedEtag: 'abcdef123456...' },
    { name: 'content-length' }
  ]
})
```
Or mutate the config object directly:

```typescript
import { FileSageConfig } from 'filesage'

FileSageConfig.comparisonPolicies = [
  { name: 'content-length' },
  { name: 'etag', expectedEtag: 'abcdef123456...' },
]
FileSageConfig.remoteMaxRetries = 3
```

## 📚 Remote Comparison Policies
Each policy is tried in **order**. The first one that **fails** will throw; if it passes, FileSage moves on to the next.

| Policy                  | Notes                                                                     |
|-------------------------|---------------------------------------------------------------------------|
| `content-length`        | Compare local byte-length to Content-Length header                        |
| `etag`                  | Send If-None-Match: <expectedEtag> and accept 304 or matching ETag header |
| `partial-hash`          | Fetch only head + tail chunk via HTTP Range and compare SHA-256           |
| `stream-hash`           | Stream entire file via HTTP and compare SHA-256 digests                   |
| `stream-buffer-compare` | Stream chunks in parallel and compare Buffer.equals()                     |
| `download-buffer`       | Download full file into buffer, then compare Buffer.equals()              |
| `download-hash`         | Download full file, compute SHA-256, and compare                          |

## Examples

### 1) Local vs Local
```typescript
import { expectFilesToBeEqual } from 'filesage'

await expectFilesToBeEqual(
  'tests/foo.txt',
  'tests/foo-copy.txt'
)
```
### 2) CONTENT-LENGTH Only
```typescript
import { FileSageConfig, expectFilesToBeEqual } from 'filesage'

FileSageConfig.comparisonPolicies = [
  { name: 'content-length' }
]

await expectFilesToBeEqual(
  'local.bin',
  'https://example.com/file.bin'
)
```

### 3) ETAG Only
```typescript
FileSageConfig.comparisonPolicies = [
  { name: 'etag', expectedEtag: '79e0a0933c7…' }
]

await expectFilesToBeEqual(
  'local.txt',
  'https://raw.githubusercontent.com/…/file.txt'
)
```

### 4) PARTIAL-HASH Only
```typescript
FileSageConfig.comparisonPolicies = [
  { name: 'partial-hash' }
]

await expectFilesToBeEqual(
  'large-local.txt',
  'https://example.com/large.txt'
)
```

### 5) STREAM-HASH Only
```typescript
FileSageConfig.comparisonPolicies = [
  { name: 'stream-hash' }
]

await expectFilesToBeEqual(
  'large-local.bin',
  'https://example.com/large.bin'
)
```

### 6) STREAM-BUFFER-COMPARE Only
```typescript
FileSageConfig.comparisonPolicies = [
  { name: 'stream-buffer-compare' }
]

await expectFilesToBeEqual(
  'large-local.bin',
  'https://example.com/large.bin'
)
```

### 7) DOWNLOAD-BUFFER Only
```typescript
FileSageConfig.comparisonPolicies = [
  { name: 'download-buffer' }
]

await expectFilesToBeEqual(
  'local.bin',
  'https://example.com/large.bin'
)
```

### 8) DOWNLOAD-HASH Only
```typescript
FileSageConfig.comparisonPolicies = [
  { name: 'download-hash' }
]

await expectFilesToBeEqual(
  'local.bin',
  'https://example.com/large.bin'
)
```

### 9) Mix & Match
```typescript
FileSageConfig.comparisonPolicies = [
  { name: 'etag',           expectedEtag: 'abc123…' },
  { name: 'content-length'  },
  { name: 'partial-hash'    },
  { name: 'stream-hash'     }
]

await expectFilesToBeEqual(
  'local.data',
  'https://example.com/data'
)
```

## Features
- Local vs Local: text or binary, exact compare
- Local vs Remote: fine-grained, prioritized policies
- Low-memory: stream comparisons for huge files
- TypeScript: full types, Node v22+
- Playwright-tested: reliable end-to-end behavior

## Related Tools
- FileSage Dev Tools — Benchmark & tune file comparison.

## License
MIT 