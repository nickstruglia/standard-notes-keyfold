import { defineConfig } from 'vitest/config'
import pkg from './package.json' with { type: 'json' }

// Where the built editor is hosted. The deploy workflow passes the GitHub
// Pages URL, so forks get a manifest that points at their own copy.
const siteUrl = (process.env.SITE_URL || 'https://nickstruglia.github.io/sn-crypto/').replace(/\/*$/, '/')

// No network access at all: scripts only from our own origin, nothing can
// connect out. Styles stay open so Standard Notes themes can load.
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https: http://localhost:* http://127.0.0.1:*",
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
  identifier: 'io.github.nickstruglia.sn-crypto',
  name: 'Crypto Vault',
  content_type: 'SN|Component',
  area: 'editor-editor',
  version: pkg.version,
  description:
    'Seed phrases (12 to 33 words) and private keys in hidden fields, with BIP39 checksum checks, passphrases, ' +
    'backup tracking and an optional extra vault password.',
  url: siteUrl,
  download_url: `${siteUrl}sn-crypto.zip`,
  latest_url: `${siteUrl}ext.json`,
  marketing_url: 'https://github.com/nickstruglia/sn-crypto',
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
  },
  plugins: [
    {
      name: 'crypto-vault-release',
      apply: 'build',
      transformIndexHtml: (html) =>
        html.replace('<!--CSP-->', `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'ext.json', source: JSON.stringify(manifest, null, 2) + '\n' })
      },
    },
  ],
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
