import { defineConfig } from 'vitest/config'
import pkg from './package.json' with { type: 'json' }

// Where the built editor is hosted. The deploy workflow passes the GitHub
// Pages URL, so forks get a manifest that points at their own copy.
const siteUrl = (process.env.SITE_URL || 'https://nickstruglia.github.io/sn-keyfold/').replace(/\/*$/, '/')

// No network access at all: scripts only from our own origin, nothing can
// connect out. Styles stay open so Standard Notes themes can load.
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https: http://localhost:* http://127.0.0.1:* file:",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "manifest-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ')

const manifest = {
  identifier: 'io.github.nickstruglia.keyfold',
  name: 'Keyfold',
  content_type: 'SN|Component',
  area: 'editor-editor',
  version: pkg.version,
  description:
    'A key manager for Standard Notes: seed phrases, wallet, SSH and PGP keys, API tokens and recovery codes, ' +
    'in collapsible cards with hidden fields and checksum checks.',
  url: siteUrl,
  download_url: `${siteUrl}keyfold.zip`,
  latest_url: `${siteUrl}ext.json`,
  marketing_url: 'https://github.com/nickstruglia/sn-keyfold',
  thumbnail_url: `${siteUrl}icon.svg`,
  note_type: 'authentication',
  file_type: 'json',
  interchangeable: false,
}

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  oxc: {
    jsx: { runtime: 'automatic', importSource: 'preact' },
  },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    modulePreload: false,
    // A classic script, not an ES module: see the HTML rewrite below.
    rolldownOptions: { output: { format: 'iife' } },
  },
  plugins: [
    {
      name: 'keyfold-release',
      apply: 'build',
      transformIndexHtml: {
        order: 'post',
        // Standard Notes sandboxes plugins without allow-same-origin, so the
        // page has a "null" origin. Module scripts and crossorigin links are
        // fetched with CORS and fail unless the server sends CORS headers
        // (Standard Notes desktop's offline server may not). Plain tags load anywhere.
        handler: (html) =>
          html
            .replace('<!--CSP-->', `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`)
            .replace(/<script type="module" crossorigin src=/g, '<script defer src=')
            .replace(/<link rel="stylesheet" crossorigin href=/g, '<link rel="stylesheet" href='),
      },
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'ext.json', source: JSON.stringify(manifest, null, 2) + '\n' })
      },
    },
  ],
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
