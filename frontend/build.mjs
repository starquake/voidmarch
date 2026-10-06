// Bundles the client into internal/web/static/js. Phaser and the protobuf
// runtime are separate vendor modules, kept external, so the committed game
// bundle stays small and its diffs readable; vendor files change only when
// a dependency is bumped. The page loads entry.js, which has none of them, and
// it imports main.js, the game (#227). Between the two, the boot files' sizes
// are written into src/bootsizes.gen.ts, which the entry carries (decision 9).
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

import * as esbuild from 'esbuild';

import { bootSizesSource } from './scripts/bootsizes.ts';

const root = import.meta.dirname;
const defaultOutdir = path.join(root, '../internal/web/static/js');
const { values } = parseArgs({
  options: {
    watch: { type: 'boolean', default: false },
    outdir: { type: 'string', default: defaultOutdir },
    // Where to write the boot files' sizes: src/bootsizes.gen.ts for the committed bundle, elsewhere for a check.
    sizes: { type: 'string' },
    // Where to write the npm packages the bundle ships, for THIRD-PARTY.md (#196).
    packages: { type: 'string' },
  },
});
const outdir = path.resolve(values.outdir);
// A build into another folder never rewrites the committed sizes.
if (outdir !== defaultOutdir && values.sizes === undefined) {
  throw new Error('--outdir needs --sizes, so the committed bootsizes.gen.ts stays as it is');
}
const sizesFile = path.resolve(values.sizes ?? path.join(root, 'src/bootsizes.gen.ts'));

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

/**
 * The entry imports the game as its own bundle, main.js, instead of bundling it in.
 * @type {esbuild.Plugin}
 */
const gameExternal = {
  name: 'game-external',
  setup(build) {
    build.onResolve({ filter: /^\.\/main\.ts$/ }, () => ({ path: './main.js', external: true }));
  },
};

/**
 * The entry shows the first screens before the vendor modules arrive, so it must not import them.
 * @type {esbuild.Plugin}
 */
const noVendor = {
  name: 'no-vendor',
  setup(build) {
    build.onResolve({ filter: /^(phaser|@bufbuild\/protobuf(\/codegenv2)?)$/ }, (args) => ({
      errors: [{ text: `the entry module must not import ${args.path} (#227): import it from main.ts's side` }],
    }));
  },
};

/** The sizes this build generates, set once the game's bundles are built. */
let sizes = '';

/**
 * The entry carries the sizes this build generated, also when they are written elsewhere for a check.
 * @type {esbuild.Plugin}
 */
const sizesFrom = {
  name: 'sizes-from',
  setup(build) {
    build.onLoad({ filter: /\/src\/bootsizes\.gen\.ts$/ }, () => ({ contents: sizes, loader: 'ts' }));
  },
};

/** @type {esbuild.BuildOptions} */
const common = {
  absWorkingDir: root,
  bundle: true,
  format: 'esm',
  target: 'es2022',
  legalComments: 'none',
  logLevel: 'info',
};

/** @type {esbuild.BuildOptions} */
const entry = {
  ...common,
  entryPoints: [path.join(root, 'src/entry.ts')],
  outfile: path.join(outdir, 'entry.js'),
  plugins: [gameExternal, noVendor, sizesFrom],
};

/** @type {esbuild.BuildOptions} */
const game = { ...common, entryPoints: [path.join(root, 'src/main.ts')], outfile: path.join(outdir, 'main.js'), plugins: [vendorExternal] };

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

  return result.metafile;
};

// The game and its vendor modules first: the entry carries their sizes.
const metafiles = [collect(await esbuild.build({ ...protobufVendor, metafile: true })), collect(await esbuild.build({ ...game, metafile: true }))];
sizes = await bootSizesSource({ jsDir: outdir, staticDir: path.join(root, '../internal/web/static'), workingDir: root, metafiles });
await writeFile(sizesFile, sizes);

if (values.watch) {
  // The sizes stay as they were at the start; make js brings them up to date.
  for (const options of [entry, game]) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
  }
} else {
  collect(await esbuild.build({ ...entry, metafile: true }));
  if (values.packages !== undefined) {
    await writeFile(values.packages, `${JSON.stringify([...shipped].sort(), null, 2)}\n`);
  }
}
