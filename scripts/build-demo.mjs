/**
 * Folds the built demo into one HTML file.
 *
 * An artifact host serves a single document: no second request is possible, so
 * every script and stylesheet has to be inside it. Vite is already told not to
 * split chunks for this build; this inlines what it did emit.
 *
 * Deliberately not a dependency — it is twenty lines of string replacement,
 * and a build step nobody can read is a build step nobody can fix.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
let html = readFileSync(join(dist, 'index.html'), 'utf8');

const assets = readdirSync(join(dist, 'assets'));
const one = (extension) => {
  const found = assets.filter((f) => f.endsWith(extension));
  if (found.length !== 1) {
    throw new Error(
      `Expected exactly one ${extension} in dist/assets, found ${found.length}: ${found.join(', ')}. ` +
        'The demo build must not split chunks — check inlineDynamicImports in vite.config.ts.',
    );
  }
  return readFileSync(join(dist, 'assets', found[0]), 'utf8');
};

/*
  Checked before the bundle goes in, not after. Eight hundred kilobytes of
  minified JavaScript contains the string "<script src=" often enough that a
  check run over the finished file only ever reports its own payload.
*/
const scriptTag = /<script[^>]*src="[^"]*\.js"[^>]*><\/script>/;
const styleTag = /<link[^>]*rel="stylesheet"[^>]*href="[^"]*\.css"[^>]*>/;
if (!scriptTag.test(html) || !styleTag.test(html)) {
  throw new Error('index.html does not look like the build this script expects.');
}

html = html.replace(scriptTag, () => `<script type="module">${one('.js')}</script>`);
html = html.replace(styleTag, () => `<style>${one('.css')}</style>`);

const shell = html.replace(/<script type="module">[\s\S]*?<\/script>/, '<script/>')
  .replace(/<style>[\s\S]*?<\/style>/, '<style/>');
if (/src="\/assets\/|href="\/assets\//.test(shell)) {
  throw new Error('Something is still loaded from a separate file; the artifact would break.');
}

/*
  The artifact wrapper supplies <!doctype>, <html>, <head> and <body>, so what
  is published is the contents of the body plus the head's own tags.
*/
// Named for what it is: the tab, the gallery card and anybody's bookmarks
// should all say demo, because this one is not the product.
const head = (html.match(/<head>([\s\S]*?)<\/head>/)?.[1] ?? '').replace(
  /<title>[^<]*<\/title>/,
  '<title>Aegis RMS Demo</title>',
);
const body = html.match(/<body>([\s\S]*?)<\/body>/)?.[1] ?? '';

/*
  The app is a 100%-height layout, which needs something to be 100% of. In the
  real deployment that is the browser window; in an artifact frame that sizes
  itself to its content, a chain of percentage heights can resolve to nothing
  and the page renders blank. A viewport minimum costs nothing and removes the
  dependency on how the host sizes its frame.
*/
const frameFit = `<style>
  html, body, #root { min-height: 100dvh; }
</style>`;

writeFileSync('dist/demo.html', `${head.trim()}\n${frameFit}\n${body.trim()}\n`);
console.log(`dist/demo.html — ${(Buffer.byteLength(head + body) / 1024 / 1024).toFixed(2)} MB`);
