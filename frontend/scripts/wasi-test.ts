/**
 * Runs a Go test binary built for WASI (tinygo test -c -target=wasip1) in
 * Node, with the package directory as its working directory, and exits with
 * its status. Usage: node scripts/wasi-test.ts <test.wasm> <package dir> [flags...]
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { WASI } from 'node:wasi';

const [wasmPath, packageDir, ...flags] = process.argv.slice(2);
if (wasmPath === undefined || packageDir === undefined) {
  console.error('usage: node scripts/wasi-test.ts <test.wasm> <package dir> [flags...]');
  process.exit(2);
}

const wasi = new WASI({
  version: 'preview1',
  args: ['test.wasm', ...flags],
  env: { PWD: '/' },
  preopens: { '/': resolve(packageDir) },
  returnOnExit: true,
});
const module = await WebAssembly.compile(await readFile(wasmPath));
const instance = await WebAssembly.instantiate(module, wasi.getImportObject());
process.exit(wasi.start(instance));
