# FileSage

[![CI](https://github.com/evagoras/filesage/actions/workflows/ci.yml/badge.svg)](https://github.com/evagoras/filesage/actions/workflows/ci.yml)
![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-green)
![License](https://img.shields.io/badge/license-MIT-blue)

Smart, safe, and scalable file comparison toolkit for Node.js and TypeScript projects.

## Install

`npm install filesage`

## Usage

```typescript
import { expectFilesToBeEqual } from 'filesage'

await expectFilesToBeEqual('path/to/file1', 'path/to/file2')
```

## ⚙️ Configuration

FileSage allows you to customize internal performance thresholds easily.

### Default thresholds

| Setting | Default Value |
|:--------|:--------------|
| `textMaxSizeBytes` | 50 KB |
| `binaryMaxSizeBytes` | 100 KB |

These thresholds determine when FileSage switches comparison strategies.

---

### How to customize

You can override the defaults globally in your project:

```typescript
import { FileSageConfig } from 'filesage'

// Increase text file string-compare threshold to 80KB
FileSageConfig.textMaxSizeBytes = 80 * 1024

// Increase binary file threshold to 200KB
FileSageConfig.binaryMaxSizeBytes = 200 * 1024
```
Or use the helper function:
```typescript
import { configureFileSage } from 'filesage'

configureFileSage({
  textMaxSizeBytes: 80 * 1024,
  binaryMaxSizeBytes: 200 * 1024
})
```
✅ Configuration changes apply immediately for all future file comparisons.<br>
✅ No rebuild or restart is necessary.

### Important Notes
- These settings are global.
- You should configure them early in your app before using file comparison functions.

## Features

- Text and binary file support
- Smart small/large file handling
- Optimized comparison methods (string/buffer/hash)
- Written in strict TypeScript
- Playwright-tested
- MIT License

## Related Tools

For benchmarking and tuning, check out FileSage Dev Tools.

## License

MIT
