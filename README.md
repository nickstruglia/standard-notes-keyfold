# Keyfold

**Your keys and recovery phrases, folded into one encrypted Standard Notes note.**

Keyfold is a [Standard Notes](https://standardnotes.com) plugin for crypto seed phrases and wallet keys, plus the other cryptographic keys in your life: SSH and PGP keys, API tokens and recovery codes. Each one folds into a one-line card. Secrets stay hidden until you reveal them, every format Keyfold knows is checked for typos, and an optional second password can encrypt the whole note again.

![Keyfold showing a 12-word seed phrase with masked words and a valid checksum](docs/screenshot.png)

## Crypto first

**Seed phrases of any length**
- 12, 15, 18, 21 and 24-word BIP39 phrases, 20/33-word SLIP-39 shares, 25-word Monero seeds, or any custom count up to 48 words.
- Each word sits in its own numbered, masked field. Paste a whole phrase into word 1 and it fills the grid.
- BIP39 checks: every word is checked against the official wordlist, the checksum is verified, typos get "did you mean" suggestions, and 4-letter prefixes expand to the full word.
- Electrum 2.0+ seeds are validated and their type shown (standard, segwit, 2FA).
- A hidden field for the BIP39 passphrase ("25th word"), plus a visible hint for it.

**Wallet keys**
- Recognizes and checks hex (raw 32-byte / EVM), WIF (Bitcoin, Litecoin, Dogecoin, testnet) with its Base58Check checksum, BIP32 extended keys (xprv, yprv, zprv, tprv...), Nostr `nsec`, Cardano and other Bech32 secret keys, Solana base58 and byte-array keypairs, and encrypted V3 keystore JSON (with a field for its password).
- Warns you if you paste public data instead (an address, xpub or npub) or a key with a broken checksum.

**Wallet details**
- Chain or coin, wallet or device, derivation path, master fingerprint, addresses or xpub.
- Backup locations, each with a "last checked" date. Seed phrases, wallet keys, PGP keys and recovery codes whose backups were not checked recently are flagged.

## Every other key

| Type | What Keyfold recognizes |
|---|---|
| **SSH keys** | OpenSSH private keys (Ed25519, RSA, ECDSA, security keys), including whether they are passphrase-protected or were copied incompletely; PuTTY keys; PEM keys. Public key and fingerprint fields. |
| **PGP keys** | Armored private key blocks, with the armor checksum verified. Public key and fingerprint fields. |
| **API keys and tokens** | GitHub, GitLab, npm, Stripe, Slack, Google, AWS, SendGrid, DigitalOcean, `sk-` style keys and JSON Web Tokens. |
| **Other keys** | age, WireGuard and other 32-byte base64 keys, PEM (PKCS#1, PKCS#8, SEC1), JSON Web Keys, Google Cloud service account files. |
| **Recovery codes** | One code per line, hidden, with a count. |
| **Other secrets** | Any mix of named fields, each shown or hidden as you choose. |

SSH, PGP, API and other keys have an **expiry date**: Keyfold flags them 30 days before they expire, and a filter lists everything expiring or expired. Keyfold also warns when you paste a public key, certificate or PGP message where a private key belongs.

## Many keys in one note, without the clutter

- Each entry is a card that folds into one line (label, type, chain or service, word count, checksum, expiry and backup status) and opens when you click it. Expand all, collapse all, or have opening one card close the others.
- Inside a card, every section collapses to a one-line summary. The secret opens by default and the rest stays folded.
- Entries are grouped by type, with seed phrases and wallet keys first. You can also group by chain or service, wallet or account, or first tag, and sort by last update, label or creation date.
- Compact density turns every entry into a single row. A list-beside-editor layout is available under **View**.
- Search covers labels, descriptions, tags, notes and public details, never secret values.
- Favorites, archive, duplicate, delete with undo, custom fields and free-form notes on every entry.

## Privacy and security

- Secrets are masked until revealed and hide themselves again after 30 seconds (configurable), or when the editor loses focus.
- Hidden secrets are real password fields: phone keyboards do not learn them, screen readers do not read them aloud, and they cannot be copied with Ctrl+C. Multi-line keys are not on the page at all until revealed.
- Copying a secret clears the clipboard after 30 seconds. Inside Standard Notes the browser only allows this during a click or tap, so if it is blocked the clipboard clears on your next click, or with the **Clear now** button.
- Spellcheck, autocorrect, autofill and password-manager capture are off on secret fields, so nothing is sent to cloud spellcheckers.
- An optional **vault password** adds a second layer on top of Standard Notes' end-to-end encryption: AES-256-GCM with a key derived by PBKDF2-SHA256 (600,000 iterations). The vault auto-locks after inactivity.
- **Nothing leaves the editor.** The Content Security Policy blocks every outgoing connection, and scripts, images and fonts from other sites. The only outside files it loads are your Standard Notes theme's stylesheets. The only runtime dependency is Preact, and Keyfold talks to Standard Notes with its own small implementation of the plugin message protocol.
- An optional privacy screen blurs the vault whenever the editor is not focused.
- Follows Standard Notes' "Prevent editing" lock and its themes (built-in and installed, on desktop, web and phones), and never overwrites a note that already had other content.

## Install

1. In Standard Notes, open **Preferences → Plugins**.
2. Under **Install Custom Plugin**, paste this URL and install:
   ```
   https://nickstruglia.github.io/sn-keyfold/ext.json
   ```
3. Create a new note, open the editor menu, and choose **Keyfold**.

Open the URL above without `ext.json` to try a demo in your browser (sample data only, nothing is saved).

## Mobile

The Standard Notes iOS and Android apps run plugins in the same sandboxed frame as the web app, loaded from the plugin's URL, so Keyfold needs an internet connection on a phone (the desktop app can keep an offline copy). The layout, touch targets and keyboard handling are built for phones, and every browser test runs at Android and iPhone screen sizes with touch enabled. On touch screens, seed words stay masked while you type them unless you tap **Reveal words**.

The phone apps pass Standard Notes' built-in themes to plugins as local files, which a plugin loaded from the web is not allowed to open, so Keyfold loads the same theme from Standard Notes' web app (`app.standardnotes.com`) instead.

Tested in the Standard Notes Android app. Not yet verified on an iPhone (Safari's engine, WebKit). Try it with a dummy phrase first.

## Security notes

Read these before storing keys that protect real funds or systems:

- **Who you trust.** Standard Notes loads Keyfold from the URL in `ext.json` every time you open the note, so whoever controls that site controls the code that sees your secrets. If you are not the maintainer, fork this repository and install from your own GitHub Pages URL (see below).
- **Your device.** A compromised computer, malicious browser extension or keylogger can read anything you type or reveal. For large amounts, keep keys on a hardware wallet and treat Keyfold as an encrypted record, not your only backup.
- **Note history.** Standard Notes keeps earlier versions of a note. If you add a vault password after entering secrets, older revisions still hold the data without that extra layer (Standard Notes' own encryption still protects them). Set the password on a new vault before adding secrets, or delete the old revisions.
- **Clipboard.** Clipboard clearing is best effort. Clipboard history tools (Windows Win+V, clipboard managers, universal clipboard) and phone keyboards (Gboard, Samsung Keyboard) keep their own copies, which no web page can delete. On a phone, delete the entry from the keyboard's clipboard panel, or turn its clipboard history off.
- **Forgotten vault password.** It cannot be recovered by anyone.

See [SECURITY.md](SECURITY.md) for the threat model and how to report a vulnerability.

## How data is stored

The note text is JSON. Without a vault password:

```json
{ "app": "keyfold", "version": 1, "readme": "...", "vault": { "entries": [...], "settings": {...} } }
```

With a vault password, `vault` is replaced by an encrypted blob:

```json
{ "app": "keyfold", "version": 1, "readme": "...",
  "encryption": { "kdf": "PBKDF2-SHA256", "iterations": 600000, "salt": "...", "cipher": "AES-256-GCM", "iv": "...", "ciphertext": "..." } }
```

The preview in Standard Notes' note list contains only counts (for example "Keyfold: 2 seed phrases, 1 SSH key"), never labels or secrets.

## Development

Requires Node.js 22.

```bash
npm ci
npm run dev        # then open http://localhost:5173/dev/host.html?sandbox=0
npm run typecheck
npm test           # unit tests (validators checked against @scure reference libraries and published test vectors)
npm run build
npm run test:e2e   # Playwright tests against the production build, on desktop and phone screen sizes
```

`dev/host.html` is a mock of the Standard Notes side of the plugin protocol (`dev/null-origin.html` wraps it so the app's origin is "null", as in the mobile apps). It frames the editor with the same sandbox Standard Notes uses (add `?sandbox=0` for the Vite dev server, whose ES modules need same-origin access). It shows the saved note text live, and it can toggle "Prevent editing", switch to a dark theme, and simulate an edit from another device. Add `?mobile=1` to register the way the Android app does, with its `file://` theme URLs.

## Deploy your own copy

1. Fork this repository.
2. In the fork, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Run the **Deploy to GitHub Pages** workflow (Actions tab), or push to the default branch.
4. Install `https://<your-username>.github.io/sn-keyfold/ext.json` in Standard Notes.

The workflow writes your Pages URL into `ext.json` and publishes `keyfold.zip` for the desktop app's offline mode.

## License

[MIT](LICENSE) © 2026 Nicholas Truglia
