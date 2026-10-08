import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'
import pkg from './package.json' with { type: 'json' }

// Where the built editor is hosted. The deploy workflow passes the GitHub
// Pages URL, so forks get a manifest that points at their own copy.
const siteUrl = (process.env.SITE_URL || 'https://nickstruglia.github.io/standard-notes-keyfold/').replace(/\/*$/, '/')
const repo = process.env.GITHUB_REPOSITORY || 'nickstruglia/standard-notes-keyfold'
const repoUrl = `https://github.com/${repo}`
// Forks are named after their owner so a second install is easy to tell apart.
const owner = repo.split('/')[0]
const name = owner === 'nickstruglia' ? 'Keyfold' : `Keyfold (${owner})`

// The desktop app only re-downloads its offline copy when the version goes
// up, so every deploy gets its own: major.minor from package.json, the
// workflow run number as the patch.
const [major, minor] = pkg.version.split('.')
const version = process.env.GITHUB_RUN_NUMBER ? `${major}.${minor}.${process.env.GITHUB_RUN_NUMBER}` : pkg.version
const commit = (process.env.GITHUB_SHA || '').slice(0, 7)

// Nothing can connect out, and scripts load only from the site itself.
// 'self' is not used: inside Standard Notes' sandbox the page has an opaque
// origin, and Safari then matches 'self' against any https URL (or nothing
// on iOS 15). The site's own folder and the desktop app's local server are
// listed instead. Styles stay open so Standard Notes themes can load: from the web
// app (https:), the desktop app (localhost) and the mobile apps (data:).
// Images and fonts are data: only, so a stylesheet cannot send anything out.
const LOCAL = 'http://localhost:* http://127.0.0.1:*'
const CSP = [
  "default-src 'none'",
  // file: lets the unzipped offline copy run from disk (recovery viewer).
  `script-src ${siteUrl} ${LOCAL} file:`,
  `style-src ${siteUrl} 'unsafe-inline' https: data: ${LOCAL}`,
  'img-src data:',
  'font-src data:',
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
  name,
  content_type: 'SN|Component',
  area: 'editor-editor',
  version,
  description:
    'A key manager for Standard Notes: seed phrases, wallet, SSH and PGP keys, API tokens and recovery codes, ' +
    'in collapsible cards with hidden fields and checksum checks.',
  url: siteUrl,
  download_url: `${siteUrl}keyfold.zip`,
  latest_url: `${siteUrl}ext.json`,
  marketing_url: repoUrl,
  thumbnail_url: `${siteUrl}icon.svg`,
  // No note_type: with one, Standard Notes opens Keyfold notes in its
  // Authenticator when Keyfold is missing, and adding an entry there
  // overwrites the vault. Without one it falls back to plain text.
  file_type: 'json',
  interchangeable: false,
}

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(commit ? `${version} (${commit})` : version),
    __SITE_URL__: JSON.stringify(siteUrl),
    __REPO_URL__: JSON.stringify(repoUrl),
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
        handler: (html) => {
          const out = html
            .replace('<!--CSP-->', `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`)
            .replace(/<script type="module" crossorigin src=/g, '<script defer src=')
            // The favicon is inlined: img-src allows data: only.
            .replace('href="./icon.svg"', `href="data:image/svg+xml,${encodeURIComponent(readFileSync('public/icon.svg', 'utf8'))}"`)
          // Fail the build rather than ship without the policy or with a
          // module script (which the desktop app's offline server cannot load).
          if (!out.includes('http-equiv="Content-Security-Policy"')) throw new Error('CSP meta tag missing from index.html')
          if (/type="module"|crossorigin/.test(out)) throw new Error('index.html still has a module script or crossorigin attribute')
          if (out.includes('href="./icon.svg"')) throw new Error('favicon was not inlined')
          return out
        },
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
