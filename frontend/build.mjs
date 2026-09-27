// Bundles the client into internal/web/static/js. Phaser is copied as a
// separate vendor module and kept external, so the committed game bundle
// stays small and its diffs readable.
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

/** @type {esbuild.Plugin} */
const phaserExternal = {
  name: 'phaser-external',
  setup(build) {
    build.onResolve({ filter: /^phaser$/ }, () => ({ path: './vendor/phaser.js', external: true }));
  },
};

/** @type {esbuild.BuildOptions} */
const options = {
  entryPoints: [path.join(root, 'src/main.ts')],
  outfile: path.join(outdir, 'main.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  legalComments: 'none',
  plugins: [phaserExternal],
  logLevel: 'info',
};

await mkdir(path.join(outdir, 'vendor'), { recursive: true });
await copyFile(
  path.join(root, 'node_modules/phaser/dist/phaser.esm.min.js'),
  path.join(outdir, 'vendor/phaser.js'),
);

if (values.watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
