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

const open = async (page: Page, text = '', options: Record<string, string> = {}) => {
  const errors: string[] = []
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()))
  page.on('pageerror', (err) => errors.push(err.message))
  const query = new URLSearchParams({ ...(text ? { text } : {}), ...options }).toString()
  await page.goto('/dev/host.html' + (query ? `?${query}` : ''))
  return { app: page.frameLocator('#editor'), errors }
}

type App = ReturnType<Page['frameLocator']>

/** Adds an entry through the toolbar's Add menu. */
const add = async (app: App, kind: string) => {
  await app.getByRole('button', { name: 'Add' }).click()
  await app.getByRole('menuitem', { name: kind }).click()
}

const vaultText = (entries: object[], settings: object = {}) =>
  JSON.stringify({ app: 'keyfold', version: 1, vault: { entries, settings } })

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
  await expect(app.getByText('No keys yet.')).toBeVisible()

  await add(app, 'Seed phrase')
  await app.getByLabel('Label').fill('Cold storage')
  await pastePhrase(page, PHRASE)

  await expect(app.getByText('Valid BIP39 checksum (12 words).')).toBeVisible()
  // Words are real password fields until revealed.
  await expect(app.getByLabel('Word 1', { exact: true })).toHaveAttribute('type', 'password')

  await expect.poll(() => noteText(page)).toContain('"yellow"')
  const doc = JSON.parse(await noteText(page))
  expect(doc.app).toBe('keyfold')
  expect(doc.vault.entries[0].label).toBe('Cold storage')
  expect(doc.vault.entries[0].words.join(' ')).toBe(PHRASE)
  expect(await preview(page)).toBe('Keyfold: 1 seed phrase')
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
  const word1 = app.getByLabel('Word 1', { exact: true })
  await expect(word1).toHaveAttribute('type', 'text')

  await app.getByRole('button', { name: 'Copy phrase' }).click()
  await expect(app.getByText('Seed phrase copied. Clearing the clipboard in 30s.')).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(PHRASE)
  // Phones are told that their keyboard may keep its own clipboard history.
  const touch = test.info().project.name !== 'desktop'
  await expect(app.getByText("Your keyboard's clipboard history may keep its own copy.")).toHaveCount(touch ? 1 : 0)

  await app.getByRole('button', { name: 'Hide all' }).click()
  await expect(word1).toHaveAttribute('type', 'password')
})

test('detects private key formats', async ({ page }) => {
  const { app } = await open(page)
  await add(app, 'Wallet key')
  // The key stays hidden (not even in the page) until revealed; clicking it reveals and focuses it.
  await app.getByRole('button', { name: /Private key \(hidden\)/ }).click()
  await expect(app.getByLabel('Private key', { exact: true })).toBeFocused()
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
  expect(await preview(page)).toBe('Keyfold (password protected)')

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
  // Imported into a hidden field, since old note text may well be a seed phrase.
  await expect.poll(async () => (await noteJson(page))?.vault?.entries[0]?.customFields?.[0]).toMatchObject({
    value: 'my old note',
    hidden: true,
  })
})

const background = (app: App) => app.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor)

test('applies Standard Notes themes', async ({ page }) => {
  const { app, errors } = await open(page)
  await expect(app.getByText('No keys yet.')).toBeVisible()
  await expect(app.locator('html')).not.toHaveClass(/theme-pending/)
  await expect(app.locator('html')).toHaveCSS('color-scheme', 'light')
  await page.getByRole('button', { name: 'Toggle dark theme' }).click()
  await expect.poll(() => background(app)).toBe('rgb(21, 22, 26)')
  // Checkboxes, date pickers and scrollbars follow the theme too.
  await expect(app.locator('html')).toHaveCSS('color-scheme', 'dark')
  await page.getByRole('button', { name: 'Toggle dark theme' }).click()
  await expect.poll(() => background(app)).toBe('rgb(255, 255, 255)')
  await expect(app.locator('html')).toHaveCSS('color-scheme', 'light')
  expect(errors).toEqual([])
})

test('applies the built-in themes the mobile apps pass as file:// URLs', async ({ page }) => {
  // The mobile apps' theme files cannot load in a page served over HTTPS, so
  // Keyfold loads the copies Standard Notes serves for its web app.
  const requested: string[] = []
  await page.route('https://app.standardnotes.com/components/assets/**', (route) => {
    requested.push(route.request().url())
    return route.fulfill({ path: 'dev/dark-theme.css', contentType: 'text/css' })
  })
  const { app, errors } = await open(page, '', { mobile: '1', theme: 'dark' })
  await expect(app.getByText('No keys yet.')).toBeVisible()
  await expect.poll(() => background(app)).toBe('rgb(21, 22, 26)')
  await expect(app.locator('html')).toHaveCSS('color-scheme', 'dark')
  await expect(app.locator('html')).not.toHaveClass(/theme-pending/)
  expect(requested).toEqual(['https://app.standardnotes.com/components/assets/org.standardnotes.theme-focus/index.css'])
  expect(errors).toEqual([])
})

test('demo mode when opened directly', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText(/Demo mode/)).toBeVisible()
  await expect(page.getByText('Example: cold storage')).toBeVisible()
  await expect(page.getByText('Example: deploy key')).toBeVisible()
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
  expect(await preview(page)).toBe('Keyfold: 3 seed phrases')
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

test('fits eight-letter words in the narrowest word fields', async ({ page }) => {
  // Chrome on Android kept room for a wordlist arrow and cut off the last letter.
  const words = ['abstract', 'accident', 'abandon', 'zoo', 'abstract', 'accident', 'abandon', 'zoo', 'abstract', 'accident', 'abandon', 'about']
  const { app } = await open(page, vaultText([seed('a', 'Long words', 'Bitcoin', words.join(' '))]))
  await app.getByText('Long words').click()
  await app.getByRole('button', { name: 'Reveal words' }).click()
  await app.locator('.word-grid').evaluate((el: HTMLElement) => (el.style.gridTemplateColumns = 'repeat(3, 120px)'))
  const overflow = await app.locator('.word .input').evaluateAll((els) => els.map((el) => el.scrollWidth - el.clientWidth))
  expect(overflow).toEqual(words.map(() => 0))
})

test('clears the clipboard, with a button when the sandbox blocks doing it automatically', async ({ page }) => {
  const { app } = await open(page, vaultText([SEEDS[0]], { clipboardClearSeconds: 1 }))
  await app.getByRole('button', { name: /Cold storage/ }).click()
  await app.getByRole('button', { name: 'Copy phrase' }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(SEEDS[0].words.join(' '))

  const clearNow = app.getByRole('button', { name: 'Clear now' })
  await expect(app.getByText('Clipboard cleared.').or(clearNow)).toBeVisible({ timeout: 5000 })
  if (await clearNow.isVisible()) await clearNow.click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).not.toBe(SEEDS[0].words.join(' '))
})

test('typing in an older entry keeps focus and every keystroke', async ({ page }) => {
  const entries = SEEDS.map((e, i) => ({ ...e, updatedAt: `2026-0${i + 1}-01T00:00:00.000Z` }))
  const { app } = await open(page, vaultText(entries))
  // Sorted by last update, the oldest entry ("Cold storage") is at the bottom.
  await app.getByRole('button', { name: /Cold storage/ }).click()
  await app.getByRole('button', { name: /^Details/ }).click()
  const description = app.getByRole('textbox', { name: 'Description' })
  await description.click()
  await description.pressSequentially('hello world')
  await expect(description).toBeFocused()
  await expect.poll(async () => (await noteJson(page))?.vault?.entries?.find((e: any) => e.id === 'a')?.description).toBe('hello world')
})

test('a revision restored from note history replaces the current content', async ({ page }) => {
  const { app } = await open(page)
  await add(app, 'Other secret')
  await app.getByLabel('Label').fill('first version')
  await expect.poll(() => noteText(page)).toContain('first version')
  const first = await noteText(page)
  await app.getByLabel('Label').fill('second version')
  await expect.poll(() => noteText(page)).toContain('second version')

  // History restores happen well after the save they bring back.
  await page.waitForTimeout(5500)
  await page.evaluate((text) => (window as any).mockHost.restore(text), first)
  await expect(app.getByLabel('Label')).toHaveValue('first version')
  // And a later edit builds on the restored version.
  await app.getByLabel('Label').fill('first version, edited')
  await expect.poll(() => noteText(page)).toContain('first version, edited')
})

test('typing a space moves to the next word, as Android keyboards need', async ({ page }) => {
  const { app } = await open(page)
  await add(app, 'Seed phrase')
  const word1 = app.getByLabel('Word 1', { exact: true })
  // Android reports the space key as "Unidentified"; simulate the input event only.
  await word1.focus()
  await word1.evaluate((el: HTMLInputElement) => {
    el.value = 'abandon '
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await expect(app.getByLabel('Word 2', { exact: true })).toBeFocused()
  await expect.poll(async () => (await noteJson(page))?.vault?.entries?.[0]?.words?.[0]).toBe('abandon')
})

test('stores an SSH key and an expiring API token alongside crypto entries', async ({ page }) => {
  const { app, errors } = await open(page)
  // An openssh-key-v1 file built from random bytes: right shape, not a usable key.
  const u32 = (n: number) => { const x = Buffer.alloc(4); x.writeUInt32BE(n); return x }
  const s = (b: Buffer) => Buffer.concat([u32(b.length), b])
  const blob = Buffer.concat([
    Buffer.from('openssh-key-v1\0'),
    s(Buffer.from('none')),
    s(Buffer.from('none')),
    s(Buffer.alloc(0)),
    u32(1),
    s(Buffer.concat([s(Buffer.from('ssh-ed25519')), s(Buffer.from(Array.from({ length: 32 }, (_, i) => i)))])),
    s(Buffer.alloc(64, 7)),
  ])
  const key = `-----BEGIN OPENSSH PRIVATE KEY-----\n${blob.toString('base64').match(/.{1,70}/g)!.join('\n')}\n-----END OPENSSH PRIVATE KEY-----`

  // The Add menu lists crypto first.
  await app.getByRole('button', { name: 'Add' }).click()
  const groups = await app.getByRole('group').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))
  expect(groups).toEqual(['Crypto', 'Keys', 'Secrets'])
  await app.getByRole('menuitem', { name: 'SSH key' }).click()
  await app.getByLabel('Label').fill('Deploy key')
  await app.getByLabel('Hosts / service').fill('github.com')
  await app.getByRole('button', { name: /Private key \(hidden\)/ }).click()
  await app.getByLabel('Private key', { exact: true }).fill(key)
  await expect(app.getByText('OpenSSH private key (Ed25519)')).toBeVisible()
  await expect(app.getByText('Not passphrase-protected.', { exact: false })).toBeVisible()

  await app.getByRole('button', { name: 'Collapse all' }).click()
  await add(app, 'API key or token')
  await app.getByLabel('Label').fill('CI token')
  const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10)
  await app.getByLabel('Expires on').fill(soon)
  await app.getByRole('button', { name: 'Collapse all' }).click()
  await expect(app.getByText(/expires in [45] days/)).toBeVisible()

  await expect.poll(async () => (await noteJson(page))?.vault?.entries?.map((e: any) => e.kind)).toEqual(['apiKey', 'sshKey'])
  expect(await preview(page)).toBe('Keyfold: 1 SSH key, 1 API key')
  expect(errors).toEqual([])
})

test('works when the Standard Notes app has a "null" origin, as in the mobile apps', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  await page.goto('/dev/null-origin.html')
  const app = page.frameLocator('#host').frameLocator('#editor')
  await expect(app.getByText('No keys yet.')).toBeVisible()
  await add(app, 'Seed phrase')
  await app.getByLabel('Label').fill('From a phone')
  const host = page.frames().find((f) => f.url().includes('/dev/host.html'))!
  await expect
    .poll(() => host.evaluate(() => (window as any).mockHost.note.content.text as string))
    .toContain('From a phone')
  expect(errors).toEqual([])
})
