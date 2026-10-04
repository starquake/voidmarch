// Bundles the client into internal/web/static/js. Phaser and the protobuf
// runtime are separate vendor modules, kept external, so the committed game
// bundle stays small and its diffs readable; vendor files change only when
// a dependency is bumped.
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

import * as esbuild from 'esbuild';

const root = import.meta.dirname;
const { values } = parseArgs({
  options: {
    watch: { type: 'boolean', default: false },
    outdir: { type: 'string', default: path.join(root, '../internal/web/static/js') },
    // Where to write the npm packages the bundle ships, for THIRD-PARTY.md (#196).
    packages: { type: 'string' },
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

/** The npm package an esbuild input path belongs to, if any. */
function packageOf(input) {
  const match = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input);

  return match?.[1];
}

/** Phaser ships as a copied file rather than through esbuild, so it's named here. */
const shipped = new Set(['phaser']);
const collect = (result) => {
  for (const input of Object.keys(result.metafile?.inputs ?? {})) {
    const name = packageOf(input);
    if (name !== undefined) {
      shipped.add(name);
    }
  }
};

collect(await esbuild.build({ ...protobufVendor, metafile: true }));

if (values.watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  collect(await esbuild.build({ ...options, metafile: true }));
  if (values.packages !== undefined) {
    await writeFile(values.packages, `${JSON.stringify([...shipped].sort(), null, 2)}\n`);
  }
}
