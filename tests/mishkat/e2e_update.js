// Update-path test: a changed artifact is synced into a copy of the repo, the installed PWA picks it up,
// reloads, purges the old cache, and a second sync is a no-op.
// Usage: node tests/mishkat/e2e_update.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { chromium } = require('playwright');
const { REPO, serve, watch, makeReporter, waitReady } = require('./_common');

// the fixture the current data was synced from (matched by sha256), so the test changes one word and nothing else
const FIXTURE = (() => {
  const dir = path.join(REPO, 'tests', 'mishkat', 'fixtures');
  const want = JSON.parse(fs.readFileSync(path.join(REPO, 'mishkat', 'data', 'meta.json'), 'utf8')).source.sha256;
  const hit = fs.readdirSync(dir).filter((f) => f.endsWith('.html'))
    .find((f) => require('crypto').createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex') === want);
  if (!hit) throw new Error('no fixture matches meta.source.sha256 ' + want);
  return path.join(dir, hit);
})();
const OLD_WORD = 'أَضَرَّ';
const NEW_WORD = 'أَشَدَّ';

function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name === '__pycache__') continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyTree(s, d); else fs.copyFileSync(s, d);
  }
}

function sync(args) {
  const r = spawnSync('python3', ['-I', ...args], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

async function main() {
  const R = makeReporter('e2e_update');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mishkat-update-'));
  const modified = path.join(root, 'modified-artifact.html');
  let srv = null, browser = null;
  try {
    // 1. a repo mirror: mishkat/, tools/, fixtures/
    copyTree(path.join(REPO, 'mishkat'), path.join(root, 'mishkat'));
    copyTree(path.join(REPO, 'tools'), path.join(root, 'tools'));
    copyTree(path.join(REPO, 'tests', 'mishkat', 'fixtures'), path.join(root, 'tests', 'mishkat', 'fixtures'));
    const swV0 = /const VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(root, 'mishkat', 'sw.js'), 'utf8'))[1];
    const meta0 = JSON.parse(fs.readFileSync(path.join(root, 'mishkat', 'data', 'meta.json'), 'utf8'));

    // 2. the modified artifact: one word changed inside h3085 only
    const html = fs.readFileSync(FIXTURE, 'utf8');
    const start = html.indexOf('<section class="h" id="h3085">');
    const end = html.indexOf('<section class="h" id="h3086">');
    const sec = html.slice(start, end);
    const count = sec.split(OLD_WORD).length - 1;
    R.check('fixture h3085 contains the word to change exactly once', count === 1, `count=${count}`);
    const changed = html.slice(0, start) + sec.replace(OLD_WORD, NEW_WORD) + html.slice(end);
    fs.writeFileSync(modified, changed);

    // 3. serve the mirror, load online, wait for offline readiness
    srv = await serve(root);
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const log = watch(page);
    await page.goto(srv.base + '/mishkat/');
    await waitReady(page);
    if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) { await page.reload(); await waitReady(page); }
    const keys0 = await page.evaluate(() => caches.keys());
    R.check(`v0 installed: ${swV0} cache present`, keys0.includes(swV0), JSON.stringify(keys0));

    // 4. sync the changed artifact into the mirror
    const s1 = sync([path.join(root, 'tools', 'sync_mishkat_from_artifact.py'), modified, '--root', root, '--version', 'test-2']);
    R.check('sync exits 0 on the changed artifact', s1.code === 0, s1.out.split('\n').slice(-4).join(' | '));
    R.check('sync output lists "changed: h3085"', /changed: h3085\b/.test(s1.out), s1.out.split('\n').filter((l) => /changed|added|removed/.test(l)).join(' | '));
    // python's http.server answers If-Modified-Since at one-second granularity; push the synced files' mtimes
    // forward so a sync landing in the same second as an earlier fetch is not answered with 304 Not Modified
    { const t = Date.now() / 1000 + 5; const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else fs.utimesSync(f, t, t); }); walk(path.join(root, 'mishkat')); }
    const swV1 = /const VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(root, 'mishkat', 'sw.js'), 'utf8'))[1];
    R.check('sw.js VERSION bumped', swV1 !== swV0 && /^mishkat-v\d+\.\d+\.\d+$/.test(swV1), `${swV0} -> ${swV1}`);
    const meta1 = JSON.parse(fs.readFileSync(path.join(root, 'mishkat', 'data', 'meta.json'), 'utf8'));
    R.check('meta rev incremented by 1', meta1.rev === meta0.rev + 1, `rev ${meta0.rev} -> ${meta1.rev}`);
    R.check('the data file contains the new word', fs.readFileSync(path.join(root, 'mishkat', 'data', 'nikah.json'), 'utf8').includes(NEW_WORD));

    // 5. reload online: the update prompt appears; Reload applies it
    await page.reload();
    await page.waitForFunction(() => { const t = document.getElementById('toast'); return t && !t.hidden && /New version available/.test(document.getElementById('toast-t').textContent); }, null, { timeout: 45000 })
      .then(() => R.check('"New version available" prompt appears', true))
      .catch(() => R.check('"New version available" prompt appears', false, 'toast did not show within 45s'));
    const btnText = await page.textContent('#toast-b').catch(() => '');
    R.check('prompt offers a Reload button', /Reload/.test(btnText), btnText);
    await Promise.all([
      page.waitForNavigation({ timeout: 45000 }).catch(() => null),
      page.click('#toast-b')
    ]);
    await waitReady(page, 45000).catch(() => {});
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 }).catch(() => {});
    const keys1 = await page.evaluate(() => caches.keys());
    R.check(`after update only ${swV1} cache remains`, keys1.length === 1 && keys1[0] === swV1, JSON.stringify(keys1));

    // 6. offline: the new word, rev 2, What's new lists h3085
    await ctx.setOffline(true);
    await page.reload();
    await waitReady(page);
    await page.evaluate(() => { location.hash = 'h3085'; });
    await page.waitForFunction(() => document.getElementById('matn-h3085') && document.getElementById('matn-h3085').textContent.length > 0, null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(300);
    const matn = await page.textContent('#matn-h3085').catch(() => '');
    R.check('offline: the changed word is shown in h3085', matn.includes(NEW_WORD) && !matn.includes(OLD_WORD), matn.slice(0, 120));
    const syncline = await page.textContent('#syncline');
    R.check('offline: sync line reports the new rev', new RegExp('rev ' + meta1.rev + '\\b').test(syncline), syncline.slice(0, 120));
    await page.click('#settings').catch(async () => {
      await page.evaluate(() => { history.replaceState(null, '', location.pathname); window.dispatchEvent(new HashChangeEvent('hashchange')); });
      await page.waitForSelector('#app[data-view="home"]');
      await page.click('#settings');
    });
    await page.waitForSelector('#dlg-settings[open]');
    await page.click('#open-wn');
    await page.waitForSelector('#dlg-wn[open]');
    const wn = await page.textContent('#wn-body');
    R.check("What's new lists h3085 as changed", /Changed \(\d+\)/.test(wn) && /3085/.test(wn), wn.replace(/\s+/g, ' ').slice(0, 160));
    await page.click('#dlg-wn button[value="close"]');
    await page.click('#dlg-settings button[value="close"]').catch(() => {});
    const keys2 = await page.evaluate(() => caches.keys());
    R.check('offline: caches contain only the new VERSION', keys2.length === 1 && keys2[0] === swV1, JSON.stringify(keys2));
    await ctx.setOffline(false);

    // 7. second sync is a no-op
    const before = fs.readFileSync(path.join(root, 'mishkat', 'sw.js'), 'utf8');
    const s2 = sync([path.join(root, 'tools', 'sync_mishkat_from_artifact.py'), modified, '--root', root, '--version', 'test-2']);
    const after = fs.readFileSync(path.join(root, 'mishkat', 'sw.js'), 'utf8');
    R.check('second sync prints "Nothing to update."', s2.code === 0 && /Nothing to update\./.test(s2.out), s2.out.trim().split('\n').slice(-2).join(' | '));
    R.check('second sync leaves VERSION unchanged', before === after && /const VERSION = '([^']+)'/.exec(after)[1] === swV1);

    R.check('zero page errors', log.pageErrors.length === 0, log.pageErrors.slice(0, 3).join(' ; '));
    R.check('zero console errors', log.consoleErrors.length === 0, log.consoleErrors.slice(0, 3).join(' ; '));
    R.check('zero external requests', log.external.length === 0, log.external.slice(0, 3).join(' ; '));
  } catch (e) {
    R.check('script ran to completion', false, e.stack.split('\n').slice(0, 3).join(' | '));
  } finally {
    if (browser) await browser.close();
    if (srv) srv.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
  return R.summary();
}

main().then((ok) => process.exit(ok ? 0 : 1));
