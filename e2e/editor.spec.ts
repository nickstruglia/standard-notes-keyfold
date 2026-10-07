import { expect, test, type Page } from '@playwright/test'

// Runs the production build inside dev/host.html, a mock of the Standard
// Notes side of the component protocol.

const PHRASE = 'legal winner thank year wave sausage worth useful legal winner thank yellow'

const noteText = (page: Page) => page.evaluate(() => (window as any).mockHost.note.content.text as string)
const noteJson = async (page: Page) => {
  try {
    return JSON.parse(await noteText(page))
  } catch {
    return null
  }
}
const preview = (page: Page) => page.evaluate(() => (window as any).mockHost.note.content.preview_plain as string)

const open = async (page: Page, text = '') => {
  const errors: string[] = []
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()))
  page.on('pageerror', (err) => errors.push(err.message))
  await page.goto('/dev/host.html' + (text ? `?text=${encodeURIComponent(text)}` : ''))
  return { app: page.frameLocator('#editor'), errors }
}

type App = ReturnType<Page['frameLocator']>

/** Adds an entry through the toolbar's Add menu. */
const add = async (app: App, kind: 'Seed phrase' | 'Private key' | 'Other secret') => {
  await app.getByRole('button', { name: 'Add' }).click()
  await app.getByRole('menuitem', { name: kind }).click()
}

const vaultText = (entries: object[], settings: object = {}) =>
  JSON.stringify({ app: 'sn-crypto-vault', version: 1, vault: { entries, settings } })

const seed = (id: string, label: string, chain: string, phrase: string) => ({
  id,
  kind: 'mnemonic',
  label,
  chain,
  words: phrase.split(' '),
  createdOn: '2024-01-01',
})

const SEEDS = [
  seed('a', 'Cold storage', 'Bitcoin', 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'),
  seed('b', 'Multisig key 2', 'Bitcoin', 'letter advice cage absurd amount doctor acoustic avoid letter advice cage above'),
  seed('c', 'DeFi wallet', 'Ethereum', 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong'),
]

const pastePhrase = async (page: Page, phrase: string) => {
  await page
    .frameLocator('#editor')
    .getByLabel('Word 1', { exact: true })
    .evaluate((el, text) => {
      const data = new DataTransfer()
      data.setData('text', text)
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    }, phrase)
}

test('creates a seed phrase entry, validates it and saves JSON to the note', async ({ page }) => {
  const { app, errors } = await open(page)
  await expect(app.getByText('No secrets yet.')).toBeVisible()

  await add(app, 'Seed phrase')
  await app.getByLabel('Label').fill('Cold storage')
  await pastePhrase(page, PHRASE)

  await expect(app.getByText('Valid BIP39 checksum (12 words).')).toBeVisible()
  // Words are masked until revealed.
  const security = await app.getByLabel('Word 1', { exact: true }).evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-text-security'))
  expect(security).toBe('disc')

  await expect.poll(() => noteText(page)).toContain('"yellow"')
  const doc = JSON.parse(await noteText(page))
  expect(doc.app).toBe('sn-crypto-vault')
  expect(doc.vault.entries[0].label).toBe('Cold storage')
  expect(doc.vault.entries[0].words.join(' ')).toBe(PHRASE)
  expect(await preview(page)).toBe('Crypto Vault: 1 seed phrase')
  expect(await preview(page)).not.toContain('legal')

  // A typo is flagged with suggestions.
  await app.getByLabel('Word 3', { exact: true }).fill('thnk')
  await app.getByLabel('Word 4', { exact: true }).focus()
  await expect(app.getByText('Not in the BIP39 wordlist: #3.')).toBeVisible()

  expect(errors).toEqual([])
})

test('reveals, copies with a toast, and hides all', async ({ page }) => {
  const { app } = await open(page)
  await add(app, 'Seed phrase')
  await pastePhrase(page, PHRASE)
  await app.getByRole('button', { name: 'Reveal words' }).click()
  const security = () =>
    app.getByLabel('Word 1', { exact: true }).evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-text-security'))
  expect(await security()).toBe('none')

  await app.getByRole('button', { name: 'Copy phrase' }).click()
  await expect(app.getByText('Seed phrase copied. Clipboard clears in 30s.')).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(PHRASE)

  await app.getByRole('button', { name: 'Hide all' }).click()
  expect(await security()).toBe('disc')
})

test('detects private key formats', async ({ page }) => {
  const { app } = await open(page)
  await add(app, 'Private key')
  await app.getByLabel('Private key', { exact: true }).fill('KwdMAjGmerYanjeui5SHS7JkmpZvVipYvB2LJGU1ZxJwYvP98617')
  await expect(app.getByText('WIF private key (Bitcoin mainnet, compressed)')).toBeVisible()
  await app.getByLabel('Private key', { exact: true }).fill('KwdMAjGmerYanjeui5SHS7JkmpZvVipYvB2LJGU1ZxJwYvP98618')
  await expect(app.getByText('Looks like WIF, but the checksum fails')).toBeVisible()
})

test('vault password encrypts the note, locks and unlocks', async ({ page }) => {
  const { app, errors } = await open(page)
  await add(app, 'Seed phrase')
  await app.getByLabel('Label').fill('Encrypted wallet')
  await pastePhrase(page, PHRASE)

  await app.getByRole('button', { name: 'Settings' }).click()
  await app.getByRole('button', { name: 'Set a vault password' }).click()
  await app.getByLabel('New vault password').fill('correct horse battery staple')
  await app.getByLabel('Repeat new password').fill('correct horse battery staple')
  await app.getByRole('checkbox', { name: /I understand/ }).check()
  await app.getByRole('button', { name: 'Set password' }).click()
  await expect(app.getByText('This vault is password protected.')).toBeVisible()

  await expect.poll(async () => (await noteJson(page))?.encryption?.cipher).toBe('AES-256-GCM')
  const stored = await noteText(page)
  expect(stored).not.toContain('legal')
  expect(stored).not.toContain('Encrypted wallet')
  expect(await preview(page)).toBe('Crypto Vault (password protected)')

  await app.getByRole('button', { name: 'Lock now' }).click()
  await expect(app.getByText('Vault locked')).toBeVisible()
  await app.getByLabel('Vault password').fill('wrong password')
  await app.getByRole('button', { name: 'Unlock' }).click()
  await expect(app.getByText('Wrong password, or the vault data is damaged.')).toBeVisible()
  await app.getByLabel('Vault password').fill('correct horse battery staple')
  await app.getByRole('button', { name: 'Unlock' }).click()
  await expect(app.getByText('Encrypted wallet')).toBeVisible()
  // The toolbar's Lock button works too.
  await app.getByRole('button', { name: 'Lock', exact: true }).click()
  await expect(app.getByText('Vault locked')).toBeVisible()
  await app.getByLabel('Vault password').fill('correct horse battery staple')
  await app.getByRole('button', { name: 'Unlock' }).click()
  await expect(app.getByText('Encrypted wallet')).toBeVisible()

  // Reloading the editor (like reopening the note) asks for the password again.
  await page.getByRole('button', { name: 'Reload editor' }).click()
  await expect(app.getByText('Vault locked')).toBeVisible()
  expect(errors).toEqual([])
})

test('respects "Prevent editing" and remote changes', async ({ page }) => {
  const { app } = await open(page)
  await add(app, 'Other secret')
  await app.getByLabel('Label').fill('Exchange')
  await expect.poll(() => noteText(page)).toContain('Exchange')

  await page.getByRole('button', { name: 'Toggle "Prevent editing"' }).click()
  await expect(app.getByText('"Prevent editing" is on for this note.')).toBeVisible()
  await expect(app.getByRole('button', { name: 'Add' })).toHaveCount(0)
  await expect(app.getByLabel('Label')).toHaveAttribute('readonly', '')
  await page.getByRole('button', { name: 'Toggle "Prevent editing"' }).click()

  await page.getByRole('button', { name: 'Simulate edit from another device' }).click()
  await expect(app.getByText('Added on another device')).toBeVisible()
})

test('never overwrites a note that has other content', async ({ page }) => {
  const { app } = await open(page, 'my old note')
  await expect(app.getByText('This note already has other content')).toBeVisible()
  expect(await noteText(page)).toBe('my old note')
  await app.getByRole('button', { name: 'Convert to a vault' }).click()
  await app.getByRole('button', { name: 'Convert', exact: true }).click()
  await expect(app.getByText('Imported note')).toBeVisible()
  await expect.poll(async () => (await noteJson(page))?.vault?.entries[0]?.notes).toBe('my old note')
})

test('applies Standard Notes themes', async ({ page }) => {
  const { app, errors } = await open(page)
  await expect(app.getByText('No secrets yet.')).toBeVisible()
  await page.getByRole('button', { name: 'Toggle dark theme' }).click()
  await expect
    .poll(() => app.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe('rgb(21, 22, 26)')
  expect(errors).toEqual([])
})

test('demo mode when opened directly', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText(/Demo mode/)).toBeVisible()
  await expect(page.getByText('Example: cold storage')).toBeVisible()
  await expect(page.getByText('http://127.0.0.1:4173/ext.json')).toBeVisible()
})

test('keeps several seed phrases in one note as expandable cards', async ({ page }) => {
  const { app, errors } = await open(page)
  const labels = ['Ledger', 'Trezor', 'MetaMask']
  for (const label of labels) {
    await add(app, 'Seed phrase')
    await app.getByLabel('Label').fill(label)
    await pastePhrase(page, PHRASE)
    await app.getByRole('button', { name: 'Collapse all' }).click()
  }
  await expect.poll(async () => (await noteJson(page))?.vault?.entries?.length).toBe(3)
  expect(await preview(page)).toBe('Crypto Vault: 3 seed phrases')
  await expect(app.getByText('3 entries')).toBeVisible()

  // Collapsed cards show one line each and no word fields.
  await expect(app.getByLabel('Word 1', { exact: true })).toHaveCount(0)
  await app.getByRole('button', { name: /Trezor/ }).click()
  await expect(app.getByLabel('Word 1', { exact: true })).toHaveCount(1)
  await app.getByRole('button', { name: 'Expand all' }).click()
  await expect(app.getByLabel('Word 1', { exact: true })).toHaveCount(3)

  // "Open one entry at a time" closes the others.
  await app.getByRole('button', { name: 'Collapse all' }).click()
  await app.getByRole('button', { name: 'View' }).click()
  await app.getByLabel('Open one entry at a time').check()
  await page.keyboard.press('Escape')
  await app.getByRole('button', { name: /Ledger/ }).click()
  await app.getByRole('button', { name: /MetaMask/ }).click()
  await expect(app.getByLabel('Word 1', { exact: true })).toHaveCount(1)
  await expect(app.getByRole('button', { name: /MetaMask/ })).toHaveAttribute('aria-expanded', 'true')
  await expect(app.getByRole('button', { name: /Ledger/ })).toHaveAttribute('aria-expanded', 'false')
  expect(errors).toEqual([])
})

test('sections inside an entry collapse to a one-line summary', async ({ page }) => {
  const { app } = await open(page, vaultText([{ ...SEEDS[0], backups: [{ id: 'x', location: 'Safe', verifiedOn: '2026-01-05' }] }]))
  await app.getByRole('button', { name: /Cold storage/ }).click()
  const backups = app.getByRole('button', { name: /^Backups/ })
  await expect(backups).toHaveAttribute('aria-expanded', 'false')
  await expect(backups).toContainText('1 location · checked 2026-01-05')
  await expect(app.getByLabel('Backup location', { exact: true })).toHaveCount(0)
  await backups.click()
  await expect(app.getByLabel('Backup location', { exact: true })).toHaveValue('Safe')

  const seedSection = app.getByRole('button', { name: /^Seed phrase/ })
  await seedSection.click()
  await expect(seedSection).toContainText('BIP39 · 12 words')
  await expect(app.getByLabel('Word 1', { exact: true })).toHaveCount(0)
})

test('groups entries and collapses groups', async ({ page }) => {
  const { app } = await open(page, vaultText(SEEDS))
  await app.getByRole('button', { name: 'View' }).click()
  await app.getByLabel('Group by').selectOption('chain')
  await page.keyboard.press('Escape')

  const bitcoin = app.getByRole('button', { name: /Bitcoin\s*2/ })
  await expect(bitcoin).toBeVisible()
  await expect(app.getByRole('button', { name: /Ethereum\s*1/ })).toBeVisible()
  await bitcoin.click()
  await expect(app.getByText('Cold storage')).toHaveCount(0)
  await expect(app.getByText('DeFi wallet')).toBeVisible()
  await expect.poll(async () => (await noteJson(page))?.vault?.settings?.groupBy).toBe('chain')
})

test('compact density and the side-by-side layout', async ({ page }) => {
  const { app } = await open(page, vaultText(SEEDS))
  await app.getByRole('button', { name: 'View' }).click()
  await app.getByLabel('Compact').check()
  await expect(app.locator('.app.compact')).toHaveCount(1)
  await app.getByLabel('List + editor side by side').check()
  await page.keyboard.press('Escape')

  await app.getByRole('button', { name: /DeFi wallet/ }).click()
  await expect(app.getByLabel('Label')).toHaveValue('DeFi wallet')
  await expect.poll(async () => (await noteJson(page))?.vault?.settings).toMatchObject({ density: 'compact', layout: 'split' })
})

test('view options still work when the note is read-only', async ({ page }) => {
  const { app } = await open(page, vaultText(SEEDS))
  await page.getByRole('button', { name: 'Toggle "Prevent editing"' }).click()
  await expect(app.getByText('"Prevent editing" is on for this note.')).toBeVisible()
  const before = await noteText(page)
  await app.getByRole('button', { name: 'View' }).click()
  await app.getByLabel('Compact').check()
  await expect(app.locator('.app.compact')).toHaveCount(1)
  expect(await noteText(page)).toBe(before)
})
