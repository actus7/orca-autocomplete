// Renders the listing images from assets/templates/*.html into assets/*.png.
//   PLAYWRIGHT=<path to playwright's index.js> node assets/build.mjs [name ...]
// Developer tooling only: nothing here ships inside the plugin.
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT ?? 'playwright')

const JOBS = {
  icon: { template: 'icon.html', width: 256, height: 256, transparent: true },
  cover: { template: 'cover.html', width: 1600, height: 1000 },
  'screenshot-editor': { template: 'shot-editor.html', width: 1920, height: 1200 },
  'screenshot-panel': { template: 'shot-panel.html', width: 1920, height: 1200 },
  'screenshot-states': { template: 'shot-states.html', width: 1920, height: 1200 }
}

const wanted = process.argv.slice(2)
const names = wanted.length ? wanted : Object.keys(JOBS)
const browser = await chromium.launch()
for (const name of names) {
  const job = JOBS[name]
  if (!job) {
    throw new Error(`unknown image "${name}"; known: ${Object.keys(JOBS).join(', ')}`)
  }
  const page = await browser.newPage({ viewport: { width: job.width, height: job.height } })
  await page.goto(pathToFileURL(join(here, 'templates', job.template)).href)
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: join(here, `${name}.png`), omitBackground: Boolean(job.transparent) })
  await page.close()
  console.log(`wrote assets/${name}.png`)
}
await browser.close()
