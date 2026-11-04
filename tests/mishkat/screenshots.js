// Screenshots of the Mishkāt reader for the report, plus one labelled contact sheet per theme.
// Usage: node tests/mishkat/screenshots.js [OUT_DIR]   (default: <tmpdir>/mishkat-report)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { REPO, serve, waitReady } = require('./_common');

const OUT = process.argv[2] || path.join(os.tmpdir(), 'mishkat-report');
fs.mkdirSync(OUT, { recursive: true });

const DEVICES = [
  { name: 'phone-390x844', w: 390, h: 844 },
  { name: 'ipad11-834x1194', w: 834, h: 1194 },
  { name: 'ipad13-portrait-1032x1376', w: 1032, h: 1376 },
  { name: 'ipad13-landscape-1376x1032', w: 1376, h: 1032 },
  { name: 'desktop-1440x900', w: 1440, h: 900 }
];
const THEMES = ['light', 'dark'];
const SID = 'h3081';

async function newPage(browser, vp, theme) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 2 });
  await ctx.addInitScript((t) => { try { localStorage.setItem('mishkat-theme', JSON.stringify(t)); } catch (e) {} }, theme);
  const page = await ctx.newPage();
  return { ctx, page };
}

async function settle(page, ms = 1500) { await page.waitForTimeout(ms); }

async function shot(page, name) {
  const file = path.join(OUT, name + '.png');
  await page.screenshot({ path: file, animations: 'allow' });
  console.log('wrote', file);
  return file;
}

async function main() {
  const srv = await serve(REPO);
  const browser = await chromium.launch();
  const files = [];
  try {
    for (const vp of DEVICES) {
      for (const theme of THEMES) {
        const { ctx, page } = await newPage(browser, vp, theme);
        await page.goto(srv.base + '/mishkat/');
        await waitReady(page);
        await settle(page);
        files.push(await shot(page, `${vp.name}-home-${theme}`));
        await page.goto(srv.base + '/mishkat/#' + SID);
        await page.waitForSelector('#app[data-view="read"]');
        await settle(page);
        files.push(await shot(page, `${vp.name}-reader-${theme}`));
        await ctx.close();
      }
    }

    // compare "One" on phone (light)
    {
      const { ctx, page } = await newPage(browser, DEVICES[0], 'light');
      await page.goto(srv.base + '/mishkat/#' + SID);
      await page.waitForSelector('#app[data-view="read"]');
      await page.click('#mode button[data-v="one"]');
      await settle(page, 900);
      files.push(await shot(page, 'phone-compare-one-light'));
      await ctx.close();
    }
    // side by side at 1376 landscape (both themes)
    for (const theme of THEMES) {
      const { ctx, page } = await newPage(browser, DEVICES[3], theme);
      await page.goto(srv.base + '/mishkat/#' + SID);
      await page.waitForSelector('#app[data-view="read"]');
      await page.click('#mode button[data-v="side"]');
      await settle(page, 1000);
      files.push(await shot(page, `ipad13-landscape-side-by-side-${theme}`));
      await ctx.close();
    }
    // search results on phone (light)
    {
      const { ctx, page } = await newPage(browser, DEVICES[0], 'light');
      await page.goto(srv.base + '/mishkat/');
      await waitReady(page);
      await page.fill('#q', 'النكاح');
      await settle(page, 700);
      files.push(await shot(page, 'phone-search-results-light'));
      await ctx.close();
    }
    // settings sheet and What's new on phone (light)
    {
      const { ctx, page } = await newPage(browser, DEVICES[0], 'light');
      await page.goto(srv.base + '/mishkat/');
      await waitReady(page);
      await page.click('#settings');
      await page.waitForSelector('#dlg-settings[open]');
      await settle(page, 800);
      files.push(await shot(page, 'phone-settings-sheet-light'));
      await page.click('#open-wn');
      await page.waitForSelector('#dlg-wn[open]');
      await settle(page, 800);
      files.push(await shot(page, 'phone-whats-new-light'));
      await ctx.close();
    }
  } finally {
    await browser.close();
    srv.close();
  }

  // contact sheets: one per theme, labelled thumbnails of the matching screenshots
  for (const theme of THEMES) {
    const items = files.filter((f) => f.endsWith(`-${theme}.png`));
    const html = `<!doctype html><meta charset="utf-8"><title>contact ${theme}</title>
<style>
 body{margin:0;padding:18px;font:14px/1.3 system-ui,sans-serif;background:${theme === 'dark' ? '#222' : '#eee'};color:${theme === 'dark' ? '#eee' : '#111'};width:max-content}
 h1{font-size:18px;margin:0 0 12px}
 .grid{display:grid;grid-template-columns:repeat(4,300px);gap:14px}
 figure{margin:0;background:${theme === 'dark' ? '#333' : '#fff'};padding:8px;border-radius:6px}
 figure img{display:block;width:284px;height:auto;max-height:300px;object-fit:contain;object-position:top;border:1px solid #8886}
 figcaption{margin-top:6px;word-break:break-all;font-size:12px}
</style>
<h1>Mishkāt screenshots · ${theme} theme</h1>
<div class="grid">${items.map((f) => `<figure><img src="file://${f}"><figcaption>${path.basename(f, '.png')}</figcaption></figure>`).join('')}</div>`;
    const htmlFile = path.join(OUT, `_contact-${theme}.html`);
    fs.writeFileSync(htmlFile, html);
    const b2 = await chromium.launch();
    const p2 = await b2.newPage({ viewport: { width: 1300, height: 800 }, deviceScaleFactor: 1 });
    await p2.goto('file://' + htmlFile);
    await p2.waitForTimeout(800);
    const out = path.join(OUT, `contact-sheet-${theme}.png`);
    await p2.screenshot({ path: out, fullPage: true });
    await b2.close();
    console.log('wrote', out);
  }
  console.log(`\n${files.length} screenshots in ${OUT}`);
}

main().catch((e) => { console.error('FATAL', e.stack); process.exit(1); });
