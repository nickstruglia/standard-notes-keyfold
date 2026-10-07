# Security

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: **Security → Report a vulnerability** on this repository.
Do not open a public issue for security problems, and never include real seed phrases or keys in a report.

## Threat model

Crypto Vault is a Standard Notes editor. It runs in an iframe and exchanges note text with Standard Notes
through `postMessage`.

**What it protects against**

| Risk | Mitigation |
| --- | --- |
| Server or network access to your notes | Standard Notes end-to-end encrypts the note. The editor never sends data anywhere: its Content Security Policy sets `connect-src 'none'` and only allows scripts from its own origin. |
| Someone using your unlocked Standard Notes account | Optional vault password: AES-256-GCM, key from PBKDF2-SHA256 with 600,000 iterations and a random 16-byte salt, a fresh 12-byte IV per save, and parameters bound as associated data. The key is non-extractable and kept only in memory. The vault auto-locks after inactivity. |
| Shoulder surfing and screen sharing | Secrets are masked by default, hide again after a delay, hide when focus leaves the editor, and can be covered by an optional privacy screen. |
| Cloud spellcheck, autofill and password managers capturing secrets | `spellcheck`, `autocorrect`, `autocapitalize` and `autocomplete` are off on secret fields, and common password-manager ignore attributes are set. Where the browser supports CSS masking, secret fields are plain text inputs, so browsers do not offer to save them as passwords. |
| Secrets left in the clipboard | The clipboard is cleared after a delay (best effort). |
| Secrets leaking into the note list | The note preview contains counts only. |
| Typos in transcribed backups | BIP39 wordlist and checksum checks, Electrum seed version checks, and Base58Check/Bech32 checksum checks on keys. |

**What it cannot protect against**

- Malware, keyloggers or malicious browser extensions on your device.
- A compromised copy of the hosted editor. Standard Notes loads the editor from the URL in `ext.json`, so that site's owner controls the code. Self-host a fork if you do not trust the maintainer.
- JavaScript cannot reliably wipe memory, so decrypted data may stay in memory until it is garbage collected.
- Earlier note revisions in Standard Notes' note history are not re-encrypted when you add a vault password.
- A weak vault password. PBKDF2 slows guessing but cannot save a short or reused password.

## Design choices

- Only two runtime dependencies: `preact` and `@standardnotes/component-relay`. Validators (BIP39, Base58Check, Bech32) are small local implementations, tested against the audited `@scure` libraries.
- The editor does not generate seed phrases or keys. Generate them on a hardware wallet or other dedicated device.
- Printing is disabled in the editor's print stylesheet, to keep secrets out of printer queues.
