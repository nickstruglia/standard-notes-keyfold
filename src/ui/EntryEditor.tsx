import { useEffect, useRef, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { Icon, type IconName } from './icons'
import { SecretField } from './Secret'
import { WordGrid } from './WordGrid'
import { KIND_LABELS } from './labels'
import { SECRET_ATTRS, useAsync, useSection, useUi } from './context'
import { COMMON_WORD_COUNTS, MAX_WORDS, SCHEMES, type MnemonicScheme, checkMnemonic } from '../lib/mnemonic'
import { detectKeyFormat } from '../lib/keyformat'
import { type Entry, isBackupDue, lastVerified, today } from '../lib/vault'
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
  const summary = [entry.description && 'description', entry.createdOn && `created ${entry.createdOn}`].filter(Boolean).join(' · ')
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
        />
      </Field>
      <div class="row">
        <Field label="Chain / coin">
          <input class="input" list="chains" value={entry.chain} readOnly={readOnly} onInput={(e) => update({ chain: e.currentTarget.value })} />
        </Field>
        <Field label="Wallet / device">
          <input class="input" list="wallets" value={entry.wallet} readOnly={readOnly} onInput={(e) => update({ wallet: e.currentTarget.value })} />
        </Field>
        <Field label="Date created">
          <input class="input" type="date" value={entry.createdOn} readOnly={readOnly} onInput={(e) => update({ createdOn: e.currentTarget.value })} />
        </Field>
      </div>
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
      <div class="row">
        <Field label="Passphrase (25th word)" hint="Optional BIP39 passphrase. A different passphrase opens a different wallet.">
          <SecretField label="Passphrase" value={entry.passphrase} onInput={(passphrase) => update({ passphrase })} placeholder="None" />
        </Field>
        <Field label="Passphrase hint" hint="Not hidden. Never write the passphrase itself here.">
          <input class="input" value={entry.passphraseHint} readOnly={readOnly} onInput={(e) => update({ passphraseHint: e.currentTarget.value })} />
        </Field>
      </div>
    </Section>
  )
}

const levelClass = { ok: 'ok', info: 'info', warn: 'warn', error: 'error' } as const

const PrivateKeySection = ({ entry, update }: SectionArgs) => {
  const format = useAsync(() => detectKeyFormat(entry.privateKey), [entry.privateKey])
  return (
    <Section id={`${entry.id}:key`} title="Private key" icon="key" summary={entry.privateKey ? format?.label ?? 'set' : 'empty'} defaultOpen>
      <Field label="Key" wide>
        <SecretField
          label="Private key"
          value={entry.privateKey}
          onInput={(privateKey) => update({ privateKey })}
          placeholder="Hex, WIF, xprv, nsec, base58, keystore JSON…"
          multiline
          mono
        />
      </Field>
      {format && (
        <p class={`status status-${levelClass[format.level]}`} role="status">
          <Icon name={format.level === 'ok' ? 'check' : format.level === 'info' ? 'shield' : 'alert'} /> {format.label}
          {format.detail && <span class="muted"> · {format.detail}</span>}
        </p>
      )}
    </Section>
  )
}

const PublicInfoSection = ({ entry, update }: SectionArgs) => {
  const { readOnly } = useUi()
  const filled = Boolean(entry.derivationPath || entry.fingerprint || entry.publicInfo)
  const summary = [entry.derivationPath, entry.fingerprint, entry.publicInfo && 'addresses'].filter(Boolean).join(' · ')
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
            spellcheck={false}
          />
        </Field>
        <Field label="Master fingerprint">
          <input
            class="input mono"
            value={entry.fingerprint}
            placeholder="e.g. 73c5da0a"
            maxLength={8}
            readOnly={readOnly}
            onInput={(e) => update({ fingerprint: e.currentTarget.value.trim() })}
            spellcheck={false}
          />
        </Field>
      </div>
      {entry.derivationPath && !/^m(\/\d+['hH]?)*$/.test(entry.derivationPath.trim()) && (
        <p class="status status-warn">
          <Icon name="alert" /> Derivation paths look like m/84'/0'/0'.
        </p>
      )}
      {entry.fingerprint && !/^[0-9a-fA-F]{8}$/.test(entry.fingerprint) && (
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
          spellcheck={false}
        />
      </Field>
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
  const primary = entry.kind === 'other'
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
              <SecretField label={f.label || 'Field'} value={f.value} onInput={(value) => setField(f.id, { value })} />
            ) : (
              <input class="input" value={f.value} aria-label={f.label || 'Field value'} readOnly={readOnly} onInput={(e) => setField(f.id, { value: e.currentTarget.value })} />
            )}
          </div>
          {!readOnly && (
            <div class="custom-actions">
              <label class="check small">
                <input type="checkbox" checked={f.hidden} onChange={(e) => setField(f.id, { hidden: e.currentTarget.checked })} /> Hidden
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
  return (
    <div class="entry-body">
      <DetailsSection entry={entry} update={update} showLabel={showLabel} focusLabel={focusLabel} />
      {entry.kind === 'mnemonic' && <MnemonicSection entry={entry} update={update} />}
      {entry.kind === 'privateKey' && <PrivateKeySection entry={entry} update={update} />}
      {entry.kind === 'other' && <CustomFieldsSection entry={entry} update={update} />}
      {entry.kind !== 'other' && <PublicInfoSection entry={entry} update={update} />}
      {entry.kind !== 'other' && <CustomFieldsSection entry={entry} update={update} />}
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
