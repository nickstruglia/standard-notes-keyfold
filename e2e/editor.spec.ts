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

  await app.getByRole('button', { name: 'Seed phrase' }).click()
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
  await app.getByRole('button', { name: 'Seed phrase' }).click()
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
  await app.getByRole('button', { name: 'Private key' }).click()
  await app.getByLabel('Private key', { exact: true }).fill('KwdMAjGmerYanjeui5SHS7JkmpZvVipYvB2LJGU1ZxJwYvP98617')
  await expect(app.getByText('WIF private key (Bitcoin mainnet, compressed)')).toBeVisible()
  await app.getByLabel('Private key', { exact: true }).fill('KwdMAjGmerYanjeui5SHS7JkmpZvVipYvB2LJGU1ZxJwYvP98618')
  await expect(app.getByText('Looks like WIF, but the checksum fails')).toBeVisible()
})

test('vault password encrypts the note, locks and unlocks', async ({ page }) => {
  const { app, errors } = await open(page)
  await app.getByRole('button', { name: 'Seed phrase' }).click()
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

  await app.getByRole('button', { name: 'Lock' }).click()
  await expect(app.getByText('Vault locked')).toBeVisible()
  await app.getByLabel('Vault password').fill('wrong password')
  await app.getByRole('button', { name: 'Unlock' }).click()
  await expect(app.getByText('Wrong password, or the vault data is damaged.')).toBeVisible()
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
  await app.getByRole('button', { name: 'Other' }).click()
  await app.getByLabel('Label').fill('Exchange')
  await expect.poll(() => noteText(page)).toContain('Exchange')

  await page.getByRole('button', { name: 'Toggle "Prevent editing"' }).click()
  await expect(app.getByText('"Prevent editing" is on for this note.')).toBeVisible()
  await expect(app.getByRole('button', { name: 'Seed phrase' })).toHaveCount(0)
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
  await expect(page.getByText('Example: hardware wallet')).toBeVisible()
  await expect(page.getByText('http://127.0.0.1:4173/ext.json')).toBeVisible()
})
