// Measures a provider and model on code like yours: cuts places out of this repository's own files,
// asks for the rest of the line with the plugin's real request, and compares the answer with the code
// that was there. Run it before and after a change to see whether the change helped.
//
//   node bench/run.mjs --base-url http://localhost:11434/v1 --model qwen2.5-coder:1.5b --yes
//
// Options: --format openai|anthropic (openai)  --key-env NAME (env var holding the key)  --samples N (40)
//          --seed N (1)  --timeout MS (6000)  --dir PATH (repeat; default src and editor/src)  --out FILE
// It sends pieces of the files it reads to the provider you name, so a remote one needs --yes.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { complete } from '../src/complete.ts'
import { percentile } from '../src/metrics.ts'
import { pickCuts, score } from './lib.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2)
const option = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback)
const dirs = args.flatMap((arg, i) => (arg === '--dir' ? [args[i + 1]] : []))

const baseUrl = option('base-url', '')
const model = option('model', '')
if (!baseUrl || !model) {
  console.error('Need --base-url and --model. See the top of bench/run.mjs.')
  process.exit(2)
}
const host = new URL(baseUrl).hostname
if (!/^(localhost|127\.|\[?::1)/.test(host) && !args.includes('--yes')) {
  console.error(`This sends code from this repository to ${host}. Add --yes to go ahead.`)
  process.exit(2)
}

const provider = {
  format: option('format', 'openai'),
  baseUrl,
  model,
  apiKey: process.env[option('key-env', '')] ?? '',
  maxTokens: 96
}
const samples = Number(option('samples', '40'))
const timeoutMs = Number(option('timeout', '6000'))

function collect(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      return entry.name === 'dist' || entry.name === 'node_modules' ? [] : collect(path)
    }
    return /\.(ts|tsx|mjs)$/.test(entry.name) && !/\.(test|generated)\./.test(entry.name) ? [{ path: relative(root, path), text: readFileSync(path, 'utf8') }] : []
  })
}

const files = (dirs.length ? dirs : ['src', 'editor/src']).flatMap((dir) => collect(join(root, dir)))
const cuts = pickCuts(files, samples, Number(option('seed', '1')))
const results = []
for (const cut of cuts) {
  const startedAt = Date.now()
  try {
    const suggestion = await complete(provider, { path: cut.path, languageId: 'typescript', prefix: cut.prefix, suffix: cut.suffix }, AbortSignal.timeout(timeoutMs))
    results.push({ ...score(suggestion, cut.expected), ms: Date.now() - startedAt })
  } catch (error) {
    results.push({ error: error instanceof Error ? error.name : String(error), ms: Date.now() - startedAt })
  }
}

const answered = results.filter((r) => !r.error)
const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0)
const summary = {
  model,
  host,
  samples: results.length,
  errors: results.length - answered.length,
  empty: answered.filter((r) => r.empty).length,
  exact: `${Math.round((100 * answered.filter((r) => r.exact).length) / Math.max(1, results.length))}%`,
  similarity: mean(answered.map((r) => r.similarity)).toFixed(2),
  p50: percentile(results.map((r) => r.ms), 50),
  p95: percentile(results.map((r) => r.ms), 95)
}
console.table([summary])
if (option('out', '')) {
  writeFileSync(option('out', ''), JSON.stringify({ summary, results }, null, 2))
}
