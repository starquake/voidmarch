// Bundles the client into internal/web/static/js. Phaser and the protobuf
// runtime are separate vendor modules, kept external, so the committed game
// bundle stays small and its diffs readable; vendor files change only when
// a dependency is bumped.
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

import * as esbuild from 'esbuild';

const root = import.meta.dirname;
const { values } = parseArgs({
  options: {
    watch: { type: 'boolean', default: false },
    outdir: { type: 'string', default: path.join(root, '../internal/web/static/js') },
  },
});
const outdir = path.resolve(values.outdir);

/** Bare imports served as vendor modules, and the file each maps to. */
const VENDOR = {
  phaser: './vendor/phaser.js',
  '@bufbuild/protobuf': './vendor/protobuf.js',
  '@bufbuild/protobuf/codegenv2': './vendor/protobuf-codegenv2.js',
};

/** @type {esbuild.Plugin} */
const vendorExternal = {
  name: 'vendor-external',
  setup(build) {
    build.onResolve({ filter: /^(phaser|@bufbuild\/protobuf(\/codegenv2)?)$/ }, (args) => ({
      path: VENDOR[/** @type {keyof typeof VENDOR} */ (args.path)],
      external: true,
    }));
  },
};

/** @type {esbuild.BuildOptions} */
const protobufVendor = {
  absWorkingDir: root,
  entryPoints: [
    { in: '@bufbuild/protobuf', out: 'protobuf' },
    { in: '@bufbuild/protobuf/codegenv2', out: 'protobuf-codegenv2' },
  ],
  outdir: path.join(outdir, 'vendor'),
  // One shared runtime chunk, so both entry points see the same registry.
  splitting: true,
  chunkNames: 'protobuf-[hash]',
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2022',
  legalComments: 'none',
  logLevel: 'info',
};

/** @type {esbuild.BuildOptions} */
const options = {
  entryPoints: [path.join(root, 'src/main.ts')],
  outfile: path.join(outdir, 'main.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  legalComments: 'none',
  plugins: [vendorExternal],
  logLevel: 'info',
};

await mkdir(path.join(outdir, 'vendor'), { recursive: true });
await copyFile(
  path.join(root, 'node_modules/phaser/dist/phaser.esm.min.js'),
  path.join(outdir, 'vendor/phaser.js'),
);

await esbuild.build(protobufVendor);

if (values.watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
