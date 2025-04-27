# FileSage

[![CI](https://github.com/evagoras/filesage/actions/workflows/ci.yml/badge.svg)](https://github.com/evagoras/filesage/actions/workflows/ci.yml)
![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-green)
![License](https://img.shields.io/badge/license-MIT-blue)

Smart, safe, and scalable file comparison toolkit for Node.js and TypeScript projects.

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
