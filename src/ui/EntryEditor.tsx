import { useEffect, useRef, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { Icon, type IconName } from './icons'
import { SecretField } from './Secret'
import { WordGrid } from './WordGrid'
import { KIND_LABELS } from './labels'
import { EXACT_ATTRS, SECRET_ATTRS, useAsync, useSection, useUi } from './context'
import { COMMON_WORD_COUNTS, MAX_WORDS, SCHEMES, type MnemonicScheme, checkMnemonic } from '../lib/mnemonic'
import { detectKeyFormat, findPrivateMaterial } from '../lib/keyformat'
import { type Entry, daysUntilExpiry, isBackupDue, lastVerified, today } from '../lib/vault'
import { KIND_INFO, isCrypto } from '../lib/kinds'
import { newId } from '../lib/encoding'

const CHAINS = [
  'Bitcoin', 'Ethereum', 'Solana', 'Cardano', 'Monero', 'Litecoin', 'Dogecoin', 'Polkadot', 'Cosmos',
  'Avalanche', 'Polygon', 'BNB Chain', 'Arbitrum', 'Base', 'Optimism', 'Tron', 'XRP Ledger', 'Tezos',
  'Algorand', 'Stellar', 'Near', 'Sui', 'Aptos', 'Lightning (LND)', 'Nostr', 'Multi-chain',
]
const WALLETS = [
  'Ledger', 'Trezor', 'Coldcard', 'BitBox02', 'Keystone', 'Blockstream Jade', 'Foundation Passport',
  'Sparrow', 'Electrum', 'Nunchuk', 'BlueWallet', 'Phoenix', 'MetaMask', 'Rabby', 'Rainbow', 'Phantom',
  'Solflare', 'Exodus', 'Trust Wallet', 'Coinbase Wallet', 'Cake Wallet', 'Feather', 'Monero GUI',
]
const SERVICES = [
  'GitHub', 'GitLab', 'Bitbucket', 'AWS', 'Google Cloud', 'Azure', 'Cloudflare', 'DigitalOcean', 'Vercel',
  'Stripe', 'Slack', 'npm', 'Docker Hub', 'Apple ID', 'Google account', 'Microsoft account', 'Proton',
  'Standard Notes', 'Coinbase', 'Kraken', 'Binance', 'Gemini', 'Bitstamp',
]
const PATHS = [
  ["m/44'/0'/0'", 'BTC legacy (BIP44)'],
  ["m/49'/0'/0'", 'BTC nested SegWit (BIP49)'],
  ["m/84'/0'/0'", 'BTC native SegWit (BIP84)'],
  ["m/86'/0'/0'", 'BTC Taproot (BIP86)'],
  ["m/48'/0'/0'/2'", 'BTC multisig (BIP48)'],
  ["m/44'/60'/0'/0/0", 'Ethereum / EVM'],
  ["m/44'/501'/0'/0'", 'Solana'],
  ["m/1852'/1815'/0'", 'Cardano'],
  ["m/44'/118'/0'/0/0", 'Cosmos'],
]

/** Suggestion lists for the inputs; rendered once per page. */
export const EditorDatalists = () => (
  <>
    <datalist id="chains">
      {CHAINS.map((c) => (
        <option value={c} />
      ))}
    </datalist>
    <datalist id="wallets">
      {WALLETS.map((w) => (
        <option value={w} />
      ))}
    </datalist>
    <datalist id="services">
      {SERVICES.map((s) => (
        <option value={s} />
      ))}
    </datalist>
    <datalist id="paths">
      {PATHS.map(([p, label]) => (
        <option value={p} label={label} />
      ))}
    </datalist>
  </>
)

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const Field = ({ label, hint, children, wide }: { label: string; hint?: ComponentChildren; children: ComponentChildren; wide?: boolean }) => (
  <label class={`field ${wide ? 'field-wide' : ''}`}>
    <span class="field-label">{label}</span>
    {children}
    {hint && <span class="hint">{hint}</span>}
  </label>
)

interface SectionProps {
  id: string
  title: string
  icon?: IconName
  /** Shown next to the title while collapsed. Must never contain secrets. */
  summary?: ComponentChildren
  defaultOpen: boolean
  action?: { label: string; onClick: () => void }
  children: ComponentChildren
}

/** A collapsible section. Its open state lasts for the session. */
const Section = ({ id, title, icon, summary, defaultOpen, action, children }: SectionProps) => {
  // Decide the default once, so typing a label does not snap Details shut.
  const [initiallyOpen] = useState(defaultOpen)
  const [open, setOpen] = useSection(id, initiallyOpen)
  const bodyId = `section-${id.replace(/[^a-z0-9]/gi, '-')}`
  return (
    <section class={`section ${open ? 'open' : 'closed'}`}>
      <header class="section-header">
        <h3 class="section-heading">
          <button type="button" class="section-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
            <Icon name="chevron" size={14} class="chevron" />
            {icon && <Icon name={icon} />}
            <span>{title}</span>
            {!open && summary && <span class="section-summary">{summary}</span>}
          </button>
        </h3>
        {action && (
          <button
            type="button"
            class="button small"
            onClick={() => {
              action.onClick()
              setOpen(true)
            }}
          >
            <Icon name="plus" /> {action.label}
          </button>
        )}
      </header>
      {open && (
        <div class="section-body" id={bodyId}>
          {children}
        </div>
      )}
    </section>
  )
}

const statusClass = { valid: 'ok', invalid: 'error', incomplete: 'info', unchecked: 'info' } as const

type SectionArgs = { entry: Entry; update: (patch: Partial<Entry>) => void }

const DetailsSection = ({ entry, update, showLabel, focusLabel }: SectionArgs & { showLabel: boolean; focusLabel: boolean }) => {
  const { readOnly } = useUi()
  const labelRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (focusLabel) labelRef.current?.focus()
  }, [])
  const info = KIND_INFO[entry.kind]
  const crypto = isCrypto(entry.kind)
  const days = daysUntilExpiry(entry)
  const summary = [
    entry.description && 'description',
    entry.createdOn && `created ${entry.createdOn}`,
    entry.expiresOn && info.expires && `expires ${entry.expiresOn}`,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <Section id={`${entry.id}:details`} title="Details" summary={summary || 'empty'} defaultOpen={!entry.label}>
      {showLabel && (
        <Field label="Label" wide>
          <input
            ref={labelRef}
            class="input"
            value={entry.label}
            placeholder={`Untitled ${KIND_LABELS[entry.kind].toLowerCase()}`}
            readOnly={readOnly}
            onInput={(e) => update({ label: e.currentTarget.value })}
          />
        </Field>
      )}
      <Field label="Description" wide>
        <textarea
          class="input"
          rows={2}
          value={entry.description}
          placeholder="What is this wallet or key for?"
          readOnly={readOnly}
          onInput={(e) => update({ description: e.currentTarget.value })}
          {...SECRET_ATTRS}
          data-secret={undefined}
        />
      </Field>
      <div class="row">
        {crypto ? (
          <>
            <Field label={info.serviceLabel}>
              <input class="input" list="chains" value={entry.chain} readOnly={readOnly} onInput={(e) => update({ chain: e.currentTarget.value })} />
            </Field>
            <Field label={info.accountLabel}>
              <input class="input" list="wallets" value={entry.wallet} readOnly={readOnly} onInput={(e) => update({ wallet: e.currentTarget.value })} />
            </Field>
          </>
        ) : (
          <>
            <Field label={info.serviceLabel}>
              <input class="input" list="services" value={entry.service} readOnly={readOnly} onInput={(e) => update({ service: e.currentTarget.value })} />
            </Field>
            <Field label={info.accountLabel}>
              <input class="input" value={entry.account} readOnly={readOnly} onInput={(e) => update({ account: e.currentTarget.value })} {...EXACT_ATTRS} />
            </Field>
          </>
        )}
        <Field label="Date created">
          <input class="input" type="date" value={entry.createdOn} readOnly={readOnly} onInput={(e) => update({ createdOn: e.currentTarget.value })} />
        </Field>
        {info.expires && (
          <Field label="Expires on" hint={days === null ? 'Optional. You are warned 30 days ahead.' : undefined}>
            <input class="input" type="date" value={entry.expiresOn} readOnly={readOnly} onInput={(e) => update({ expiresOn: e.currentTarget.value })} />
          </Field>
        )}
      </div>
      {days !== null && days <= 30 && (
        <p class={`status ${days < 0 ? 'status-error' : 'status-warn'}`}>
          <Icon name="clock" /> {days < 0 ? `Expired on ${entry.expiresOn}.` : days === 0 ? 'Expires today.' : `Expires in ${days} day${days === 1 ? '' : 's'}.`}
        </p>
      )}
      <Field label="Tags" hint="Comma separated." wide>
        <TagsInput tags={entry.tags} onChange={(tags) => update({ tags })} />
      </Field>
    </Section>
  )
}

const MnemonicSection = ({ entry, update }: SectionArgs) => {
  const { readOnly, confirm } = useUi()
  const check = useAsync(() => checkMnemonic(entry.scheme, entry.words), [entry.scheme, entry.words.join(' ')])
  const scheme = SCHEMES.find((s) => s.id === entry.scheme)!
  const counts = [...new Set([...scheme.counts, ...COMMON_WORD_COUNTS])].sort((a, b) => a - b)
  const filled = entry.words.filter(Boolean).length

  const setCount = async (count: number) => {
    if (!Number.isInteger(count) || count < 1 || count > MAX_WORDS || count === entry.words.length) return
    const dropped = entry.words.slice(count).filter(Boolean).length
    if (
      dropped > 0 &&
      !(await confirm({
        title: 'Remove words?',
        message: `Shrinking to ${count} words removes ${dropped} word${dropped === 1 ? '' : 's'} you entered.`,
        confirmLabel: 'Remove',
        danger: true,
      }))
    ) {
      return
    }
    update({ words: Array.from({ length: count }, (_, i) => entry.words[i] ?? '') })
  }

  const setScheme = (id: MnemonicScheme) => {
    const next = SCHEMES.find((s) => s.id === id)!
    // Only resize automatically while the grid is still empty.
    if (filled === 0 && next.counts.length && !next.counts.includes(entry.words.length)) {
      update({ scheme: id, words: new Array(next.counts[0]).fill('') })
    } else {
      update({ scheme: id })
    }
  }

  const summary = `${scheme.label} · ${filled === entry.words.length ? plural(filled, 'word') : `${filled} of ${entry.words.length} words`}${
    entry.passphrase ? ' + passphrase' : ''
  }`

  return (
    <Section id={`${entry.id}:seed`} title="Seed phrase" icon="seed" summary={summary} defaultOpen>
      <div class="row">
        <Field label="Scheme">
          <select class="input" value={entry.scheme} disabled={readOnly} onChange={(e) => setScheme(e.currentTarget.value as MnemonicScheme)}>
            {SCHEMES.map((s) => (
              <option value={s.id}>{s.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Words">
          <select
            class="input"
            value={counts.includes(entry.words.length) ? String(entry.words.length) : 'custom'}
            disabled={readOnly}
            onChange={(e) => {
              const v = e.currentTarget.value
              if (v !== 'custom') setCount(Number(v))
            }}
          >
            {counts.map((n) => (
              <option value={String(n)}>
                {n}
                {scheme.counts.includes(n) ? '' : ' (non-standard)'}
              </option>
            ))}
            <option value="custom">Custom…</option>
          </select>
        </Field>
        {!counts.includes(entry.words.length) && (
          <Field label="Custom count">
            <input
              class="input"
              type="number"
              min={1}
              max={MAX_WORDS}
              value={entry.words.length}
              readOnly={readOnly}
              onChange={(e) => setCount(Number(e.currentTarget.value))}
            />
          </Field>
        )}
      </div>
      <WordGrid words={entry.words} scheme={entry.scheme} unknownWords={check?.unknownWords ?? []} onChange={(words) => update({ words })} />
      {check && (
        <p class={`status status-${statusClass[check.status]}`} role="status">
          <Icon name={check.status === 'valid' ? 'check' : check.status === 'invalid' ? 'alert' : 'shield'} /> {check.message}
        </p>
      )}
      <PassphraseFields entry={entry} update={update} />
    </Section>
  )
}

/** Passphrase (hidden) plus a visible hint, for kinds that have one. */
const PassphraseFields = ({ entry, update }: SectionArgs) => {
  const { readOnly } = useUi()
  const info = KIND_INFO[entry.kind]
  if (!info.passphraseLabel) return null
  return (
    <div class="row">
      <Field label={info.passphraseLabel} hint={info.passphraseHint}>
        <SecretField label="Passphrase" value={entry.passphrase} onInput={(passphrase) => update({ passphrase })} placeholder="None" />
      </Field>
      <Field label="Passphrase hint" hint="Not hidden. Never write the passphrase itself here.">
        <input class="input" value={entry.passphraseHint} readOnly={readOnly} onInput={(e) => update({ passphraseHint: e.currentTarget.value })} {...EXACT_ATTRS} />
      </Field>
    </div>
  )
}

const levelClass = { ok: 'ok', info: 'info', warn: 'warn', error: 'error' } as const

/** The key or token itself, with format recognition. */
const KeySection = ({ entry, update }: SectionArgs) => {
  const info = KIND_INFO[entry.kind]
  const format = useAsync(() => detectKeyFormat(entry.secret), [entry.secret])
  return (
    <Section id={`${entry.id}:key`} title={info.secretLabel} icon="key" summary={entry.secret ? format?.label ?? 'set' : 'empty'} defaultOpen>
      <Field label={info.secret === 'token' ? 'Value' : 'Key'} wide>
        <SecretField
          label={info.secretLabel}
          value={entry.secret}
          onInput={(secret) => update({ secret })}
          placeholder={info.secretPlaceholder}
          multiline={info.secret === 'key'}
          mono
        />
      </Field>
      {format && (
        <p class={`status status-${levelClass[format.level]}`} role="status">
          <Icon name={format.level === 'ok' ? 'check' : format.level === 'info' ? 'shield' : 'alert'} /> {format.label}
          {format.detail && <span class="muted"> · {format.detail}</span>}
        </p>
      )}
      <PassphraseFields entry={entry} update={update} />
    </Section>
  )
}

const CodesSection = ({ entry, update }: SectionArgs) => {
  const count = entry.secret.split(/\n/).filter((line) => line.trim()).length
  return (
    <Section id={`${entry.id}:codes`} title="Recovery codes" icon="list" summary={count ? `${count} code${count === 1 ? '' : 's'}` : 'empty'} defaultOpen>
      <Field label="Codes" hint="One per line. Delete or mark a code once used." wide>
        <SecretField label="Recovery codes" value={entry.secret} onInput={(secret) => update({ secret })} placeholder="One code per line" multiline mono />
      </Field>
    </Section>
  )
}

/** Warns when private key material was pasted into a field that is shown in clear. */
const PrivateMaterialWarning = ({ text }: { text: string }) => {
  const found = useAsync(() => findPrivateMaterial(text), [text])
  if (!found) return null
  return (
    <p class="status status-error" role="status">
      <Icon name="alert" /> This looks like private key material ({found}). This field is not hidden: move it to the secret field.
    </p>
  )
}

/** Fingerprints: keep what was typed, tidy pasted extras when the field is left. */
const tidyFingerprint = (value: string, master: boolean) => {
  let v = value.trim()
  if (master) {
    // "[73c5da0a/84h/0h/0h]" (descriptor key origin), "0x73c5da0a", spaces.
    v = v.replace(/^\[([0-9a-fA-F]{8})[^\]]*\].*$/, '$1').replace(/^0x/i, '').replace(/\s+/g, '')
  }
  return v
}

/** Derivation paths: straight apostrophes, lowercase m. */
const tidyPath = (value: string) => value.trim().replace(/[’‘′`]/g, "'").replace(/^M\//, 'm/')

const PublicKeySection = ({ entry, update }: SectionArgs) => {
  const { readOnly } = useUi()
  const config = KIND_INFO[entry.kind].publicKey
  if (!config) return null
  const fingerprintLeak = useAsync(() => findPrivateMaterial(entry.fingerprint), [entry.fingerprint])
  const summary = [entry.publicInfo && 'public key', entry.fingerprint && (fingerprintLeak ? 'fingerprint' : entry.fingerprint)]
    .filter(Boolean)
    .join(' · ')
  const pgpFingerprintBad =
    entry.kind === 'pgpKey' && entry.fingerprint && !/^([0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(entry.fingerprint.replace(/\s/g, ''))
  return (
    <Section id={`${entry.id}:public`} title="Public info" icon="eye" summary={summary || 'empty'} defaultOpen={false}>
      <p class="muted small helper">Not secret. Lets you match this entry to a server, keyring or recipient.</p>
      <Field label={config.label} wide>
        <textarea
          class="input mono"
          rows={entry.publicInfo ? 3 : 2}
          value={entry.publicInfo}
          placeholder={config.placeholder}
          readOnly={readOnly}
          onInput={(e) => update({ publicInfo: e.currentTarget.value })}
          {...EXACT_ATTRS}
        />
      </Field>
      <PrivateMaterialWarning text={entry.publicInfo} />
      <Field label={config.fingerprintLabel} wide>
        <input
          class="input mono"
          value={entry.fingerprint}
          placeholder={config.fingerprintPlaceholder}
          readOnly={readOnly}
          onInput={(e) => update({ fingerprint: e.currentTarget.value })}
          onBlur={(e) => {
            const tidy = tidyFingerprint(e.currentTarget.value, false)
            if (tidy !== entry.fingerprint) update({ fingerprint: tidy })
          }}
          {...EXACT_ATTRS}
        />
      </Field>
      <PrivateMaterialWarning text={entry.fingerprint} />
      {pgpFingerprintBad && (
        <p class="status status-warn">
          <Icon name="alert" /> PGP fingerprints are 40 hex characters (64 for newer v6 keys).
        </p>
      )}
    </Section>
  )
}

const PublicInfoSection = ({ entry, update }: SectionArgs) => {
  const { readOnly } = useUi()
  const filled = Boolean(entry.derivationPath || entry.fingerprint || entry.publicInfo)
  const fingerprintLeak = useAsync(() => findPrivateMaterial(entry.fingerprint), [entry.fingerprint])
  const summary = [entry.derivationPath, entry.fingerprint && (fingerprintLeak ? 'fingerprint' : entry.fingerprint), entry.publicInfo && 'addresses']
    .filter(Boolean)
    .join(' · ')
  const path = entry.derivationPath.trim()
  return (
    <Section id={`${entry.id}:public`} title="Public info" icon="eye" summary={summary || 'empty'} defaultOpen={false}>
      <p class="muted small helper">Not secret. Helps you recognize the wallet without revealing the secret.</p>
      <div class="row">
        <Field label="Derivation path">
          <input
            class="input mono"
            list="paths"
            value={entry.derivationPath}
            placeholder="m/84'/0'/0'"
            readOnly={readOnly}
            onInput={(e) => update({ derivationPath: e.currentTarget.value })}
            onBlur={(e) => {
              const tidy = tidyPath(e.currentTarget.value)
              if (tidy !== entry.derivationPath) update({ derivationPath: tidy })
            }}
            {...EXACT_ATTRS}
          />
        </Field>
        <Field label="Master fingerprint">
          <input
            class="input mono"
            value={entry.fingerprint}
            placeholder="e.g. 73c5da0a"
            readOnly={readOnly}
            onInput={(e) => update({ fingerprint: e.currentTarget.value })}
            onBlur={(e) => {
              const tidy = tidyFingerprint(e.currentTarget.value, true)
              if (tidy !== entry.fingerprint) update({ fingerprint: tidy })
            }}
            {...EXACT_ATTRS}
          />
        </Field>
      </div>
      {path && !/^m(\/\d+['hH]?)*$/.test(path) && (
        <p class="status status-warn">
          <Icon name="alert" />{' '}
          {/[’‘′`]/.test(path)
            ? "Use straight apostrophes (') in derivation paths; curly ones are fixed when you leave the field."
            : "Derivation paths look like m/84'/0'/0'."}
        </p>
      )}
      {entry.fingerprint && !fingerprintLeak && !/^[0-9a-fA-F]{8}$/.test(entry.fingerprint.trim()) && (
        <p class="status status-warn">
          <Icon name="alert" /> A master fingerprint is 8 hex characters.
        </p>
      )}
      <Field label="Addresses / xpub" wide>
        <textarea
          class="input mono"
          rows={filled ? 3 : 2}
          value={entry.publicInfo}
          placeholder="First receive address, xpub/zpub…"
          readOnly={readOnly}
          onInput={(e) => update({ publicInfo: e.currentTarget.value })}
          {...EXACT_ATTRS}
        />
      </Field>
      <PrivateMaterialWarning text={entry.publicInfo} />
      <PrivateMaterialWarning text={entry.fingerprint} />
    </Section>
  )
}

const BackupsSection = ({ entry, update, reminderMonths }: SectionArgs & { reminderMonths: number }) => {
  const { readOnly } = useUi()
  const setBackup = (id: string, patch: Partial<Entry['backups'][number]>) =>
    update({ backups: entry.backups.map((b) => (b.id === id ? { ...b, ...patch } : b)) })
  const due = isBackupDue(entry, reminderMonths)
  const last = lastVerified(entry)
  const summary = (
    <span class={due ? 'status-warn' : undefined}>
      {entry.backups.length ? plural(entry.backups.length, 'location') : 'none recorded'}
      {last ? ` · checked ${last}` : ''}
      {due ? ' · check due' : ''}
    </span>
  )
  return (
    <Section
      id={`${entry.id}:backups`}
      title="Backups"
      icon="shield"
      summary={summary}
      defaultOpen={false}
      action={readOnly ? undefined : { label: 'Add location', onClick: () => update({ backups: [...entry.backups, { id: newId(), location: '', verifiedOn: '' }] }) }}
    >
      <p class={`status ${due ? 'status-warn' : 'status-info'}`}>
        <Icon name={due ? 'alert' : 'check'} /> {last ? `Last checked ${last}.` : 'No backup check recorded.'}
        {due && reminderMonths > 0 && ` Check your backups at least every ${reminderMonths} months.`}
      </p>
      {entry.backups.length === 0 && (
        <p class="muted small helper">Record where copies are kept, like "steel plate in home safe". Do not record the secret itself here.</p>
      )}
      {entry.backups.map((b) => (
        <div class="row backup-row" key={b.id}>
          <input
            class="input grow"
            value={b.location}
            placeholder="Location, e.g. steel plate in safe"
            aria-label="Backup location"
            readOnly={readOnly}
            onInput={(e) => setBackup(b.id, { location: e.currentTarget.value })}
            {...EXACT_ATTRS}
          />
          <input
            class="input"
            type="date"
            value={b.verifiedOn}
            aria-label="Last checked"
            readOnly={readOnly}
            onInput={(e) => setBackup(b.id, { verifiedOn: e.currentTarget.value })}
          />
          {!readOnly && (
            <>
              <button type="button" class="button small" onClick={() => setBackup(b.id, { verifiedOn: today() })}>
                Checked today
              </button>
              <button
                type="button"
                class="icon-button"
                aria-label="Remove backup location"
                title="Remove"
                onClick={() => update({ backups: entry.backups.filter((x) => x.id !== b.id) })}
              >
                <Icon name="x" />
              </button>
            </>
          )}
        </div>
      ))}
    </Section>
  )
}

const CustomFieldsSection = ({ entry, update }: SectionArgs) => {
  const { readOnly } = useUi()
  const setField = (id: string, patch: Partial<Entry['customFields'][number]>) =>
    update({ customFields: entry.customFields.map((f) => (f.id === id ? { ...f, ...patch } : f)) })
  const primary = KIND_INFO[entry.kind].secret === 'fields'
  return (
    <Section
      id={`${entry.id}:fields`}
      title={primary ? 'Fields' : 'Extra fields'}
      icon="plus"
      summary={entry.customFields.length ? plural(entry.customFields.length, 'field') : 'none'}
      defaultOpen={primary}
      action={
        readOnly
          ? undefined
          : { label: 'Add field', onClick: () => update({ customFields: [...entry.customFields, { id: newId(), label: '', value: '', hidden: true }] }) }
      }
    >
      {entry.customFields.length === 0 && (
        <p class="muted small helper">For PINs, keystore passwords, 2FA backup codes, multisig details or anything else.</p>
      )}
      {entry.customFields.map((f) => (
        <div class="custom-field" key={f.id}>
          <input
            class="input custom-label"
            value={f.label}
            placeholder="Label"
            aria-label="Field label"
            readOnly={readOnly}
            onInput={(e) => setField(f.id, { label: e.currentTarget.value })}
          />
          <div class="custom-value">
            {f.hidden ? (
              <SecretField
                label={f.label || 'Field'}
                value={f.value}
                multiline={f.multiline}
                onInput={(value) => setField(f.id, { value })}
                onMultilinePaste={(value) => setField(f.id, { value, multiline: true })}
              />
            ) : f.multiline ? (
              <textarea
                class="input"
                rows={3}
                value={f.value}
                aria-label={f.label || 'Field value'}
                readOnly={readOnly}
                onInput={(e) => setField(f.id, { value: e.currentTarget.value })}
                {...EXACT_ATTRS}
              />
            ) : (
              <input
                class="input"
                value={f.value}
                aria-label={f.label || 'Field value'}
                readOnly={readOnly}
                onInput={(e) => setField(f.id, { value: e.currentTarget.value })}
                {...EXACT_ATTRS}
                onPaste={(e) => {
                  // A multi-line paste switches the field to multi-line instead of losing the line breaks.
                  const text = e.clipboardData?.getData('text') ?? ''
                  if (!/[\r\n]/.test(text)) return
                  e.preventDefault()
                  const input = e.currentTarget
                  const start = input.selectionStart ?? f.value.length
                  const end = input.selectionEnd ?? f.value.length
                  setField(f.id, { value: f.value.slice(0, start) + text + f.value.slice(end), multiline: true })
                }}
              />
            )}
          </div>
          {!readOnly && (
            <div class="custom-actions">
              <label class="check small">
                <input
                  type="checkbox"
                  checked={f.hidden}
                  aria-label={`Hide ${f.label || 'field'} value`}
                  onChange={(e) => setField(f.id, { hidden: e.currentTarget.checked })}
                />{' '}
                Hidden
              </label>
              <button
                type="button"
                class="icon-button"
                aria-label="Remove field"
                title="Remove"
                onClick={() => update({ customFields: entry.customFields.filter((x) => x.id !== f.id) })}
              >
                <Icon name="x" />
              </button>
            </div>
          )}
        </div>
      ))}
    </Section>
  )
}

const NotesSection = ({ entry, update }: SectionArgs) => {
  const { readOnly } = useUi()
  return (
    <Section
      id={`${entry.id}:notes`}
      title="Notes"
      summary={entry.notes ? plural(entry.notes.length, 'character') : 'empty'}
      defaultOpen={Boolean(entry.notes) && entry.kind === 'other'}
    >
      <textarea
        class="input"
        rows={4}
        value={entry.notes}
        placeholder="Recovery instructions, inheritance notes, history…"
        aria-label="Notes"
        readOnly={readOnly}
        onInput={(e) => update({ notes: e.currentTarget.value })}
        {...SECRET_ATTRS}
      />
    </Section>
  )
}

const TagsInput = ({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) => {
  const { readOnly } = useUi()
  const [text, setText] = useState(tags.join(', '))
  useEffect(() => setText(tags.join(', ')), [tags.join(',')])
  const commit = () => {
    const next = [...new Set(text.split(',').map((t) => t.trim()).filter(Boolean))]
    if (next.join(',') !== tags.join(',')) onChange(next)
    setText(next.join(', '))
  }
  return (
    <input
      class="input"
      value={text}
      placeholder="cold storage, inheritance"
      readOnly={readOnly}
      onInput={(e) => setText(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  )
}

export interface EntryHandlers {
  onUpdate: (patch: Partial<Entry>) => void
  onDelete: () => void
  onDuplicate: () => void
}

/** Favorite, duplicate, archive and delete buttons. */
export const EntryActions = ({ entry, onUpdate, onDelete, onDuplicate }: { entry: Entry } & EntryHandlers) => {
  const { readOnly } = useUi()
  return (
    <div class="entry-actions">
      <button
        type="button"
        class={`icon-button ${entry.favorite ? 'active' : ''}`}
        aria-pressed={entry.favorite}
        aria-label="Favorite"
        title="Favorite"
        disabled={readOnly}
        onClick={() => onUpdate({ favorite: !entry.favorite })}
      >
        <Icon name="star" fill={entry.favorite ? 'currentColor' : 'none'} />
      </button>
      {!readOnly && (
        <>
          <button type="button" class="icon-button" aria-label="Duplicate" title="Duplicate" onClick={onDuplicate}>
            <Icon name="duplicate" />
          </button>
          <button
            type="button"
            class={`icon-button ${entry.archived ? 'active' : ''}`}
            aria-pressed={entry.archived}
            aria-label={entry.archived ? 'Unarchive' : 'Archive'}
            title={entry.archived ? 'Unarchive' : 'Archive (e.g. an emptied or retired wallet)'}
            onClick={() => onUpdate({ archived: !entry.archived })}
          >
            <Icon name="archive" />
          </button>
          <button type="button" class="icon-button danger" aria-label="Delete" title="Delete" onClick={onDelete}>
            <Icon name="trash" />
          </button>
        </>
      )}
    </div>
  )
}

const formatDateTime = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

interface BodyProps {
  entry: Entry
  reminderMonths: number
  onUpdate: (patch: Partial<Entry>) => void
  /** Cards show the label inside Details; the side panel shows it in its header. */
  showLabel: boolean
  focusLabel?: boolean
}

/** The sections of an entry, shared by the card and side-panel layouts. */
export const EntryBody = ({ entry, reminderMonths, onUpdate, showLabel, focusLabel = false }: BodyProps) => {
  const { readOnly } = useUi()
  const update = (patch: Partial<Entry>) => !readOnly && onUpdate(patch)
  const secret = KIND_INFO[entry.kind].secret
  return (
    <div class="entry-body">
      <DetailsSection entry={entry} update={update} showLabel={showLabel} focusLabel={focusLabel} />
      {secret === 'words' && <MnemonicSection entry={entry} update={update} />}
      {(secret === 'key' || secret === 'token') && <KeySection entry={entry} update={update} />}
      {secret === 'codes' && <CodesSection entry={entry} update={update} />}
      {secret === 'fields' && <CustomFieldsSection entry={entry} update={update} />}
      {isCrypto(entry.kind) ? <PublicInfoSection entry={entry} update={update} /> : <PublicKeySection entry={entry} update={update} />}
      {secret !== 'fields' && <CustomFieldsSection entry={entry} update={update} />}
      <BackupsSection entry={entry} update={update} reminderMonths={reminderMonths} />
      <NotesSection entry={entry} update={update} />
      <footer class="editor-footer muted small">
        Added {formatDateTime(entry.addedAt)} · Updated {formatDateTime(entry.updatedAt)}
      </footer>
    </div>
  )
}

interface EditorProps extends EntryHandlers {
  entry: Entry
  reminderMonths: number
  onBack: () => void
  focusLabel?: boolean
}

/** Side panel editor for the "list + editor" layout. */
export const EntryEditor = ({ entry, reminderMonths, onUpdate, onDelete, onDuplicate, onBack, focusLabel }: EditorProps) => {
  const { readOnly } = useUi()
  const labelRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (focusLabel) labelRef.current?.focus()
  }, [])
  return (
    <article class="editor" aria-label={entry.label || 'Untitled entry'}>
      <header class="editor-header">
        <button type="button" class="icon-button back-button" aria-label="Back to list" title="Back" onClick={onBack}>
          <Icon name="back" />
        </button>
        <input
          ref={labelRef}
          class="input title-input"
          value={entry.label}
          placeholder={`Untitled ${KIND_LABELS[entry.kind].toLowerCase()}`}
          aria-label="Label"
          readOnly={readOnly}
          onInput={(e) => !readOnly && onUpdate({ label: e.currentTarget.value })}
        />
        <span class={`badge badge-${entry.kind}`}>{KIND_LABELS[entry.kind]}</span>
        <EntryActions entry={entry} onUpdate={onUpdate} onDelete={onDelete} onDuplicate={onDuplicate} />
      </header>
      <div class="editor-body">
        <EntryBody entry={entry} reminderMonths={reminderMonths} onUpdate={onUpdate} showLabel={false} />
      </div>
    </article>
  )
}
