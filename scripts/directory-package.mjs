// Builds the copy of Keyfold for Standard Notes' plugin directory
// (https://github.com/standardnotes/plugins), which hosts it at its own
// address and lists it in the app's plugin gallery. That repository builds
// its packages on Node 16, which this build cannot run on, so the package
// carries the built files with their checksums, and its own build step
// checks them and copies them into place.
//
//   node scripts/directory-package.mjs <version>
//
// writes directory-package/io.github.nickstruglia.keyfold/, ready to copy
// into the plugins repository's packages/ folder. Running it again at the
// same commit gives the same files, so anyone can check the copy there.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

const ID = 'io.github.nickstruglia.keyfold'
const PACKAGE_URL = `https://standardnotes.github.io/plugins/cdn/dist/static/${ID}/`
const SITE_URL = `${PACKAGE_URL}dist/`
const REPO = 'https://github.com/nickstruglia/standard-notes-keyfold'

const version = process.argv[2] ?? ''
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: node scripts/directory-package.mjs <version>')
  process.exit(1)
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
// The package names the commit it was built from, so that commit must hold every change.
if (git('status', '--porcelain', '--untracked-files=no')) throw new Error('Commit your changes first.')
const commit = git('rev-parse', 'HEAD')

const root = 'directory-package'
const built = join(root, '.build')
const out = join(root, ID)
rmSync(root, { recursive: true, force: true })
execFileSync('npx', ['vite', 'build', '--outDir', built, '--emptyOutDir'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    SITE_URL,
    KEYFOLD_VERSION: version,
    KEYFOLD_COMMIT: commit,
    // Settings from a GitHub Actions run would rename the plugin or change its version.
    GITHUB_REPOSITORY: '',
    GITHUB_RUN_NUMBER: '',
    GITHUB_SHA: '',
  },
})

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

// ext.json is left out: the directory writes its own entry for the plugin.
const files = walk(built)
  .map((path) => relative(built, path).split('\\').join('/'))
  .filter((file) => file !== 'ext.json')
  .sort()
for (const file of files) {
  mkdirSync(dirname(join(out, 'prebuilt', file)), { recursive: true })
  copyFileSync(join(built, file), join(out, 'prebuilt', file))
}
writeFileSync(join(out, 'SHA256SUMS'), files.map((file) => `${sha256(join(built, file))}  ${file}`).join('\n') + '\n')
rmSync(built, { recursive: true, force: true })

const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
const pkg = {
  name: 'sn-keyfold',
  version,
  private: true,
  description:
    'A key manager for Standard Notes: seed phrases, wallet, SSH and PGP keys, API tokens and recovery codes, ' +
    'in collapsible cards with hidden fields and checksum checks.',
  author: 'Nicholas Truglia',
  license: manifest.license,
  homepage: REPO,
  repository: { type: 'git', url: 'https://github.com/standardnotes/plugins', directory: `packages/${ID}` },
  scripts: { build: 'node build.mjs' },
  sn: {
    name: 'Keyfold',
    content_type: 'SN|Component',
    area: 'editor-editor',
    main: 'dist/index.html',
    // No note_type: with one, Standard Notes opens Keyfold notes in its
    // Authenticator when Keyfold is missing. Without one it falls back to plain text.
    file_type: 'json',
    interchangeable: false,
    marketing_url: REPO,
    thumbnail_url: `${SITE_URL}icon.svg`,
    showInGallery: true,
  },
}
writeFileSync(join(out, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')

writeFileSync(
  join(out, 'build.mjs'),
  `// Copies the prebuilt files to dist/ after checking each one against SHA256SUMS.
// They are Keyfold's own build for this address; README.md says how to rebuild them.
import { createHash } from 'crypto'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'fs'
import { dirname, join, relative } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const prebuilt = join(here, 'prebuilt')
const dist = join(here, 'dist')

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [relative(prebuilt, path).split('\\\\').join('/')]
  })

const sums = new Map(
  readFileSync(join(here, 'SHA256SUMS'), 'utf8')
    .trim()
    .split('\\n')
    .map((line) => {
      const [hash, file] = line.split('  ')
      return [file, hash]
    }),
)
const files = walk(prebuilt).sort()
if (files.join('\\n') !== [...sums.keys()].sort().join('\\n')) throw new Error('prebuilt/ does not match SHA256SUMS')

rmSync(dist, { recursive: true, force: true })
for (const file of files) {
  const hash = createHash('sha256').update(readFileSync(join(prebuilt, file))).digest('hex')
  if (hash !== sums.get(file)) throw new Error(\`\${file} does not match SHA256SUMS\`)
  mkdirSync(dirname(join(dist, file)), { recursive: true })
  copyFileSync(join(prebuilt, file), join(dist, file))
}
console.log(\`Keyfold: \${files.length} files checked and copied to dist/\`)
`,
)

writeFileSync(
  join(out, 'README.md'),
  `# Keyfold

A key manager for Standard Notes: crypto seed phrases and wallet keys, plus SSH and PGP keys, API tokens and recovery
codes. Each entry folds into a one-line card, secrets stay hidden until revealed, seed phrases and keys are checked for
typos (BIP39 and Electrum checksums, Base58Check, Bech32, PGP armor), and an optional vault password encrypts the
whole note again (AES-256-GCM, PBKDF2-SHA256 with 600,000 iterations). Encrypted backup files open in a single-file
offline viewer, without Standard Notes.

Its Content Security Policy blocks every outgoing connection (\`connect-src 'none'\`), and scripts, images and fonts
from other sites. The only runtime dependency is Preact.

- Source, tests and documentation: ${REPO} (MIT)
- This copy: version ${version}, built from commit [\`${commit.slice(0, 7)}\`](${REPO}/commit/${commit})

## Why the files are prebuilt

This repository builds its packages on Node 16, and Keyfold's build (Vite 8) needs Node 20.19 or newer. So
\`prebuilt/\` holds the output of Keyfold's own build for this package's address, and \`yarn build\` checks every file
against \`SHA256SUMS\` before copying it to \`dist/\`.

## Rebuilding and comparing

With Node 22.12 or newer:

\`\`\`sh
git clone ${REPO}.git
cd standard-notes-keyfold
git checkout ${commit}
npm ci --ignore-scripts
node scripts/directory-package.mjs ${version}
diff -r directory-package/${ID}/prebuilt <this folder>/prebuilt
diff directory-package/${ID}/SHA256SUMS <this folder>/SHA256SUMS
\`\`\`

The script builds Keyfold for \`${SITE_URL}\` and writes this folder, with the same files byte for byte.
`,
)

copyFileSync('LICENSE', join(out, 'LICENSE'))

console.log(`\nWrote ${out}: Keyfold ${version} from ${commit.slice(0, 7)}, ${files.length} files.`)
