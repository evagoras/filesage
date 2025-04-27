# FileSage

![CI](https://github.com/yourusername/filesage/actions/workflows/ci.yml/badge.svg)
![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green)
![License](https://img.shields.io/badge/license-MIT-blue)

Smart, safe, and scalable file comparison toolkit.

## Install

npm install filesage

## Usage

import { expectFilesToBeEqual } from 'filesage'

await expectFilesToBeEqual('path/to/file1', 'path/to/file2')

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
