// Compares two benchmark runs made with the same --seed and --samples, place by place:
//   node bench/compare.mjs without.json with.json
import { readFileSync } from 'node:fs'
import { compareRuns } from './lib.mjs'

const clean = process.argv.includes('--clean')
const [first, second] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
if (!first || !second) {
  console.error('Usage: node bench/compare.mjs <baseline.json> <run under test.json> [--clean]  (--clean leaves out places where an answer carried text injected by a gateway)')
  process.exit(2)
}
const a = JSON.parse(readFileSync(first, 'utf8'))
const b = JSON.parse(readFileSync(second, 'utf8'))
if (a.results.length !== b.results.length) {
  console.error('The runs have a different number of places: use the same --seed and --samples.')
  process.exit(2)
}
const r = compareRuns(a, b, { skipPolluted: clean })
const pct = (n) => `${((100 * n) / Math.max(1, r.compared)).toFixed(0)}%`
console.log(`Compared ${r.compared} places both answered${clean ? ', neither polluted' : ''} (${a.summary.model}; baseline: context ${a.summary.context}, tested: context ${b.summary.context})`)
console.log(`  similarity   ${r.similarityA.toFixed(3)} -> ${r.similarityB.toFixed(3)}   better in ${r.wins}, worse in ${r.losses}, about the same in ${r.ties}   (sign test p = ${r.pSimilarity.toFixed(3)})`)
console.log(`  exact match  ${r.exactA} (${pct(r.exactA)}) -> ${r.exactB} (${pct(r.exactB)})   gained ${r.exactGained}, lost ${r.exactLost}   (sign test p = ${r.pExact.toFixed(3)})`)
console.log(`  answers carrying the gateway's own text instead of code: ${a.summary.polluted ?? '?'} -> ${b.summary.polluted ?? '?'}`)
console.log(`  answer time  p50 ${a.summary.p50} ms -> ${b.summary.p50} ms; errors ${a.summary.errors} -> ${b.summary.errors}; places that had context: ${b.summary.withContext} of ${b.summary.samples}`)
