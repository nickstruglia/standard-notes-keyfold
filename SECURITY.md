# Security

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: **Security → Report a vulnerability** on this repository.
Do not open a public issue for security problems, and never include real seed phrases or keys in a report.

## Threat model

Keyfold is a Standard Notes editor. It runs in an iframe and exchanges note text with Standard Notes
through `postMessage`.

**What it protects against**

| Risk | Mitigation |
| --- | --- |
| Server or network access to your notes | Standard Notes end-to-end encrypts the note. The editor never sends data anywhere: its Content Security Policy sets `connect-src 'none'`, only allows scripts from the site's own folder (listed explicitly, because Safari treats `'self'` in Standard Notes' sandbox as any https URL), and allows images and fonts only as `data:`, so even a theme stylesheet cannot send data out. |
| Someone using your unlocked Standard Notes account | Optional vault password: AES-256-GCM, key from PBKDF2-SHA256 with 600,000 iterations and a random 16-byte salt, a fresh 12-byte IV per save, and parameters bound as associated data. The key is non-extractable and kept only in memory. The vault auto-locks after inactivity. |
| Shoulder surfing and screen sharing | Secrets are masked by default, hide again after a delay, hide when focus leaves the editor, and can be covered by an optional privacy screen. |
| Cloud spellcheck, autofill and password managers capturing secrets | `spellcheck`, `autocorrect`, `autocapitalize` and `autocomplete` are off on secret fields, and common password-manager ignore attributes are set. Hidden values sit in real password inputs, so phone keyboards do not learn them, accessibility tools do not expose them and Ctrl+C cannot copy them. A seed word shows in clear only while it is being typed (not on focus), and is masked again when focus leaves it; multi-line secrets are not in the page until revealed. |
| Secrets left in the clipboard | The clipboard is cleared after a delay. Standard Notes' sandbox blocks clipboard writes outside a click, so when the timed clear is blocked it happens on the next click or tap, or with a "Clear now" button. Phone keyboards with clipboard history keep their own copy, which no web page can delete; on touch screens Keyfold says so when you copy. |
| Secrets leaking into the note list | The note preview contains counts only. |
| Losing access to Standard Notes | Encrypted backup files, made with their own password (same format and key derivation as the vault password, new salt every time), to keep outside Standard Notes. The offline viewer is one HTML file: its only script is inline and allowed by its SHA-256 hash in the Content Security Policy, and it cannot connect anywhere, so it works from a flash drive with no network. |
| Typos and incomplete copies | BIP39 wordlist and checksum checks, Electrum seed version checks, aezeed checksums, Base58Check and Bech32 checksums on wallet keys, PGP armor checksums, and a structural check that OpenSSH keys were copied completely. |
| Pasting the wrong half of a key pair | Warnings for addresses, xpubs, npubs, SSH and PGP public keys, certificates, age recipients and publishable API keys. |

**What it cannot protect against**

- Malware, keyloggers or malicious browser extensions on your device.
- A compromised copy of the hosted editor. Standard Notes loads the editor from the URL in `ext.json` (web and phones on every open, desktop for each new version), so that site's owner controls the code. Self-host a fork if you do not trust the maintainer; Settings → About shows which site your copy comes from.
- Other sites framing the hosted editor. A Content Security Policy in a meta tag cannot set `frame-ancestors`, and GitHub Pages cannot send headers. A framing page only gets what it sends in itself; it cannot read a Standard Notes note.
- JavaScript cannot reliably wipe memory, so decrypted data may stay in memory until it is garbage collected.
- Earlier note revisions in Standard Notes' note history are not re-encrypted when you add a vault password.
- A weak vault password. PBKDF2 slows guessing but cannot save a short or reused password.
- A weak backup password. Anyone who copies a backup file can try passwords offline, for as long as they like.
- A tampered viewer file. Keep `keyfold-viewer.html` where only you can change it, or get a fresh copy from the site or `keyfold.zip` before opening a backup.

## Design choices

- Built to run in Standard Notes' plugin sandbox (`allow-scripts`, no `allow-same-origin`): no browser storage, and the build is a classic script so it loads without CORS headers.
- Theme stylesheets load from the URLs Standard Notes sends: `https:`, the desktop app's local server, or `data:` URLs, which the mobile apps use for built-in themes. When a mobile app sends a `file://` URL instead, which an HTTPS page cannot load, the same file loads from `app.standardnotes.com`.
- The deploy workflow runs the full test suite (typecheck, unit and browser tests) before building, gives its build job read-only permissions, installs dependencies without install scripts, and pins every action to a commit. Only the deploy job can publish, and the build fails if the Content Security Policy is missing from the page.
- Every deploy has its own version number, so the desktop app's offline copy picks up fixes.
- The encryption format is pinned and covered by a checked-in known-answer vault; the README documents how to decrypt a vault without Keyfold.
- Key-derivation settings read from a note are bounded, and a vault saved with fewer iterations than the current default is re-encrypted at the default after unlock.
- One runtime dependency: `preact`. The Standard Notes plugin protocol (`src/sn/relay.ts`) is implemented locally: it accepts messages only from the parent window, and replies to the app's exact origin when it has a web origin. Validators (BIP39, Base58Check, Bech32, CRC-24) are small local implementations, tested against the audited `@scure` libraries and real keys.
- Keyfold does not generate seed phrases or keys. Generate them on a hardware wallet, with `ssh-keygen`, `gpg` or `age-keygen`, or on another dedicated device.
- Key recognition only reads structure and checksums. Keyfold never decrypts or uses your keys.
- Printing is disabled in the editor's print stylesheet, to keep secrets out of printer queues.
