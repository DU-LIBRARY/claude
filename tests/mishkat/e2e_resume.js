// Reopening the Mishkāt reader with no #link returns to the hadeeth, scroll position and open
// al-Ikmāl narrator the reader left. Run: node tests/mishkat/e2e_resume.js
'use strict';
const path = require('path');
const { chromium } = require('playwright');
const { serve } = require('./_common');

const REPO = path.resolve(__dirname, '..', '..');
const assert = (c, m) => { if (!c) throw new Error(m); console.log('ok -', m); };

async function run(browser, base, label, viewport) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  const url = base + '/mishkat/';
  await page.goto(url + '#h3100'); await page.waitForSelector('#reader-main .matn');
  await page.waitForTimeout(600);
  const target = await page.evaluate(() => { const h = document.documentElement.scrollHeight - innerHeight; window.scrollTo(0, Math.round(h * 0.6)); return Math.round(h * 0.6); });
  await page.waitForTimeout(700);
  const chip = page.locator('#reader-main .narr-chip').first();
  const hasNarr = await chip.count();
  if (hasNarr) { await chip.evaluate((b) => b.click()); await page.waitForTimeout(500); }
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mishkat-last')));
  assert(saved && saved.sid === 'h3100' && saved.v === 'read', label + ': position saved for 3100');
  // reopen the app the way the home-screen icon does: no hash
  await page.goto(url); await page.waitForSelector('#reader-main .matn'); await page.waitForTimeout(1600);
  const st = await page.evaluate(() => ({ hash: location.hash, y: window.scrollY, view: document.getElementById('app').dataset.view, narr: document.getElementById('dlg-narr').open }));
  assert(st.hash === '#h3100', label + ': reopened on hadeeth 3100 (' + st.hash + ')');
  assert(st.view === 'read', label + ': reader view is showing');
  assert(Math.abs(st.y - target) < 60, label + ': scroll restored (' + st.y + ' vs ' + target + ')');
  if (hasNarr) assert(st.narr, label + ': the al-Ikmāl narrator is open again');
  // a deep link still wins over the saved place
  await page.goto(url + '#h3200'); await page.waitForSelector('#reader-main .matn'); await page.waitForTimeout(400);
  assert(await page.evaluate(() => location.hash) === '#h3200', label + ': a #link still opens its own hadeeth');
  assert(errs.length === 0, label + ': no page errors ' + errs.join(' | '));
  await ctx.close();
}

(async () => {
  const srv = await serve(REPO);
  const browser = await chromium.launch();
  try {
    await run(browser, srv.base, 'phone', { width: 390, height: 844 });
    await run(browser, srv.base, 'desktop', { width: 1400, height: 900 });
  } finally { await browser.close(); srv.close(); }
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
