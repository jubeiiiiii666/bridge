// Bundles the extension host code and assembles the PWA (web/ + vendored libs) into dist/.
import * as esbuild from 'esbuild';
import { cp, mkdir, rm, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const watch = process.argv.includes('--watch');

await rm('dist', { recursive: true, force: true });
await mkdir('dist/web/vendor', { recursive: true });

if (!existsSync('media/icon-512.png')) execFileSync(process.execPath, ['scripts/icons.mjs'], { stdio: 'inherit' });

await cp('web', 'dist/web', { recursive: true });
await cp('media', 'dist/web/icons', { recursive: true });
const vendor = {
  'preact.mjs': 'node_modules/preact/dist/preact.mjs',
  'preact-hooks.mjs': 'node_modules/preact/hooks/dist/hooks.mjs',
  'htm.mjs': 'node_modules/htm/dist/htm.mjs',
  'marked.mjs': 'node_modules/marked/lib/marked.esm.js',
  'purify.mjs': 'node_modules/dompurify/dist/purify.es.mjs',
};
for (const [name, src] of Object.entries(vendor)) await copyFile(src, `dist/web/vendor/${name}`);

const ctx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  sourcemap: true,
  // The Agent SDK is ESM and reads import.meta.url; give it a CJS equivalent.
  define: { 'import.meta.url': 'importMetaUrl' },
  inject: ['scripts/import-meta-shim.js'],
  logLevel: 'info',
});
if (watch) await ctx.watch();
else { await ctx.rebuild(); await ctx.dispose(); }

if (process.argv.includes('--dev')) {
  await esbuild.build({
    entryPoints: ['scripts/dev-server.ts'], bundle: true, platform: 'node', target: 'node22', format: 'cjs',
    outfile: 'dist/dev-server.js', define: { 'import.meta.url': 'importMetaUrl' }, inject: ['scripts/import-meta-shim.js'],
  });
}

