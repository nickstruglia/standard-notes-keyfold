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
| Server or network access to your notes | Standard Notes end-to-end encrypts the note. The editor never sends data anywhere: its Content Security Policy sets `connect-src 'none'`, only allows scripts from its own origin, and blocks images and fonts from other sites, so even a theme stylesheet cannot send data out. |
| Someone using your unlocked Standard Notes account | Optional vault password: AES-256-GCM, key from PBKDF2-SHA256 with 600,000 iterations and a random 16-byte salt, a fresh 12-byte IV per save, and parameters bound as associated data. The key is non-extractable and kept only in memory. The vault auto-locks after inactivity. |
| Shoulder surfing and screen sharing | Secrets are masked by default, hide again after a delay, hide when focus leaves the editor, and can be covered by an optional privacy screen. |
| Cloud spellcheck, autofill and password managers capturing secrets | `spellcheck`, `autocorrect`, `autocapitalize` and `autocomplete` are off on secret fields, and common password-manager ignore attributes are set. Hidden values sit in real password inputs, so phone keyboards do not learn them, accessibility tools do not expose them, macOS Secure Input applies and Ctrl+C cannot copy them; multi-line secrets are not in the page until revealed. |
| Secrets left in the clipboard | The clipboard is cleared after a delay. Standard Notes' sandbox blocks clipboard writes outside a click, so when the timed clear is blocked it happens on the next click or tap, or with a "Clear now" button. Phone keyboards with clipboard history keep their own copy, which no web page can delete; on touch screens Keyfold says so when you copy. |
| Secrets leaking into the note list | The note preview contains counts only. |
| Typos and incomplete copies | BIP39 wordlist and checksum checks, Electrum seed version checks, Base58Check and Bech32 checksums on wallet keys, PGP armor checksums, and a structural check that OpenSSH keys were copied completely. |
| Pasting the wrong half of a key pair | Warnings for addresses, xpubs, npubs, SSH and PGP public keys, certificates, age recipients and publishable API keys. |

**What it cannot protect against**

- Malware, keyloggers or malicious browser extensions on your device.
- A compromised copy of the hosted editor. Standard Notes loads the editor from the URL in `ext.json`, so that site's owner controls the code. Self-host a fork if you do not trust the maintainer.
- JavaScript cannot reliably wipe memory, so decrypted data may stay in memory until it is garbage collected.
- Earlier note revisions in Standard Notes' note history are not re-encrypted when you add a vault password.
- A weak vault password. PBKDF2 slows guessing but cannot save a short or reused password.

## Design choices

- Built to run in Standard Notes' plugin sandbox (`allow-scripts`, no `allow-same-origin`): no browser storage, and the build is a classic script so it loads without CORS headers.
- Theme stylesheets load from the URLs Standard Notes sends: `https:`, the desktop app's local server, or `data:` URLs, which the mobile apps use for built-in themes. When a mobile app sends a `file://` URL instead, which an HTTPS page cannot load, the same file loads from `app.standardnotes.com`.
- The deploy workflow gives its build job read-only permissions and installs dependencies without install scripts; only the deploy job can publish.
- Key-derivation settings read from a note are bounded, and a vault saved with fewer iterations than the current default is re-encrypted at the default after unlock.
- One runtime dependency: `preact`. The Standard Notes plugin protocol (`src/sn/relay.ts`) is implemented locally: it accepts messages only from the parent window, and replies to the app's exact origin when it has a web origin. Validators (BIP39, Base58Check, Bech32, CRC-24) are small local implementations, tested against the audited `@scure` libraries and real keys.
- Keyfold does not generate seed phrases or keys. Generate them on a hardware wallet, with `ssh-keygen`, `gpg` or `age-keygen`, or on another dedicated device.
- Key recognition only reads structure and checksums. Keyfold never decrypts or uses your keys.
- Printing is disabled in the editor's print stylesheet, to keep secrets out of printer queues.
