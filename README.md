# Crypto Vault for Standard Notes

A [Standard Notes](https://standardnotes.com) editor for crypto seed phrases and private keys.
Each note becomes a small vault of entries with hidden fields, labels, descriptions,
passphrases, creation dates, backup tracking and an optional second password.

![Crypto Vault showing a 12-word seed phrase with masked words and a valid checksum](docs/screenshot.png)

## Features

**Seed phrases of any length**
- 12, 15, 18, 21 and 24-word BIP39 phrases, 20/33-word SLIP-39 shares, 25-word Monero seeds, or any custom count up to 48 words.
- Each word sits in its own numbered, masked field. Paste a whole phrase into word 1 and it fills the grid.
- BIP39 checks: every word is checked against the official wordlist, the checksum is verified, typos get "did you mean" suggestions, and 4-letter prefixes expand to the full word.
- Electrum 2.0+ seeds are validated and their type shown (standard, segwit, 2FA).
- A hidden field for the BIP39 passphrase ("25th word"), plus a visible hint field for it.

**Private keys**
- A masked field that recognizes the format and checks it: hex (raw 32-byte / EVM), WIF (Bitcoin, Litecoin, Dogecoin, testnet) with Base58Check checksum, BIP32 extended keys (xprv/yprv/zprv/tprv...), Nostr `nsec`, Bech32 secret keys, Solana base58 and byte-array keypairs, and encrypted V3 keystore JSON.
- It warns you if you paste public data instead (an address, xpub or npub) or a key with a broken checksum.

**For every entry**
- Label, description, chain, wallet or device, date created, tags, favorite and archive flags.
- Public info that is safe to show: derivation path, master fingerprint, addresses or xpub.
- Custom fields for PINs, keystore passwords, 2FA backup codes or multisig details, each shown or hidden as you choose.
- Backup locations, each with a "last checked" date. Entries whose backups were not checked recently are flagged.
- Free-form notes, plus automatic added/updated timestamps.
- Search (never matches secret values), filters, sorting, duplicate, and delete with undo.

**Privacy and security**
- Secrets are masked until revealed and hide themselves again after 30 seconds (configurable), or when the editor loses focus.
- Copying a secret clears the clipboard after 30 seconds (configurable).
- Spellcheck, autocorrect, autofill and password-manager capture are turned off on secret fields, so words are not sent to cloud spellcheckers.
- An optional **vault password** adds a second layer on top of Standard Notes' end-to-end encryption: AES-256-GCM with a key derived by PBKDF2-SHA256 (600,000 iterations). The vault auto-locks after inactivity.
- **No network access.** The editor's Content Security Policy blocks every outgoing connection, and it has only two runtime dependencies (Preact and Standard Notes' component relay).
- An optional privacy screen blurs the vault whenever the editor is not focused.
- Follows Standard Notes' "Prevent editing" lock and its themes, adapts to narrow (mobile) and wide layouts, and never overwrites a note that already had other content.

## Install

1. In Standard Notes, open **Preferences → Plugins**.
2. Under **Install custom plugin**, paste this URL and install:
   ```
   https://nickstruglia.github.io/sn-crypto/ext.json
   ```
3. Create a new note, open the editor menu, and choose **Crypto Vault**.

Open the URL above without `ext.json` to try a demo in your browser (sample data only, nothing is saved).

## Security notes

Read these before storing real funds' keys:

- **Who you trust.** Standard Notes loads this editor from the URL in `ext.json` every time you open the note, so whoever controls that site controls the code that sees your secrets. If you are not the maintainer, fork this repository and install from your own GitHub Pages URL (see below).
- **Your device.** A compromised computer, malicious browser extension or keylogger can read anything you type or reveal. For large amounts, keep keys on a hardware wallet and treat this vault as an encrypted record, not your only backup.
- **Note history.** Standard Notes keeps earlier versions of a note. If you add a vault password after entering secrets, older revisions still hold the data without that extra layer (Standard Notes' own encryption still protects them). Set the password on a new vault before adding secrets, or delete the old revisions.
- **Clipboard.** Clipboard clearing is best effort. Clipboard history tools (Windows Win+V, clipboard managers, universal clipboard) may keep copies.
- **Forgotten vault password.** It cannot be recovered by anyone.

See [SECURITY.md](SECURITY.md) for the threat model and how to report a vulnerability.

## How data is stored

The note text is JSON. Without a vault password:

```json
{ "app": "sn-crypto-vault", "version": 1, "readme": "...", "vault": { "entries": [...], "settings": {...} } }
```

With a vault password, `vault` is replaced by an encrypted blob:

```json
{ "app": "sn-crypto-vault", "version": 1, "readme": "...",
  "encryption": { "kdf": "PBKDF2-SHA256", "iterations": 600000, "salt": "...", "cipher": "AES-256-GCM", "iv": "...", "ciphertext": "..." } }
```

The note preview shown in Standard Notes' note list contains only counts (for example "Crypto Vault: 2 seed phrases"), never labels or secrets.

## Development

Requires Node.js 22.

```bash
npm ci
npm run dev        # then open http://localhost:5173/dev/host.html
npm run typecheck
npm test           # unit tests (validators checked against @scure reference libraries and published test vectors)
npm run build
npm run test:e2e   # Playwright tests against the production build
```

`dev/host.html` is a mock of the Standard Notes side of the plugin protocol. It shows the saved note text live, and it can toggle "Prevent editing", switch to a dark theme, and simulate an edit from another device.

## Deploy your own copy

1. Fork this repository.
2. In the fork, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Run the **Deploy to GitHub Pages** workflow (Actions tab), or push to the default branch.
4. Install `https://<your-username>.github.io/sn-crypto/ext.json` in Standard Notes.

The workflow writes your Pages URL into `ext.json` and publishes `sn-crypto.zip` for the desktop app's offline mode.

## License

[MIT](LICENSE) © 2026 Nicholas Truglia
