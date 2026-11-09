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
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
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

const work = mkdtempSync(join(tmpdir(), 'orca-autocomplete-browser-'))
for (const page of ['ghost', 'lsp']) {
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

/** Opens one of the pages and gives back `ev` (evaluate in the page) and `command` (run an editor command). */
async function open(page) {
  const target = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURI(pathToFileURL(join(work, `${page}.html`)).href)}`, { method: 'PUT' }).then((r) => r.json())
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve) => (socket.onopen = resolve))
  let next = 0
  const waiting = new Map()
  socket.onmessage = (message) => {
    const data = JSON.parse(message.data)
    waiting.get(data.id)?.(data)
    waiting.delete(data.id)
  }
  const ev = async (expression) => {
    const id = (next += 1)
    const answer = await new Promise((resolve) => {
      waiting.set(id, resolve)
      socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
    })
    if (answer.result.exceptionDetails) {
      throw new Error(JSON.stringify(answer.result.exceptionDetails).slice(0, 300))
    }
    return answer.result.result.value
  }
  await until(() => ev('typeof __editor !== "undefined"'), `the ${page} page`)
  return {
    ev,
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
} finally {
  browser.kill()
  await sleep(500)
  rmSync(work, { recursive: true, force: true })
}

const failed = results.filter((result) => !result.ok).length
console.log(`${results.length - failed} of ${results.length} passed`)
process.exit(failed === 0 ? 0 : 1)
