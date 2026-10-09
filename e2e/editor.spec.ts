import { readFileSync } from 'node:fs'
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
  await app.locator('.popover').getByRole('button', { name: kind, exact: true }).click()
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
  await expect(app.getByText(/Not in the English BIP39 wordlist: #3\./)).toBeVisible()

  expect(errors).toEqual([])
})

test('never rewrites a word on its own, and expands abbreviations only on request', async ({ page }) => {
  const { app } = await open(page)
  await add(app, 'Seed phrase')
  // "acto" is a Spanish BIP39 word that happens to start the English "actor".
  const word1 = app.getByLabel('Word 1', { exact: true })
  await word1.fill('acto')
  await app.getByLabel('Word 2', { exact: true }).focus()
  await expect(word1).toHaveValue('acto')
  await expect.poll(async () => (await noteJson(page))?.vault?.entries[0]?.words[0]).toBe('acto')
  // English shorthand can be expanded with a button.
  await app.getByRole('button', { name: 'Expand abbreviated words' }).click()
  await expect(word1).toHaveValue('actor')
})

test('places numbered words by number when pasted from a sheet with columns', async ({ page }) => {
  const { app } = await open(page)
  await add(app, 'Seed phrase')
  const words = PHRASE.split(' ')
  const rows = words.slice(0, 6).map((w, i) => `${i + 1}. ${w}   ${i + 7}. ${words[i + 6]}`).join('\n')
  await pastePhrase(page, rows)
  await expect(app.getByText('Valid BIP39 checksum (12 words).')).toBeVisible()
  await expect(app.getByText(/Placed the pasted words by their numbers/)).toBeVisible()
  await expect.poll(async () => (await noteJson(page))?.vault?.entries[0]?.words.join(' ')).toBe(PHRASE)
})

test('focus alone never shows a seed word in clear', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'touch screens never reveal the typed word')
  const { app } = await open(page, vaultText([SEEDS[0]]))
  await app.getByText('Cold storage').click()
  const word1 = app.getByLabel('Word 1', { exact: true })
  await word1.focus()
  await page.keyboard.press('Tab')
  await expect(app.getByLabel('Word 2', { exact: true })).toHaveAttribute('type', 'password')
  // Typing shows the word being typed.
  await page.keyboard.press('End')
  await page.keyboard.type('x')
  await expect(app.getByLabel('Word 2', { exact: true })).toHaveAttribute('type', 'text')
  await page.keyboard.press('Tab')
  await expect(app.getByLabel('Word 2', { exact: true })).toHaveAttribute('type', 'password')
})

test('input-method keys do not move between words', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'one engine check is enough')
  const { app } = await open(page)
  await add(app, 'Seed phrase')
  const word1 = app.getByLabel('Word 1', { exact: true })
  await word1.focus()
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.imeSetComposition', { text: 'あい', selectionStart: 2, selectionEnd: 2 })
  // An input method's Enter arrives as keyCode 229 while composing.
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 229 })
  await cdp.send('Input.insertText', { text: 'あい' })
  await expect(word1).toBeFocused()
  await expect(word1).toHaveValue('あい')
  await expect(app.getByLabel('Word 2', { exact: true })).toHaveValue('')
})

test('reveals, copies with a toast, and hides all', async ({ page }) => {
  const { app } = await open(page)
  await add(app, 'Seed phrase')
  await pastePhrase(page, PHRASE)
  await app.getByRole('button', { name: 'Reveal words' }).click()
  const word1 = app.getByLabel('Word 1', { exact: true })
  await expect(word1).toHaveAttribute('type', 'text')

  await app.getByRole('button', { name: 'Copy phrase' }).click()
  await expect(app.getByText(/Seed phrase copied\. The clipboard is cleared after 30s/)).toBeVisible()
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
  // A one-line wallet key is typed into a masked password field.
  await expect(app.getByLabel('Private key', { exact: true })).toHaveAttribute('type', 'password')
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
  // Keyfold never tried to save while editing was prevented.
  expect(await page.evaluate(() => (window as any).mockHost.rejectedSaves ?? 0)).toBe(0)
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

test('applies the built-in themes the mobile apps send as data: URLs', async ({ page }) => {
  const { app, errors } = await open(page, '', { mobile: '1', theme: 'dark' })
  await expect(app.getByText('No keys yet.')).toBeVisible()
  await expect.poll(() => background(app)).toBe('rgb(21, 22, 26)')
  await expect(app.locator('html')).toHaveCSS('color-scheme', 'dark')
  await expect(app.locator('html')).not.toHaveClass(/theme-pending/)
  // Switching themes off and on again works too.
  await page.getByRole('button', { name: 'Toggle dark theme' }).click()
  await expect.poll(() => background(app)).toBe('rgb(255, 255, 255)')
  await page.getByRole('button', { name: 'Toggle dark theme' }).click()
  await expect.poll(() => background(app)).toBe('rgb(21, 22, 26)')
  expect(errors).toEqual([])
})

test('applies built-in themes the mobile apps send as file:// URLs', async ({ page }) => {
  // The mobile apps fall back to file:// URLs before their data: copies are
  // ready. A page served over HTTPS cannot load those, so Keyfold loads the
  // copies Standard Notes serves for its web app.
  const requested: string[] = []
  await page.route('https://app.standardnotes.com/components/assets/**', (route) => {
    requested.push(route.request().url())
    return route.fulfill({ path: 'dev/dark-theme.css', contentType: 'text/css' })
  })
  const { app, errors } = await open(page, '', { mobile: 'file', theme: 'dark' })
  await expect(app.getByText('No keys yet.')).toBeVisible()
  await expect.poll(() => background(app)).toBe('rgb(21, 22, 26)')
  await expect(app.locator('html')).toHaveCSS('color-scheme', 'dark')
  expect(requested).toEqual(['https://app.standardnotes.com/components/assets/org.standardnotes.theme-focus/index.css'])
  expect(errors).toEqual([])
})

const ENCRYPTED_NOTE = JSON.stringify({
  app: 'keyfold',
  version: 1,
  encryption: JSON.parse(readFileSync(new URL('../tests/fixtures/known-answer-v1.json', import.meta.url), 'utf8')),
})
const KAT_PASSWORD = 'correct horse battery staple'

test('a restored non-vault revision clears the password state before converting', async ({ page }) => {
  const { app, errors } = await open(page, ENCRYPTED_NOTE)
  await expect(app.getByRole('heading', { name: 'Vault locked' })).toBeVisible()
  // A revision from before Keyfold is restored from note history.
  await page.evaluate(() => (window as any).mockHost.restore('my old notes\nline two'))
  await app.getByRole('button', { name: 'Convert to a vault' }).click()
  await app.getByRole('button', { name: 'Convert', exact: true }).click()
  await expect(app.getByText('Imported note')).toBeVisible()
  // The converted vault is plain, and the UI must say so.
  await expect(app.getByRole('button', { name: 'Lock', exact: true })).toHaveCount(0)
  await app.getByRole('button', { name: 'Settings' }).click()
  await expect(app.getByRole('button', { name: 'Set a vault password' })).toBeVisible()
  // The imported text keeps its line break.
  await expect.poll(async () => (await noteJson(page))?.vault?.entries[0]?.customFields?.[0]?.value).toBe('my old notes\nline two')
  expect(errors).toEqual([])
})

test('an unlocked vault is wiped when a non-vault revision arrives', async ({ page }) => {
  const { app } = await open(page, ENCRYPTED_NOTE)
  await app.getByLabel('Vault password').fill(KAT_PASSWORD)
  await app.getByRole('button', { name: 'Unlock' }).click()
  await expect(app.getByText('Known answer')).toBeVisible()
  await page.evaluate(() => (window as any).mockHost.restore('plain old text'))
  await expect(app.getByText('This note already has other content')).toBeVisible()
  // The encrypted version comes back: it must ask for the password again.
  await page.evaluate((text) => (window as any).mockHost.restore(text), ENCRYPTED_NOTE)
  await expect(app.getByRole('heading', { name: 'Vault locked' })).toBeVisible()
  await expect(app.getByText('Known answer')).toHaveCount(0)
})

test('editing an imported multi-line field keeps its line breaks', async ({ page }) => {
  const { app } = await open(page, 'backup\nabandon\nthird line')
  await app.getByRole('button', { name: 'Convert to a vault' }).click()
  await app.getByRole('button', { name: 'Convert', exact: true }).click()
  await app.getByText('Imported note').click()
  await app.getByRole('button', { name: /Imported text \(hidden\)/ }).click()
  const area = app.getByRole('textbox', { name: 'Imported text' })
  await area.press('End')
  await area.type('!')
  await expect.poll(async () => (await noteJson(page))?.vault?.entries[0]?.customFields?.[0]?.value).toBe('backup\nabandon\nthird line!')
})

test('a theme stylesheet cannot load images or fonts from other sites', async ({ page }) => {
  const requested: string[] = []
  await page.route('https://evil.test/**', (route) => {
    requested.push(route.request().url())
    const css = `body { background-image: url(https://evil.test/beacon.png) }
      @font-face { font-family: x; src: url(https://evil.test/font.woff) } body { font-family: x }`
    return route.fulfill({ body: css, contentType: 'text/css' })
  })
  const { app } = await open(page)
  await expect(app.getByText('No keys yet.')).toBeVisible()
  await page.evaluate(() =>
    (document.getElementById('editor') as HTMLIFrameElement).contentWindow!.postMessage(
      { action: 'themes', data: { themes: ['https://evil.test/theme.css'] } },
      '*',
    ),
  )
  await expect.poll(() => requested.length).toBeGreaterThan(0)
  await page.waitForTimeout(500)
  expect(requested).toEqual(['https://evil.test/theme.css'])
})

test('warns about a private key in public info and tidies pasted fingerprints and paths', async ({ page }) => {
  const { app } = await open(page, vaultText([SEEDS[0]]))
  await app.getByRole('button', { name: /Cold storage/ }).click()
  await app.getByRole('button', { name: /Public info/ }).click()
  const xprv = 'xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi'
  await app.getByLabel('Addresses / xpub').fill(xprv)
  await expect(app.getByText(/This looks like private key material \(Extended private key/)).toBeVisible()
  const fingerprint = app.getByLabel('Master fingerprint')
  await fingerprint.fill("[73c5da0a/84h/0h/0h]")
  await app.getByLabel('Derivation path').fill('M/84’/0’/0’')
  await expect(fingerprint).toHaveValue('73c5da0a')
  await app.getByLabel('Addresses / xpub').focus()
  await expect(app.getByLabel('Derivation path')).toHaveValue("m/84'/0'/0'")
})

test('undo never duplicates an entry, and the toast names it', async ({ page }) => {
  const { app } = await open(page, vaultText([SEEDS[0], SEEDS[1]]))
  await app.getByRole('button', { name: /Cold storage/ }).click()
  await app.getByRole('button', { name: 'Delete', exact: true }).first().click()
  await app.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await expect(app.getByText('Deleted "Cold storage".')).toBeVisible()
  // The entry comes back from elsewhere (e.g. history restore) before Undo.
  await page.evaluate((text) => (window as any).mockHost.restore(text), vaultText([SEEDS[0], SEEDS[1]]))
  await app.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => (await noteJson(page))?.vault?.entries.filter((e: any) => e.id === 'a').length ?? 1).toBe(1)
})

test('Escape closes the Add panel and returns focus to its button', async ({ page }) => {
  const { app } = await open(page)
  const addButton = app.getByRole('button', { name: 'Add', exact: true })
  await addButton.click()
  await app.locator('.popover').getByRole('button', { name: 'SSH key', exact: true }).focus()
  await page.keyboard.press('Escape')
  await expect(app.locator('.popover')).toHaveCount(0)
  await expect(addButton).toBeFocused()
})

test('a cancelled dialog returns focus to the button that opened it', async ({ page }) => {
  const { app } = await open(page, vaultText([SEEDS[0]]))
  await app.getByRole('button', { name: /Cold storage/ }).click()
  const del = app.getByRole('button', { name: 'Delete', exact: true }).first()
  await del.click()
  await app.getByRole('alertdialog').getByText(/will be removed/).click()
  await page.keyboard.press('Escape')
  await expect(app.getByRole('alertdialog')).toHaveCount(0)
  await expect(del).toBeFocused()
})

test('on a 320 px phone the Add menu stays on screen', async ({ page }) => {
  test.skip(test.info().project.name === 'desktop', 'phone layout')
  await page.setViewportSize({ width: 320, height: 640 })
  const { app } = await open(page)
  await app.getByRole('button', { name: 'Add', exact: true }).click()
  const box = (await app.locator('.popover').boundingBox())!
  const frame = (await page.locator('#editor').boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(frame.x)
  expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width)
  expect(box.y + box.height).toBeLessThanOrEqual(frame.y + frame.height)
})

test('warns when visible text gives a secret away', async ({ page }) => {
  const { app } = await open(page, vaultText([{ ...SEEDS[0], passphrase: 'tangerine' }]))
  await app.getByRole('button', { name: /Cold storage/ }).click()
  await app.getByLabel('Passphrase hint').fill('my Tangerine')
  await expect(app.getByText('The hint contains the passphrase.', { exact: false })).toBeVisible()
  await app.getByRole('button', { name: /Notes/ }).click()
  await app.getByLabel('Notes').fill('backup: abandon abandon abandon abandon')
  await expect(app.getByText(/This text repeats the entry's secret/)).toBeVisible()
})

test('a one-line wallet key stays in a masked field', async ({ page }) => {
  const { app } = await open(page)
  await add(app, 'Wallet key')
  await expect(app.getByLabel('Private key', { exact: true })).toHaveAttribute('type', 'password')
})

test('the privacy screen is a button that brings the vault back', async ({ page }) => {
  const { app } = await open(page, vaultText([SEEDS[0]], { privacyScreen: true }))
  await expect(app.getByText('Cold storage')).toBeVisible()
  // Focus leaves the editor (the host page takes it).
  await page.locator('#reset').focus()
  const cover = app.getByRole('button', { name: /to show the vault/ })
  await expect(cover).toBeVisible()
  await cover.click()
  await expect(cover).toHaveCount(0)
})

test('archiving says where the entry went, and an all-archived list offers the filter', async ({ page }) => {
  const { app } = await open(page, vaultText([SEEDS[0]]))
  await app.getByRole('button', { name: /Cold storage/ }).click()
  await app.getByRole('button', { name: 'Archive', exact: true }).click()
  await expect(app.getByText(/Archived\. It is under the "Archived" filter/)).toBeVisible()
  await app.getByRole('button', { name: 'Collapse all' }).click()
  await app.getByRole('button', { name: 'Show archived entries' }).click()
  await expect(app.getByRole('button', { name: /Cold storage/ })).toBeVisible()
})

test('the recovery viewer opens an encrypted note read-only, also from the unzipped files', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'one engine check is enough')
  for (const url of ['/#open', `file://${process.cwd()}/dist/index.html#open`]) {
    await page.goto(url)
    await page.getByText("Paste a note's text instead").click()
    await page.getByLabel('Note text').fill(ENCRYPTED_NOTE)
    await page.getByRole('button', { name: 'Open read-only' }).click()
    await page.getByLabel('Vault password').fill(KAT_PASSWORD)
    await page.getByRole('button', { name: 'Unlock' }).click()
    await expect(page.getByText('Known answer')).toBeVisible()
    await expect(page.getByText(/Read-only viewer/)).toBeVisible()
    await page.getByRole('button', { name: /Known answer/ }).click()
    await expect(page.getByLabel('Word 1', { exact: true })).toHaveAttribute('readonly', '')
  }
})

const BACKUP_PASSWORD = 'river candle orbit plain seven'
/** The known-answer vault as a backup file (the format adds exportedAt). */
const KAT_BACKUP = JSON.stringify({ ...JSON.parse(ENCRYPTED_NOTE), exportedAt: '2026-01-02T03:04:05.000Z' })

/** Makes a backup file in Settings, saves it, and returns its name, path and text. */
const exportBackup = async (page: Page, app: App, password = BACKUP_PASSWORD) => {
  await app.getByRole('button', { name: 'Settings' }).click()
  await app.getByRole('button', { name: 'Make a backup file' }).click()
  await app.getByLabel('Backup password', { exact: true }).fill(password)
  await app.getByLabel('Repeat backup password').fill(password)
  await app.getByRole('checkbox', { name: /I understand/ }).check()
  await app.getByRole('button', { name: 'Encrypt backup' }).click()
  const save = app.getByRole('link', { name: 'Save file' })
  // Focused, so a phone scrolls it into view.
  await expect(save).toBeFocused()
  const [download] = await Promise.all([page.waitForEvent('download'), save.click()])
  const path = test.info().outputPath(download.suggestedFilename())
  await download.saveAs(path)
  return { name: download.suggestedFilename(), path, text: readFileSync(path, 'utf8') }
}

test('saves an encrypted backup file that the offline viewer opens from disk', async ({ page }) => {
  const { app, errors } = await open(page, vaultText(SEEDS))
  await app.getByRole('button', { name: 'Settings' }).click()
  await expect(app.getByText('No backup file made yet.')).toBeVisible()
  const viewerLink = app.getByRole('link', { name: 'Get the offline viewer' })
  await expect(viewerLink).toHaveAttribute('href', /\/keyfold-viewer\.html$/)
  await expect(viewerLink).toHaveAttribute('target', '_blank')
  await app.getByRole('button', { name: 'Close settings' }).click()

  const backup = await exportBackup(page, app)
  expect(backup.name).toMatch(/^keyfold-backup-\d{4}-\d{2}-\d{2}\.json$/)
  await expect(app.getByText(/Encrypted 3 entries into keyfold-backup-/)).toBeVisible()
  // Nothing in the file is readable without its password.
  for (const s of SEEDS) {
    expect(backup.text).not.toContain(s.label)
    expect(backup.text).not.toContain(s.words.slice(0, 3).join('", "'))
  }
  expect(JSON.parse(backup.text).encryption.cipher).toBe('AES-256-GCM')
  // Saving it is recorded in the vault.
  await expect(app.getByText(/^Last backup file: /)).toBeVisible()
  await expect.poll(async () => (await noteJson(page))?.vault?.settings?.lastExportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  await app.getByRole('button', { name: 'Done' }).click()
  await expect(app.getByRole('link', { name: 'Save file' })).toHaveCount(0)

  // The single-file viewer, as kept on a flash drive.
  await page.goto(`file://${process.cwd()}/dist/keyfold-viewer.html`)
  await expect(page.getByRole('heading', { name: 'Keyfold offline viewer' })).toBeVisible()
  await page.getByLabel('Backup file').setInputFiles(backup.path)
  await expect(page.getByRole('heading', { name: 'Encrypted backup' })).toBeVisible()
  await page.getByLabel('Backup password').fill('not the password')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByText('Wrong password, or the vault data is damaged.')).toBeVisible()
  await page.getByLabel('Backup password').fill(BACKUP_PASSWORD)
  await page.getByRole('button', { name: 'Unlock' }).click()
  for (const s of SEEDS) await expect(page.getByText(s.label, { exact: true })).toBeVisible()
  await expect(page.getByText(/Read-only viewer/)).toBeVisible()
  await page.getByRole('button', { name: /Cold storage/ }).click()
  await expect(page.getByLabel('Word 1', { exact: true })).toHaveAttribute('readonly', '')

  // Close forgets the vault and asks for a file again.
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Choose backup file' })).toBeVisible()
  await expect(page.getByText(SEEDS[0].label)).toHaveCount(0)
  // No policy violations, from the editor or from the viewer.
  expect(errors).toEqual([])
})

test('the hosted viewer offers itself as one file, opens dropped backups and refuses other files', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'one engine check is enough')
  const errors: string[] = []
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()))
  page.on('pageerror', (err) => errors.push(err.message))
  await page.goto('/keyfold-viewer.html')

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: /Save this viewer/ }).click()])
  expect(download.suggestedFilename()).toBe('keyfold-viewer.html')
  const saved = test.info().outputPath('saved-viewer.html')
  await download.saveAs(saved)
  expect(readFileSync(saved, 'utf8')).toBe(readFileSync('dist/keyfold-viewer.html', 'utf8'))

  await page.getByLabel('Backup file').setInputFiles({ name: 'other.json', mimeType: 'application/json', buffer: Buffer.from('{"not":"keyfold"}') })
  await expect(page.getByText('This file is not a Keyfold backup or note.')).toBeVisible()
  await page.getByLabel('Backup file').setInputFiles({ name: 'empty.txt', mimeType: 'text/plain', buffer: Buffer.from('') })
  await expect(page.getByText('This file is empty.')).toBeVisible()

  await page.locator('.screen').evaluate((screen, text) => {
    const data = new DataTransfer()
    data.items.add(new File([text], 'keyfold-backup.json', { type: 'application/json' }))
    screen.dispatchEvent(new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true }))
    screen.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }))
  }, KAT_BACKUP)
  await expect(page.getByRole('heading', { name: 'Encrypted backup' })).toBeVisible()
  await expect(page.getByText(/^Made January 2, 2026\./)).toBeVisible()
  await page.getByLabel('Backup password').fill(KAT_PASSWORD)
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByText('Known answer')).toBeVisible()
  expect(errors).toEqual([])
})

test('a backup pasted into a note opens with its password and is saved as an ordinary vault', async ({ page }) => {
  const { app, errors } = await open(page, KAT_BACKUP)
  await expect(app.getByRole('heading', { name: 'Encrypted backup' })).toBeVisible()
  await app.getByLabel('Backup password').fill(KAT_PASSWORD)
  await app.getByRole('button', { name: 'Unlock' }).click()
  await expect(app.getByText('Known answer')).toBeVisible()
  // The fixture's low iteration count makes Keyfold re-encrypt and save it right away.
  await expect.poll(async () => (await noteJson(page))?.encryption?.iterations).toBe(600_000)
  expect((await noteJson(page)).exportedAt).toBeUndefined()
  await page.getByRole('button', { name: 'Reload editor' }).click()
  await expect(app.getByRole('heading', { name: 'Vault locked' })).toBeVisible()
  await app.getByLabel('Vault password').fill(KAT_PASSWORD)
  await app.getByRole('button', { name: 'Unlock' }).click()
  await expect(app.getByText('Known answer')).toBeVisible()
  expect(errors).toEqual([])
})

test('a backup password must match, and a weak one must be confirmed', async ({ page }) => {
  const { app } = await open(page, vaultText([SEEDS[0]]))
  await app.getByRole('button', { name: 'Settings' }).click()
  await app.getByRole('button', { name: 'Make a backup file' }).click()
  // A backup has its own password: there is no current one to enter.
  await expect(app.getByLabel('Current vault password')).toHaveCount(0)
  const encrypt = app.getByRole('button', { name: 'Encrypt backup' })
  await app.getByLabel('Backup password', { exact: true }).fill('1234567890')
  await app.getByLabel('Repeat backup password').fill('1234567899')
  await app.getByRole('checkbox', { name: /can open this backup/ }).check()
  await expect(app.getByText('Passwords do not match.')).toBeVisible()
  await expect(encrypt).toBeDisabled()
  await app.getByLabel('Repeat backup password').fill('1234567890')
  await expect(encrypt).toBeDisabled()
  await app.getByRole('checkbox', { name: /Anyone who finds the backup file could guess it/ }).check()
  await expect(encrypt).toBeEnabled()
  await app.getByRole('button', { name: 'Cancel' }).click()
  await expect(app.getByRole('button', { name: 'Make a backup file' })).toBeVisible()
})

test('copying a backup as text keeps it on the clipboard, past an earlier timed clear', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'waits for a timer; one profile is enough')
  const { app } = await open(page, vaultText([SEEDS[0]], { clipboardClearSeconds: 5 }))
  await app.getByRole('button', { name: /Cold storage/ }).click()
  await app.getByRole('button', { name: 'Copy phrase' }).click()
  const copiedAt = Date.now()
  await app.getByRole('button', { name: 'Settings' }).click()
  await app.getByRole('button', { name: 'Make a backup file' }).click()
  await app.getByLabel('Backup password', { exact: true }).fill(BACKUP_PASSWORD)
  await app.getByLabel('Repeat backup password').fill(BACKUP_PASSWORD)
  await app.getByRole('checkbox', { name: /I understand/ }).check()
  await app.getByRole('button', { name: 'Encrypt backup' }).click()
  await app.getByRole('button', { name: 'Copy as text' }).click()
  await expect(app.getByText(/Backup copied/)).toBeVisible()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(JSON.parse(copied).encryption.cipher).toBe('AES-256-GCM')
  // Past the phrase's clear time, and a click (when a blocked clear would run).
  await page.waitForTimeout(Math.max(0, copiedAt + 6000 - Date.now()))
  await app.getByRole('heading', { name: 'Vault settings' }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(copied)
  // Copying counts as making the backup.
  await expect.poll(async () => (await noteJson(page))?.vault?.settings?.lastExportedAt).toMatch(/^\d{4}-/)
})

test('in the phone apps, copying the backup comes first', async ({ page }) => {
  const { app } = await open(page, vaultText([SEEDS[0]]), { mobile: '1' })
  await app.getByRole('button', { name: 'Settings' }).click()
  await app.getByRole('button', { name: 'Make a backup file' }).click()
  await app.getByLabel('Backup password', { exact: true }).fill(BACKUP_PASSWORD)
  await app.getByLabel('Repeat backup password').fill(BACKUP_PASSWORD)
  await app.getByRole('checkbox', { name: /I understand/ }).check()
  await app.getByRole('button', { name: 'Encrypt backup' }).click()
  const copy = app.getByRole('button', { name: 'Copy as text' })
  await expect(copy).toBeFocused()
  await expect(copy).toHaveClass(/primary/)
  await expect(app.getByText(/The Standard Notes phone app may not save files from plugins/)).toBeVisible()
  // Saving is still offered, for the apps that do handle it.
  await expect(app.getByRole('link', { name: 'Save file' })).toBeVisible()
})

test('a read-only note can still be backed up, without recording it', async ({ page }) => {
  const { app } = await open(page, vaultText([SEEDS[0]]))
  await page.getByRole('button', { name: 'Toggle "Prevent editing"' }).click()
  await expect(app.getByText('"Prevent editing" is on for this note.')).toBeVisible()
  const backup = await exportBackup(page, app)
  expect(JSON.parse(backup.text).encryption.cipher).toBe('AES-256-GCM')
  await expect(app.getByText('No backup file made yet.')).toBeVisible()
  expect(await page.evaluate(() => (window as any).mockHost.rejectedSaves ?? 0)).toBe(0)
})

test('no backup of an empty vault, or of one saved by a newer Keyfold', async ({ page }) => {
  const { app } = await open(page, vaultText([]))
  await app.getByRole('button', { name: 'Settings' }).click()
  await expect(app.getByText('There is nothing to back up yet.')).toBeVisible()
  await expect(app.getByRole('button', { name: 'Make a backup file' })).toBeDisabled()

  await page.evaluate((text) => (window as any).mockHost.restore(text), vaultText([SEEDS[0]], { layout: 'carousel' }))
  await expect(app.getByText(/saved by a newer version of Keyfold\. Update Keyfold first/)).toBeVisible()
  await expect(app.getByRole('button', { name: 'Make a backup file' })).toBeDisabled()
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
  await expect(seedSection).toContainText('BIP39 (English) · 12 words')
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
  // Once cleared, the "waiting for a click" message goes away.
  await expect(clearNow).toHaveCount(0)
})

test('copying a revealed secret with Ctrl+C also starts the timed clear', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'keyboard copy')
  const { app } = await open(page, vaultText([SEEDS[0]], { clipboardClearSeconds: 10 }))
  await app.getByRole('button', { name: /Cold storage/ }).click()
  await app.getByRole('button', { name: 'Reveal words' }).click()
  const word1 = app.getByLabel('Word 1', { exact: true })
  await word1.selectText()
  await page.keyboard.press('ControlOrMeta+c')
  await expect(app.getByText(/Selection copied\. The clipboard is cleared after 10s/)).toBeVisible()
})

test('locking by hand clears a copied secret right away', async ({ page }) => {
  const { app } = await open(page, ENCRYPTED_NOTE)
  await app.getByLabel('Vault password').fill(KAT_PASSWORD)
  await app.getByRole('button', { name: 'Unlock' }).click()
  await app.getByRole('button', { name: /Known answer/ }).click()
  await app.getByRole('button', { name: 'Copy phrase' }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('legal winner')
  await app.getByRole('button', { name: 'Lock', exact: true }).click()
  await expect(app.getByRole('heading', { name: 'Vault locked' })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).not.toContain('legal winner')
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
  await page.waitForTimeout(2500)
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
  const groups = await app.locator('.popover').getByRole('group').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))
  expect(groups).toEqual(['Crypto', 'Keys', 'Secrets'])
  await app.locator('.popover').getByRole('button', { name: 'SSH key', exact: true }).click()
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

test('clears the note type early versions set, once, without changing the text', async ({ page }) => {
  const text = vaultText([SEEDS[0]])
  const { app, errors } = await open(page, text, { noteType: 'authentication' })
  await expect(app.getByText('Cold storage')).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as any).mockHost.note.content.noteType)).toBe('unknown')
  expect(await noteText(page)).toBe(text)
  expect(await page.evaluate(() => (window as any).mockHost.saves.length)).toBe(1)
  expect(errors).toEqual([])
})

test('leaves the note type alone on a locked note and on current notes', async ({ page }) => {
  const text = vaultText([SEEDS[0]])
  const { app } = await open(page, text, { noteType: 'authentication', locked: '1' })
  await expect(app.getByText('"Prevent editing" is on for this note.')).toBeVisible()
  await page.waitForTimeout(500)
  expect(await page.evaluate(() => (window as any).mockHost.note.content.noteType)).toBe('authentication')
  expect(await page.evaluate(() => (window as any).mockHost.rejectedSaves ?? 0)).toBe(0)

  const current = await open(page, text)
  await expect(current.app.getByText('Cold storage')).toBeVisible()
  await page.waitForTimeout(500)
  expect(await page.evaluate(() => (window as any).mockHost.saves.length)).toBe(0)
  expect(await page.evaluate(() => (window as any).mockHost.note.content.noteType)).toBeUndefined()
})

test('restores a backup file into an empty note, keeping its password', async ({ page }) => {
  const source = await open(page, vaultText(SEEDS))
  const backup = await exportBackup(page, source.app)

  const { app, errors } = await open(page)
  await app.getByRole('button', { name: 'Restore a backup file' }).click()
  await app.getByLabel('Backup file').setInputFiles(backup.path)
  await expect(app.getByRole('heading', { name: 'Encrypted backup' })).toBeVisible()
  await app.getByLabel('Backup password').fill('not the password')
  await app.getByRole('button', { name: 'Restore', exact: true }).click()
  await expect(app.getByText('Wrong password, or the vault data is damaged.')).toBeVisible()
  expect(await page.evaluate(() => (window as any).mockHost.saves.length)).toBe(0)

  await app.getByLabel('Backup password').fill(BACKUP_PASSWORD)
  await app.getByRole('button', { name: 'Restore', exact: true }).click()
  for (const s of SEEDS) await expect(app.getByText(s.label, { exact: true }).first()).toBeVisible()
  await expect(app.getByText(/Restored 3 entries\. The vault keeps the password you entered/)).toBeVisible()

  // Saved as an ordinary encrypted vault: no backup fields, nothing readable.
  await expect.poll(async () => (await noteJson(page))?.encryption?.cipher).toBe('AES-256-GCM')
  const saved = await noteJson(page)
  expect(saved.exportedAt).toBeUndefined()
  expect(saved.vault).toBeUndefined()
  for (const s of SEEDS) expect(await noteText(page)).not.toContain(s.label)

  // It locks and unlocks with the backup's password.
  await app.getByRole('button', { name: 'Lock', exact: true }).click()
  await expect(app.getByRole('heading', { name: 'Vault locked' })).toBeVisible()
  await app.getByLabel('Vault password').fill(BACKUP_PASSWORD)
  await app.getByRole('button', { name: 'Unlock' }).click()
  await expect(app.getByText(SEEDS[0].label, { exact: true }).first()).toBeVisible()
  expect(errors).toEqual([])
})

test('restores pasted text, plain or encrypted, and refuses anything else', async ({ page }) => {
  let { app, errors } = await open(page)
  await app.getByRole('button', { name: 'Restore a backup file' }).click()
  await app.getByText('Paste the text instead').click()
  await app.getByLabel('Backup text').fill('my shopping list')
  await app.getByRole('button', { name: 'Continue' }).click()
  await expect(app.getByText(/This is not the text of a Keyfold backup or note/)).toBeVisible()

  // A plain vault, e.g. from a Standard Notes export: no password to ask for.
  await app.getByLabel('Backup text').fill(vaultText(SEEDS))
  await app.getByRole('button', { name: 'Continue' }).click()
  await expect(app.getByText(/Restored 3 entries\. This vault has no password of its own/)).toBeVisible()
  await expect.poll(async () => (await noteJson(page))?.vault?.entries?.length).toBe(3)
  expect(errors).toEqual([])

  // An encrypted note's text, saved with an old, weaker key setting.
  ;({ app, errors } = await open(page))
  await app.getByRole('button', { name: 'Restore a backup file' }).click()
  await app.getByText('Paste the text instead').click()
  await app.getByLabel('Backup text').fill(ENCRYPTED_NOTE)
  await app.getByRole('button', { name: 'Continue' }).click()
  await expect(app.getByRole('heading', { name: 'Encrypted vault' })).toBeVisible()
  await app.getByLabel('Vault password').fill(KAT_PASSWORD)
  await app.getByRole('button', { name: 'Restore', exact: true }).click()
  await expect(app.getByText('Known answer', { exact: true }).first()).toBeVisible()
  // Re-encrypted at the current strength.
  await expect.poll(async () => (await noteJson(page))?.encryption?.iterations).toBeGreaterThan(1000)
  expect(errors).toEqual([])
})

test('restore can be cancelled, is offered only while editing is allowed, and suits the phone app', async ({ page }) => {
  let { app } = await open(page)
  await app.getByRole('button', { name: 'Restore a backup file' }).click()
  await expect(app.getByRole('heading', { name: 'Restore a backup' })).toBeVisible()
  await app.getByRole('button', { name: 'Cancel' }).click()
  await expect(app.getByText('No keys yet.')).toBeVisible()

  await page.getByRole('button', { name: 'Toggle "Prevent editing"' }).click()
  await expect(app.getByText('"Prevent editing" is on for this note.')).toBeVisible()
  await expect(app.getByRole('button', { name: 'Restore a backup file' })).toHaveCount(0)

  // In the phone apps, pasting comes first: choosing a file may do nothing there.
  ;({ app } = await open(page, '', { mobile: '1' }))
  await app.getByRole('button', { name: 'Restore a backup file' }).click()
  await expect(app.getByText(/may not let plugins open files/)).toBeVisible()
  await expect(app.getByLabel('Backup text')).toBeVisible()
})

test('an empty vault offers every type of entry, not only crypto ones', async ({ page }) => {
  const { app, errors } = await open(page)
  const choices = app.getByRole('group', { name: 'Add your first entry' }).getByRole('button')
  await expect(choices).toHaveText([
    'Seed phrase',
    'Wallet key',
    'SSH key',
    'PGP key',
    'API key or token',
    'Other key',
    'Recovery codes',
    'Other secret',
  ])
  await choices.filter({ hasText: 'Recovery codes' }).click()
  await expect.poll(async () => (await noteJson(page))?.vault?.entries?.map((e: any) => e.kind)).toEqual(['recoveryCodes'])
  await expect(app.getByRole('group', { name: 'Add your first entry' })).toHaveCount(0)
  expect(errors).toEqual([])
})

test('on phones, Add keeps its label and sits next to the filter at the same height', async ({ page }) => {
  test.skip(test.info().project.name === 'desktop', 'phone layout only')
  const { app } = await open(page, '', { themeUrl: '/dev/dark-theme.css' })
  const search = await app.getByRole('searchbox', { name: 'Search' }).boundingBox()
  const filter = await app.getByRole('combobox', { name: 'Filter' }).boundingBox()
  const add = app.getByRole('button', { name: 'Add', exact: true })
  await expect(add.getByText('Add', { exact: true })).toBeVisible()
  const box = (await add.boundingBox())!
  // Search has its own row; the filter fills the next one, next to Add.
  expect(filter!.y).toBeGreaterThan(search!.y + search!.height - 1)
  expect(Math.abs(box.y - filter!.y)).toBeLessThanOrEqual(1)
  expect(Math.abs(box.height - filter!.height)).toBeLessThanOrEqual(1)
  expect(box.x + box.width).toBeLessThanOrEqual(search!.x + search!.width + 1)
  expect(filter!.width).toBeGreaterThan(box.width)
})
