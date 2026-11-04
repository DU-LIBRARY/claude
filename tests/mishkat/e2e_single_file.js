// Single-file build test: dist/mishkat-offline.html opened from disk (file://) with every network request blocked.
// Usage: node tests/mishkat/e2e_single_file.js   (build first: python3 tools/build_mishkat_single.py)
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { REPO, makeReporter } = require('./_common');

const FILE = path.join(REPO, 'dist', 'mishkat-offline.html');
const SECTIONS = JSON.parse(fs.readFileSync(path.join(REPO, 'mishkat', 'data', 'nikah.json'), 'utf8'));
const nrm = (t) => t.replace(/[ً-ٰٟـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
const matnOf = (s) => (s.matn || []).map((r) => (r.fn != null ? '' : r.t)).join('');

async function run(browser, R, vp) {
  const label = `${vp.w}x${vp.h}`;
  console.log(`\n== single file ${label} ==`);
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
  const blocked = [];
  const failed = [];
  // Every request is aborted except file: URLs. The page must not need anything else.
  await ctx.route('**/*', (r) => {
    const u = r.request().url();
    if (u.startsWith('file:') || u.startsWith('data:') || u.startsWith('blob:')) return r.continue();
    blocked.push(u);
    return r.abort();
  });
  const page = await ctx.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('requestfailed', (q) => { if (!q.url().startsWith('data:')) failed.push(q.url() + ' ' + (q.failure() && q.failure().errorText)); });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));

  await page.goto('file://' + FILE);
  await page.waitForFunction(() => document.getElementById('status') && document.getElementById('status').dataset.ready === '1', null, { timeout: 30000 }).catch(() => {});
  const onlineStatus = await page.textContent('#status-text');
  R.check(`[${label}] status before going offline says it works anywhere`, /works anywhere/.test(onlineStatus), onlineStatus);
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => document.getElementById('status').dataset.ready === '1', null, { timeout: 30000 }).catch(() => {});

  const status = await page.textContent('#status-text');
  R.check(`[${label}] status while offline`, /Offline/.test(status), status);
  const sw = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'no API';
    try {
      const r = await navigator.serviceWorker.getRegistration();
      return r ? 'registered' : 'none';
    } catch (e) { return 'no API (' + e.name + ')'; }
  });
  R.check(`[${label}] no service worker registered`, /^no API|^none$/.test(sw), sw);
  const syncText = (await page.textContent('#sync-box')).trim();
  R.check(`[${label}] sync area says "Sync is available in the web app."`, syncText === 'Sync is available in the web app.', syncText);
  const rows = await page.locator('#list li.e').count();
  R.check(`[${label}] list renders every section`, rows === SECTIONS.length, rows);

  // search
  const want = SECTIONS.filter((s) => nrm(matnOf(s)).includes(nrm('الشباب'))).length;
  await page.fill('#q', 'الشباب');
  await page.waitForTimeout(350);
  const got = await page.locator('#list li.e').count();
  R.check(`[${label}] search الشباب works`, got === want, `app ${got}, data ${want}`);
  await page.fill('#q', '3085');
  await page.waitForTimeout(350);
  const ids = await page.locator('#list li.e').evaluateAll((ls) => ls.map((l) => l.dataset.id));
  R.check(`[${label}] number search 3085 works`, ids.join() === 'h3085', ids.join());
  await page.fill('#q', '');
  await page.waitForTimeout(150);

  // reader + compare modes
  await page.click('#row-h3081 a.rowlink');
  await page.waitForSelector('#app[data-view="read"]');
  R.check(`[${label}] reader opens h3081`, (await page.textContent('#rt-num')).includes('3081'));
  await page.click('#mode button[data-v="one"]');
  await page.waitForTimeout(200);
  R.check(`[${label}] compare One`, (await page.locator('#rd .cm:not([hidden])').count()) === 1);
  await page.click('#mode button[data-v="stack"]');
  await page.waitForTimeout(200);
  R.check(`[${label}] compare Stacked`, (await page.locator('#rd .cm:not([hidden])').count()) === 3);
  if (vp.w >= 1000) {
    await page.click('#mode button[data-v="side"]');
    await page.waitForTimeout(250);
    R.check(`[${label}] compare Side by side`, (await page.getAttribute('#rd', 'data-mode')) === 'side');
    await page.click('#mode button[data-v="stack"]');
  }
  // footnotes toggle
  const fnBefore = await page.getAttribute('#fn-toggle', 'aria-pressed');
  await page.click('#fn-toggle');
  const fnAfter = await page.getAttribute('#fn-toggle', 'aria-pressed');
  R.check(`[${label}] footnotes toggle`, fnBefore === 'true' && fnAfter === 'false');
  await page.click('#fn-toggle');

  // notes persist offline
  await page.fill('#note-h3081', 'Single-file note beta');
  await page.waitForTimeout(900);
  await page.reload();
  await page.waitForFunction(() => document.getElementById('status').dataset.ready === '1', null, { timeout: 30000 }).catch(() => {});
  await page.evaluate(() => { location.hash = 'h3081'; });
  await page.waitForSelector('#note-h3081').catch(() => {});
  R.check(`[${label}] note persists across reload offline`, (await page.inputValue('#note-h3081').catch(() => '')) === 'Single-file note beta');

  // theme (Settings lives in the list pane, which a phone shows only on the list view)
  if (vp.w < 1000) {
    await page.evaluate(() => { history.replaceState(null, '', location.pathname + location.search); window.dispatchEvent(new HashChangeEvent('hashchange')); });
    await page.waitForSelector('#app[data-view="home"]');
  }
  await page.click('#settings');
  await page.waitForSelector('#dlg-settings[open]');
  await page.click('#theme button[data-v="dark"]');
  await page.waitForTimeout(150);
  const dark = await page.evaluate(() => document.documentElement.dataset.theme === 'dark' && getComputedStyle(document.body).backgroundColor);
  R.check(`[${label}] theme Dark`, !!dark, dark);
  await page.click('#theme button[data-v="light"]');
  await page.click('#theme button[data-v="system"]');
  await page.click('#dlg-settings button[value="close"]');

  const net = blocked.filter((u) => !u.startsWith('file:'));
  R.check(`[${label}] zero blocked/aborted network requests`, failed.length === 0 && net.length === 0, [...failed, ...net].slice(0, 5).join(' ; '));
  R.check(`[${label}] zero console errors`, consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' ; '));
  R.check(`[${label}] zero page errors`, pageErrors.length === 0, pageErrors.slice(0, 3).join(' ; '));
  await ctx.close();
}

(async () => {
  const R = makeReporter('e2e_single_file');
  if (!fs.existsSync(FILE)) { R.check('dist/mishkat-offline.html exists', false, FILE); R.summary(); process.exit(1); }
  const browser = await chromium.launch();
  try {
    await run(browser, R, { w: 390, h: 844 });
    await run(browser, R, { w: 1376, h: 1032 });
  } catch (e) {
    R.check('script ran to completion', false, e.stack.split('\n').slice(0, 3).join(' | '));
  } finally {
    await browser.close();
  }
  process.exit(R.summary() ? 0 : 1);
})();
