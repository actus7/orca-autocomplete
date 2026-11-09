// Runs the plugin's editor code in a real browser, because some of what it relies on is Monaco's
// behaviour (when it calls a provider, what it does with an accepted suggestion) and neither the type
// checker nor tests in Node can see that.
//
//   npm run test:browser            about 15 seconds
//   npm run test:browser -- --slow  also waits half a minute to see an accepted suggestion judged "kept"
//
// Needs Chrome, Chromium or Edge: set CHROME_PATH, or it looks in the usual places (and in Playwright's
// download folder). Without one it says so and succeeds, so it never blocks a machine that has none.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const here = fileURLToPath(new URL('.', import.meta.url))
const slow = process.argv.includes('--slow')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function findBrowser() {
  const fromEnv = process.env.CHROME_PATH
  if (fromEnv && existsSync(fromEnv)) {
    return fromEnv
  }
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium'
  ]
  for (const base of [join(homedir(), 'AppData/Local/ms-playwright'), join(homedir(), '.cache/ms-playwright'), join(homedir(), 'Library/Caches/ms-playwright')]) {
    if (existsSync(base)) {
      for (const dir of readdirSync(base).filter((name) => name.startsWith('chromium-')).sort().reverse()) {
        candidates.unshift(...['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'].map((tail) => join(base, dir, tail)))
      }
    }
  }
  return candidates.find((path) => existsSync(path))
}

const chrome = findBrowser()
if (!chrome) {
  console.log('skipped: no Chrome, Chromium or Edge found (set CHROME_PATH to run these tests)')
  process.exit(0)
}

const plugin = join(here, '..')
let server
const work = mkdtempSync(join(tmpdir(), 'orca-autocomplete-browser-'))
for (const page of ['ghost', 'lsp', 'core']) {
  await build({
    entryPoints: [join(here, `${page}.ts`)],
    bundle: true,
    format: 'iife',
    outfile: join(work, `${page}.js`),
    loader: { '.ttf': 'dataurl' },
    logLevel: 'warning',
    absWorkingDir: join(here, '..')
  })
  writeFileSync(
    join(work, `${page}.html`),
    `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${page}.css"></head><body style="margin:0"><div id="root" style="width:800px;height:300px"></div><script src="${page}.js"></script></body></html>`
  )
}

const port = 9300 + Math.floor(Math.random() * 500)
const browser = spawn(chrome, [`--remote-debugging-port=${port}`, '--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${join(work, 'profile')}`, 'about:blank'], { stdio: 'ignore' })

async function until(check, what) {
  for (let i = 0; i < 80; i += 1) {
    try {
      const value = await check()
      if (value) {
        return value
      }
    } catch {
      // Not ready yet.
    }
    await sleep(250)
  }
  throw new Error(`timed out waiting for ${what}`)
}

/**
 * Opens one of the pages and gives back `ev` (evaluate in the page), `send` (any DevTools command, for real
 * key presses) and `command` (run an editor command). `url` and `ready` open a page served over HTTP and say
 * what to wait for; by default it is one of the pages built from `browser-tests/*.ts`.
 */
async function open(page, { url, ready = 'typeof __editor !== "undefined"' } = {}) {
  const href = url ?? pathToFileURL(join(work, `${page}.html`)).href
  const target = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURI(href)}`, { method: 'PUT' }).then((r) => r.json())
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve) => (socket.onopen = resolve))
  let next = 0
  const waiting = new Map()
  socket.onmessage = (message) => {
    const data = JSON.parse(message.data)
    waiting.get(data.id)?.(data)
    waiting.delete(data.id)
  }
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = (next += 1)
      waiting.set(id, resolve)
      socket.send(JSON.stringify({ id, method, params }))
    })
  const ev = async (expression) => {
    const answer = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (answer.result.exceptionDetails) {
      throw new Error(JSON.stringify(answer.result.exceptionDetails).slice(0, 300))
    }
    return answer.result.result.value
  }
  await until(() => ev(ready), `the ${page} page`)
  return {
    ev,
    send,
    close: () => socket.close(),
    command: (id) => ev(`__editor.focus(); __editor.trigger("browser-test", "${id}", {}); 1`),
    type: (text) => ev(`__editor.focus(); __editor.trigger("browser-test", "type", { text: ${JSON.stringify(text)} }); 1`),
    reset: () => ev('__log.length = 0; __editor.setValue("const total = "); __editor.setPosition({ lineNumber: 1, column: 15 }); 1')
  }
}

const results = []
async function scenario(name, run) {
  try {
    await run()
    results.push({ name, ok: true })
    console.log(`  ok   ${name}`)
  } catch (error) {
    results.push({ name, ok: false })
    console.log(`  FAIL ${name}\n       ${error.message.split('\n').slice(0, 4).join('\n       ')}`)
  }
}

try {
  await until(() => fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.ok), 'the browser')

  const ghost = await open('ghost')
  const asks = () => ghost.ev('__log.filter(([name]) => name === "completion.ask").length')
  const reported = async () => JSON.parse(await ghost.ev('JSON.stringify(__log.filter(([name]) => name === "metrics.event").map(([, input]) => input.kind + "#" + input.id))'))

  console.log('ghost text')
  await scenario('a suggestion is asked for once and counted as shown once', async () => {
    await ghost.command('editor.action.inlineSuggest.trigger')
    await sleep(1200)
    assert.equal(await asks(), 1)
    assert.deepEqual(await reported(), ['shown#1'])
  })
  await scenario('accepting a word at a time, then the rest, makes no new request and is counted', async () => {
    await ghost.command('editor.action.inlineSuggest.acceptNextWord')
    await sleep(800)
    assert.equal(await ghost.ev('__editor.getValue()'), 'const total = alpha')
    await ghost.command('editor.action.inlineSuggest.acceptNextWord')
    await sleep(800)
    await ghost.command('editor.action.inlineSuggest.commit')
    await sleep(800)
    assert.equal(await asks(), 1, 'the provider was not asked again')
    assert.equal(await ghost.ev('__editor.getValue()'), 'const total = alpha + beta;')
    assert.deepEqual(await reported(), ['shown#1', 'partial#1', 'partial#1', 'accepted#1'])
  })
  await scenario('typing along a suggestion makes no request, typing something else asks again', async () => {
    await ghost.reset()
    await sleep(300)
    await ghost.command('editor.action.inlineSuggest.trigger')
    await sleep(1200)
    const before = await asks()
    for (const letter of ['a', 'l', 'p']) {
      await ghost.type(letter)
      await sleep(700)
    }
    assert.equal((await asks()) - before, 0, 'typing along asked again')
    await ghost.type('x')
    await sleep(1300)
    assert.equal((await asks()) - before, 1, 'a different letter did not ask again')
  })
  await scenario('the line action takes the suggestion, counts it as partial and asks nothing new', async () => {
    await ghost.reset()
    await sleep(300)
    await ghost.command('editor.action.inlineSuggest.trigger')
    await sleep(1200)
    const before = await asks()
    await ghost.ev('__editor.getAction("orcaAutocomplete.acceptLine").run()')
    await sleep(800)
    assert.equal(await ghost.ev('__editor.getValue()'), 'const total = alpha + beta;')
    assert.equal((await asks()) - before, 0)
    assert.ok((await reported()).some((event) => event.startsWith('partial') || event.startsWith('accepted')), JSON.stringify(await reported()))
  })
  await scenario('an accepted suggestion that is deleted right away is judged undone', async () => {
    await ghost.reset()
    await sleep(300)
    await ghost.command('editor.action.inlineSuggest.trigger')
    await sleep(1200)
    await ghost.command('editor.action.inlineSuggest.commit')
    await sleep(500)
    await ghost.ev('__editor.executeEdits("browser-test", [{ range: { startLineNumber: 1, startColumn: 15, endLineNumber: 1, endColumn: 28 }, text: "" }]); 1')
    await sleep(5800)
    assert.ok((await reported()).some((event) => event.startsWith('undone')), JSON.stringify(await reported()))
    assert.ok(!(await reported()).some((event) => event.startsWith('kept')))
  })
  if (slow) {
    await scenario('an accepted suggestion that stays is judged kept after half a minute', async () => {
      await ghost.reset()
      await sleep(300)
      await ghost.command('editor.action.inlineSuggest.trigger')
      await sleep(1200)
      await ghost.command('editor.action.inlineSuggest.commit')
      await sleep(6000)
      assert.ok(!(await reported()).some((event) => event.startsWith('kept')), 'judged too early')
      await sleep(25500)
      assert.ok((await reported()).some((event) => event.startsWith('kept')), JSON.stringify(await reported()))
    })
  }
  ghost.close()

  const lsp = await open('lsp')
  console.log('language server bridge')
  await scenario('picking a symbol from another file inserts its import, which the server gives only on resolve', async () => {
    await sleep(800)
    await lsp.command('editor.action.triggerSuggest')
    await sleep(1500)
    await lsp.command('acceptSelectedSuggestion')
    await sleep(1200)
    assert.deepEqual(JSON.parse(await lsp.ev('JSON.stringify(__log)')), ['textDocument/completion', 'completionItem/resolve'])
    const value = (await lsp.ev('__editor.getValue()')).replace(/\r\n/g, '\n')
    assert.equal(value, "import { Money } from './money'\nconst price = Money")
  })
  lsp.close()

  const core = await open('core')
  console.log('snippets and postfix (no model, no server)')
  // Puts `text` in the editor with the cursor at its end, asks for suggestions and accepts the first one.
  const accept = async (text) => {
    await core.ev(`__editor.setValue(${JSON.stringify(text)}); __editor.focus(); __editor.setPosition(__editor.getModel().getFullModelRange().getEndPosition()); 1`)
    await sleep(200)
    await core.command('editor.action.triggerSuggest')
    await sleep(700)
    await core.command('acceptSelectedSuggestion')
    await sleep(400)
    return (await core.ev('__editor.getValue()')).replace(/\r\n/g, '\n').replace(/\n[ \t]+/g, '\n')
  }
  await scenario('a snippet word expands into its template', async () => {
    assert.equal(await accept('forof'), 'for (const item of items) {\n\n}')
  })
  await scenario('the expression before the dot goes into the postfix template', async () => {
    assert.equal(await accept('items.filter(x => x.ok).i'), 'if (items.filter(x => x.ok)) {\n\n}')
  })
  await scenario('a postfix template drops the parentheses that wrap the whole expression', async () => {
    assert.equal(await accept('(a && b).i'), 'if (a && b) {\n\n}')
  })
  await scenario('nothing is offered after a dot inside a string', async () => {
    await core.ev('__editor.setValue("const s = \'see user."); __editor.setPosition(__editor.getModel().getFullModelRange().getEndPosition()); 1')
    await sleep(200)
    await core.command('editor.action.triggerSuggest')
    await sleep(700)
    // Why: Monaco lists the words of the document by itself; what must be absent are the plugin's own items.
    const shown = await core.ev('[...document.querySelectorAll(".suggest-widget .monaco-list-row")].map((row) => row.textContent).join("|")')
    assert.ok(!/\.(if|log|var|return)/.test(shown), `postfix items inside a string: ${shown}`)
  })
  core.close()

  // The bundle Orca installs (editor/dist, from `npm run build`), loaded the way Orca loads it, over HTTP so
  // module scripts and workers work, with a stand-in for the `orca` object the host injects.
  if (existsSync(join(plugin, 'editor/dist/main.js'))) {
    console.log('the built editor (what Orca installs)')
    const smoke = (language) => `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/editor/dist/main.css"></head>
<body style="margin:0"><div id="root" style="width:800px;height:300px"></div>
<script>
window.__LANGUAGE__ = ${JSON.stringify(language)}
window.__calls = []
const none = () => ({ dispose() {} })
window.orca = {
  locale: 'en',
  on: none,
  settings: { get: async () => ({}), onDidChange: none },
  plugin: {
    on: none,
    request: async (name) => (window.__calls.push(name), name === 'editor.settings' ? { settings: null } : name === 'lsp.attach' ? { status: { state: 'none' } } : {})
  },
  document: { session: async () => ({ value: '', readOnly: false, change() {}, onReplace() {} }) }
}
</script><script type="module" src="/editor/dist/main.js"></script></body></html>`
    const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.ttf': 'font/ttf', '.json': 'application/json' }
    server = createServer((request, response) => {
      const path = decodeURIComponent(new URL(request.url, 'http://x').pathname)
      const smokeLanguage = /^\/smoke-(\w+)\.html$/.exec(path)?.[1]
      if (smokeLanguage) {
        response.setHeader('content-type', 'text/html')
        return response.end(smoke(smokeLanguage))
      }
      const file = join(plugin, path)
      if (!file.startsWith(plugin) || !existsSync(file) || !statSync(file).isFile()) {
        response.statusCode = 404
        return response.end()
      }
      response.setHeader('content-type', types[extname(file)] ?? 'application/octet-stream')
      response.end(readFileSync(file))
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${server.address().port}`

    const key = (page, key, extra = {}) =>
      page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, ...extra }).then(() => page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, ...extra }))
    const typeKeys = async (page, text) => {
      for (const char of text) {
        await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: char, text: char })
        await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: char })
        await sleep(60)
      }
    }
    const written = (page) => page.ev(`[...document.querySelectorAll('.view-line')].map((line) => line.textContent.replace(/\\u00a0/g, ' ')).join('\\n')`)
    // Opens the built editor for a language and types into it as a person would.
    // `list` opens the suggestion list with Ctrl+Space first: the editor does not pop it up while typing
    // (so it never competes with the AI's gray text); only a trigger character such as the dot does.
    const typeInto = async (language, text, { list = false } = {}) => {
      const page = await open(`built ${language}`, { url: `${base}/smoke-${language}.html`, ready: '!!document.querySelector(".monaco-editor textarea")' })
      await page.ev('document.querySelector(".monaco-editor textarea").focus(); 1')
      await sleep(1500)
      await typeKeys(page, text)
      if (list) {
        await key(page, ' ', { code: 'Space', windowsVirtualKeyCode: 32, modifiers: 2 })
      }
      await sleep(1500)
      await key(page, 'Enter', { code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
      await sleep(600)
      const result = { text: await written(page), calls: await page.ev('window.__calls') }
      page.close()
      return result
    }

    await scenario('the built editor starts and asks the host for the editor settings', async () => {
      const { calls } = await typeInto('python', 'x')
      assert.ok(calls.includes('editor.settings'), JSON.stringify(calls))
    })
    await scenario('a postfix template works in the built TypeScript editor', async () => {
      const { text } = await typeInto('typescript', 'ready.i')
      assert.ok(text.startsWith('if (ready) {'), JSON.stringify(text))
    })
    await scenario('a snippet works in the built Python editor, opened with Ctrl+Space', async () => {
      const { text } = await typeInto('python', 'for', { list: true })
      assert.equal(text.split('\n')[0], 'for item in items:', JSON.stringify(text))
    })
  }
} finally {
  server?.close()
  browser.kill()
  await sleep(1500)
  try {
    rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 })
  } catch {
    // The browser may still hold its profile folder; it is in the temp folder, so leaving it is harmless.
  }
}

const failed = results.filter((result) => !result.ok).length
console.log(`${results.length - failed} of ${results.length} passed`)
process.exit(failed === 0 ? 0 : 1)
