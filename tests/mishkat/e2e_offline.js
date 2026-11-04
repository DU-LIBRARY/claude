// End-to-end offline test for the Mishkāt reader (web app in mishkat/, served over http).
// Usage: node tests/mishkat/e2e_offline.js
// Runs the full flow at 390x844 (phone) and 1376x1032 (iPad 13 landscape), then a 360px overflow pass.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { REPO, CHROME, serve, watch, makeReporter, waitReady } = require('./_common');

const SW_SRC = fs.readFileSync(path.join(REPO, 'mishkat', 'sw.js'), 'utf8');
const VERSION = /const VERSION = '([^']+)'/.exec(SW_SRC)[1];
const SECTIONS = JSON.parse(fs.readFileSync(path.join(REPO, 'mishkat', 'data', 'nikah.json'), 'utf8'));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mishkat-e2e-'));

// ---- data-side helpers (computed from the data, not hardcoded) ----
const segText = (runs) => (runs || []).map((r) => (r.fn != null ? '' : r.t)).join('').replace(/\s+/g, ' ').trim();
const nrm = (t) => t.replace(/[ً-ٰٟـۖ-ۭ]/g, '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ی/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
  .replace(/ء/g, '').replace(/[ʿʾ'’‘]/g, '').replace(/ک/g, 'ك');
const byId = (id) => SECTIONS.find((s) => s.id === id);
const matnOf = (s) => segText(s.matn);
const commText = (s) => s.commentaries.flatMap((c) => [...(c.editorial || []), ...(c.paras || []), ...(c.refs || [])].map(segText)).join(' ');

function pickCommentaryWord() {
  // a word that appears in h3081's commentary but in no hadeeth text at all, so only deep search can find it
  const s = byId('h3081');
  const matnAll = SECTIONS.map((x) => nrm(matnOf(x))).join(' ');
  const words = commText(s).split(/[\s.,،؛:؟!()\[\]«»"]+/).map((w) => nrm(w)).filter((w) => w.length >= 7 && /^[؀-ۿ]+$/.test(w));
  return words.find((w) => !matnAll.includes(w)) || null;
}

function footnoteSection() {
  for (const s of SECTIONS) for (const c of s.commentaries) if ((c.footnotes || []).length) return { s, c, fn: c.footnotes[0] };
  return null;
}

async function inView(page, selector) {
  return page.evaluate((sel) => {
    const n = document.querySelector(sel); if (!n) return { found: false };
    const r = n.getBoundingClientRect();
    return { found: true, top: r.top, bottom: r.bottom, inView: r.top >= -1 && r.bottom <= window.innerHeight + 1 && r.height > 0 };
  }, selector);
}

async function overflow(page) {
  return page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
}

// Return to the list on a phone-width reader without relying on history (the test navigates by hash).
async function gotoHome(page) {
  await page.evaluate(() => { history.replaceState(null, '', location.pathname + location.search); window.dispatchEvent(new HashChangeEvent('hashchange')); });
  await page.waitForSelector('#app[data-view="home"]');
}

// Click a row on the list (phone) or on the wide list; mirrors a real tap.
async function openRow(page, sid) {
  await page.click(`#row-${sid} a.rowlink`);
  await page.waitForFunction((id) => location.hash === '#' + id || document.getElementById('rt-num'), sid, { timeout: 5000 });
}

async function run(browser, srv, vp, R) {
  const label = `${vp.w}x${vp.h}`;
  console.log(`\n== ${label} (${vp.label}) ==`);
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, acceptDownloads: true });
  const page = await ctx.newPage();
  const log = watch(page);
  const wide = vp.w >= 1000;
  const sid0 = SECTIONS.find((s) => s.n === 3081).id;

  // 1. online install
  await page.goto(srv.base + '/mishkat/');
  await waitReady(page);
  let controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  if (!controlled) { await page.reload(); await waitReady(page); controlled = await page.evaluate(() => !!navigator.serviceWorker.controller); }
  R.check(`[${label}] service worker controls the page`, controlled);
  const status = await page.textContent('#status-t');
  R.check(`[${label}] "Ready offline" indicator shown`, /Ready offline/.test(status), status);
  const keys = await page.evaluate(() => caches.keys());
  R.check(`[${label}] cache ${VERSION} present`, keys.includes(VERSION), JSON.stringify(keys));
  const rows = await page.locator('#list li.e').count();
  R.check(`[${label}] 14 rows listed online`, rows === SECTIONS.length, rows);

  // 2. go offline and reload
  await ctx.setOffline(true);
  await page.reload();
  await waitReady(page);
  const offStatus = await page.textContent('#status-t');
  R.check(`[${label}] offline reload renders the list`, (await page.locator('#list li.e').count()) === SECTIONS.length);
  R.check(`[${label}] status while offline says all sections available`, /Offline|Ready offline/.test(offStatus), offStatus);

  // 3. search: unvowelled Arabic
  const want = SECTIONS.filter((s) => nrm(matnOf(s)).includes(nrm('الشباب'))).length;
  await page.fill('#q', 'الشباب');
  await page.waitForTimeout(400);
  let got = await page.locator('#list li.e').count();
  R.check(`[${label}] search الشباب (unvowelled) rows == sections containing it in matn`, got === want, `app ${got}, data ${want}`);
  await page.fill('#q', '');
  await page.keyboard.press('Escape');
  // with tashkeel: first word of h3081's hadeeth exactly as printed
  const withTash = matnOf(byId(sid0)).split(' ').slice(0, 2).join(' ');
  await page.fill('#q', withTash);
  await page.waitForTimeout(400);
  const hit = await page.locator(`#list li.e[data-id="${sid0}"]`).count();
  R.check(`[${label}] search with tashkeel finds h3081`, hit === 1, `"${withTash}"`);
  await page.fill('#q', '');
  await page.waitForTimeout(200);

  // 4. search by number, Latin and Arabic-Indic
  for (const q of ['3085', '٣٠٨٥']) {
    await page.fill('#q', q);
    await page.waitForTimeout(400);
    const ids = await page.locator('#list li.e').evaluateAll((ls) => ls.map((l) => l.dataset.id));
    R.check(`[${label}] number search "${q}" returns only h3085`, ids.length === 1 && ids[0] === 'h3085', ids.join(','));
  }
  await page.fill('#q', '');
  await page.waitForTimeout(200);

  // 5. commentary full-text toggle
  const cw = pickCommentaryWord();
  if (!cw) R.check(`[${label}] find a commentary-only word`, false, 'no candidate word');
  else {
    await page.fill('#q', cw);
    await page.waitForTimeout(400);
    const off = await page.locator(`#list li.e[data-id="${sid0}"]`).count();
    R.check(`[${label}] commentary word hidden when deep search is off`, off === 0, `"${cw}"`);
    await page.click('label.switch[for="deep"]');
    await page.waitForTimeout(400);
    const on = await page.locator(`#list li.e[data-id="${sid0}"]`).count();
    R.check(`[${label}] commentary word found when "Search inside commentaries" is on`, on === 1);
    await page.click('label.switch[for="deep"]');
    await page.fill('#q', '');
    await page.waitForTimeout(200);
  }

  // 6. open reader by tapping a row
  await openRow(page, sid0);
  await page.waitForSelector('#app[data-view="read"]');
  const rt = await page.textContent('#rt-num');
  R.check(`[${label}] reader opens h3081`, rt.includes('3081'), rt);

  // 7. compare modes
  await page.click('#mode button[data-v="one"]');
  await page.waitForTimeout(250);
  let shown = await page.locator('#rd .cm:not([hidden])').count();
  R.check(`[${label}] compare One shows exactly one commentary`, shown === 1 && (await page.getAttribute('#rd', 'data-mode')) === 'one', shown);
  await page.click('#mode button[data-v="stack"]');
  await page.waitForTimeout(250);
  shown = await page.locator('#rd .cm:not([hidden])').count();
  R.check(`[${label}] compare Stacked shows three commentaries`, shown === 3, shown);
  if (wide) {
    await page.click('#mode button[data-v="side"]');
    await page.waitForTimeout(300);
    const mode = await page.getAttribute('#rd', 'data-mode');
    const xs = await page.evaluate(() => [...document.querySelectorAll('#rd .cm')].filter((c) => !c.hidden).map((c) => { const r = c.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width)]; }));
    // CSS: 3 columns when the reader is >= 1200px wide, otherwise 2 columns with the third spanning the row.
    const readerW = await page.evaluate(() => document.getElementById('reader').clientWidth);
    const expectThree = readerW >= 1200;
    const sideBySide = xs.length === 3 && xs[0][1] === xs[1][1] && Math.abs(xs[1][0] - xs[0][0]) > 100 &&
      (expectThree ? xs[2][1] === xs[0][1] : xs[2][1] > xs[0][1] && xs[2][2] > xs[0][2]); // RTL: first column is on the right
    R.check(`[${label}] compare Side by side lays commentaries out as ${expectThree ? '3 columns' : '2 + 1 (reader ' + readerW + 'px)'}`, mode === 'side' && sideBySide, JSON.stringify(xs));
    const ov = await overflow(page);
    R.check(`[${label}] no horizontal overflow in side-by-side`, ov.sw <= ov.iw, JSON.stringify(ov));
  } else {
    const sideHidden = await page.evaluate(() => document.getElementById('mode-side').hidden);
    R.check(`[${label}] Side by side is hidden on a phone-width reader`, sideHidden);
    await page.click('#mode button[data-v="stack"]');
  }

  // 8. expand / collapse in Stacked
  await page.click('#mode button[data-v="stack"]');
  const firstCm = page.locator('#rd .cm').first();
  const key = await firstCm.getAttribute('data-key');
  await firstCm.locator('.cm-t').click();
  await page.waitForTimeout(500);
  const closed = await firstCm.getAttribute('data-open');
  await firstCm.locator('.cm-t').click();
  await page.waitForTimeout(500);
  const reopened = await firstCm.getAttribute('data-open');
  R.check(`[${label}] collapse/expand commentary (${key})`, closed === 'false' && reopened === 'true', `closed=${closed} reopened=${reopened}`);

  // 9. footnotes: use a section that has them
  const fnInfo = footnoteSection();
  await page.evaluate((id) => { location.hash = id; }, fnInfo.s.id);
  await page.waitForFunction((id) => location.hash === '#' + id, fnInfo.s.id);
  await page.waitForTimeout(400);
  await page.click('#mode button[data-v="stack"]');
  await page.waitForTimeout(200);
  const pressed = await page.getAttribute('#fn-toggle', 'aria-pressed');
  const fnVisible = () => page.evaluate(() => { const s = document.querySelector('#rd sup.fn'); if (!s) return null; return getComputedStyle(s).display !== 'none'; });
  R.check(`[${label}] footnotes shown by default`, pressed === 'true' && (await fnVisible()) === true);
  await page.click('#fn-toggle');
  await page.waitForTimeout(200);
  R.check(`[${label}] footnotes hidden after toggle`, (await page.getAttribute('#fn-toggle', 'aria-pressed')) === 'false' && (await fnVisible()) === false);
  await page.click('#fn-toggle');
  await page.waitForTimeout(200);
  R.check(`[${label}] footnotes shown again`, (await fnVisible()) === true);
  // footnote jump and back-reference
  const ref = page.locator('#rd sup.fn a').first();
  const refId = await ref.getAttribute('href');
  await ref.click();
  await page.waitForTimeout(900);
  const target = await inView(page, '[id="' + refId.slice(1) + '"]');
  R.check(`[${label}] footnote jump lands on the note`, target.found && target.inView, JSON.stringify(target));
  // the back arrow inside the footnote
  const back = page.locator('#rd aside.notes li a.fnback').first();
  const backHref = await back.getAttribute('href');
  await back.click();
  await page.waitForTimeout(900);
  const backT = await inView(page, '[id="' + backHref.slice(1) + '"]');
  R.check(`[${label}] footnote back-reference returns to the text`, backT.found && backT.inView, JSON.stringify(backT));

  // 10. Arabic text size
  const sizeOf = () => page.evaluate(() => document.documentElement.style.getPropertyValue('--ar-size'));
  const s0 = await sizeOf();
  await page.click('#sz-up');
  const s1 = await sizeOf();
  await page.click('#sz-down'); await page.click('#sz-down');
  const s2 = await sizeOf();
  R.check(`[${label}] Arabic text size A+ / A−`, s0 !== s1 && s2 !== s1, `${s0} → ${s1} → ${s2}`);
  await page.click('#sz-up');

  // 11. settings: theme
  if (!wide) { await gotoHome(page); }
  await page.click('#settings');
  await page.waitForSelector('#dlg-settings[open]');
  const bgLum = () => page.evaluate(() => { const c = getComputedStyle(document.body).backgroundColor.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number); return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255; });
  await page.click('#theme button[data-v="dark"]');
  await page.waitForTimeout(200);
  const dk = await page.evaluate(() => document.documentElement.dataset.theme);
  const dkLum = await bgLum();
  R.check(`[${label}] theme Dark applies data-theme=dark and dark background`, dk === 'dark' && dkLum < 0.3, `theme=${dk} lum=${dkLum.toFixed(2)}`);
  await page.click('#theme button[data-v="light"]');
  await page.waitForTimeout(200);
  const ltLum = await bgLum();
  R.check(`[${label}] theme Light applies light background`, (await page.evaluate(() => document.documentElement.dataset.theme)) === 'light' && ltLum > 0.8, `lum=${ltLum.toFixed(2)}`);
  await page.click('#theme button[data-v="system"]');
  await page.waitForTimeout(200);
  R.check(`[${label}] theme System removes the forced theme`, (await page.evaluate(() => document.documentElement.dataset.theme)) === undefined);
  await page.click('#theme button[data-v="dark"]');
  await page.waitForTimeout(150);

  // 12. notes: type, reload offline, still there
  await page.click('#dlg-settings button[value="close"]');
  await page.evaluate((id) => { location.hash = id; }, sid0);
  await page.waitForSelector('#note-' + sid0);
  await page.fill('#note-' + sid0, 'Persisted note alpha');
  await page.waitForFunction((id) => /Saved|Saving/.test(document.querySelector('.note-st').textContent) && !/Saving/.test(document.querySelector('.note-st').textContent), sid0, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(800);
  // star
  await page.click('#star-r');
  await page.waitForTimeout(150);
  R.check(`[${label}] star toggles to saved`, (await page.getAttribute('#star-r', 'aria-pressed')) === 'true');
  await page.reload();
  await waitReady(page);
  await page.evaluate((id) => { location.hash = id; }, sid0);
  await page.waitForSelector('#note-' + sid0);
  R.check(`[${label}] note survives offline reload`, (await page.inputValue('#note-' + sid0)) === 'Persisted note alpha');
  R.check(`[${label}] star survives offline reload`, (await page.getAttribute('#star-r', 'aria-pressed')) === 'true');
  R.check(`[${label}] note marker shows on the list row`, (await page.locator(`#row-${sid0} .mk`).count()) === 1);

  // 13. backup export and import
  if (!wide) { await gotoHome(page); }
  await page.click('#settings');
  await page.waitForSelector('#dlg-settings[open]');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }).catch(() => null), page.click('#notes-export')]);
  R.check(`[${label}] export backup triggers a download`, !!dl);
  let exported = null;
  if (dl) {
    const file = path.join(TMP, 'backup.json');
    await dl.saveAs(file);
    exported = JSON.parse(fs.readFileSync(file, 'utf8'));
    R.check(`[${label}] backup contains the note and the star`, !!(exported.notes && exported.notes['mishkat-' + sid0] && exported.notes['mishkat-' + sid0].text === 'Persisted note alpha') && exported.stars.includes(sid0), Object.keys(exported.notes || {}).join(','));
    await page.setInputFiles('#notes-file', file);
    await page.waitForTimeout(500);
    const toast = await page.textContent('#toast-t');
    R.check(`[${label}] importing the backup back is accepted`, /Restored|Everything was already up to date/.test(toast), toast);
  }
  await page.click('#dlg-settings button[value="close"]');

  // 14. keyboard: "/" focuses search, Escape clears, Tab shows focus
  if (!wide) { await gotoHome(page); }
  await page.locator('body').click({ position: { x: 2, y: 2 } }).catch(() => {});
  await page.keyboard.press('/');
  const focused = await page.evaluate(() => document.activeElement && document.activeElement.id);
  R.check(`[${label}] "/" focuses the search box`, focused === 'q', focused);
  await page.keyboard.type('3085');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const cleared = await page.inputValue('#q');
  R.check(`[${label}] Escape clears the search`, cleared === '', `value="${cleared}"`);
  await page.keyboard.press('Tab');
  const ring = [];
  for (let i = 0; i < 10; i++) {
    const info = await page.evaluate(() => {
      const a = document.activeElement; if (!a || a === document.body) return null;
      const cs = getComputedStyle(a);
      return { tag: a.tagName, id: a.id || a.className || a.textContent.trim().slice(0, 20), outline: cs.outlineStyle + ' ' + cs.outlineWidth, shadow: cs.boxShadow };
    });
    if (info) ring.push(info);
    await page.keyboard.press('Tab');
  }
  const ringOk = ring.length > 0 && ring.every((x) => /(solid|dashed|dotted|double|groove|ridge|inset|outset)/.test(x.outline) || (x.shadow && x.shadow !== 'none'));
  R.check(`[${label}] Tab reaches controls, each with a visible focus ring`, ring.length >= 5 && ringOk, ring.map((x) => `${x.id}:${x.outline}`).join(' | '));

  // 15. no horizontal scroll on home and reader
  const home = await overflow(page);
  R.check(`[${label}] no horizontal scroll on the list`, home.sw <= home.iw, JSON.stringify(home));
  await page.evaluate((id) => { location.hash = id; }, sid0);
  await page.waitForSelector('#app[data-view="read"]');
  const rdov = await overflow(page);
  R.check(`[${label}] no horizontal scroll in the reader`, rdov.sw <= rdov.iw, JSON.stringify(rdov));

  // 16. deep links loaded directly while offline
  const dl2 = await ctx.newPage();
  const log2 = watch(dl2);
  const deep = async (hash, check, name) => {
    await dl2.goto(srv.base + '/mishkat/' + hash);
    await waitReady(dl2);
    await dl2.waitForTimeout(900);
    const r = await check();
    R.check(`[${label}] deep link ${name} offline`, r.ok, r.detail);
  };
  await deep('#h3081', async () => {
    const t = await dl2.textContent('#rt-num');
    return { ok: t.includes('3081'), detail: t };
  }, '#h3081');
  await deep('#intro', async () => {
    const t = await dl2.textContent('#rt-num');
    return { ok: /Opening/.test(t), detail: t };
  }, '#intro');
  const fnHash = '#' + fnInfo.fn.id;
  await deep(fnHash, async () => {
    const r = await inView(dl2, '[id="' + fnInfo.fn.id + '"]');
    return { ok: r.found && r.inView, detail: fnHash + ' ' + JSON.stringify(r) };
  }, fnHash);
  await dl2.close();
  log.consoleErrors.push(...log2.consoleErrors.map((x) => '[deeplink] ' + x));
  log.pageErrors.push(...log2.pageErrors.map((x) => '[deeplink] ' + x));
  log.failed.push(...log2.failed.map((x) => '[deeplink] ' + x));
  log.external.push(...log2.external.map((x) => '[deeplink] ' + x));
  log.http.push(...log2.http.map((x) => '[deeplink] ' + x));

  // error budget for the whole flow in this viewport
  R.check(`[${label}] zero failed requests`, log.failed.length === 0, log.failed.slice(0, 5).join(' ; '));
  R.check(`[${label}] zero non-local requests`, log.external.length === 0, log.external.slice(0, 5).join(' ; '));
  R.check(`[${label}] zero HTTP error responses`, log.http.length === 0, log.http.slice(0, 5).join(' ; '));
  R.check(`[${label}] zero console errors`, log.consoleErrors.length === 0, log.consoleErrors.slice(0, 5).join(' ; '));
  R.check(`[${label}] zero page errors`, log.pageErrors.length === 0, log.pageErrors.slice(0, 5).join(' ; '));
  await ctx.close();
}

async function overflow360(browser, srv, R) {
  console.log('\n== 360x740 overflow pass ==');
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const page = await ctx.newPage();
  const log = watch(page);
  await page.goto(srv.base + '/mishkat/');
  await waitReady(page);
  const home = await overflow(page);
  R.check('[360] no horizontal scroll on the list', home.sw <= home.iw, JSON.stringify(home));
  await openRow(page, SECTIONS.find((s) => s.n === 3081).id);
  await page.waitForSelector('#app[data-view="read"]');
  await page.waitForTimeout(500);
  const rd = await overflow(page);
  R.check('[360] no horizontal scroll in the reader', rd.sw <= rd.iw, JSON.stringify(rd));
  R.check('[360] zero console/page errors', log.consoleErrors.length + log.pageErrors.length === 0, [...log.consoleErrors, ...log.pageErrors].join(' ; '));
  await ctx.close();
}

(async () => {
  const R = makeReporter('e2e_offline');
  const srv = await serve(REPO);
  const browser = await chromium.launch();
  try {
    await run(browser, srv, { w: 390, h: 844, label: 'phone' }, R);
    await run(browser, srv, { w: 1376, h: 1032, label: 'iPad 13 landscape' }, R);
    await overflow360(browser, srv, R);
  } catch (e) {
    R.check('script ran to completion', false, e.stack.split('\n').slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    srv.close();
  }
  const ok = R.summary();
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
})();
