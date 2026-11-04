const { chromium } = require('playwright');
const { REPO, serve, waitReady } = require('./_common');
(async () => {
  const srv = await serve(REPO);
  const browser = await chromium.launch();
  for (const url of ['/mishkat/', '/mishkat/#h3081']) {
    const ctx = await browser.newContext({ viewport: { width: 1376, height: 1032 } });
    const page = await ctx.newPage();
    const reqs = [];
    const errs = [];
    page.on('request', (r) => reqs.push(r.url()));
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto(srv.base + url);
    await waitReady(page, 20000).catch(() => {});
    await page.waitForTimeout(3000);
    const ext = reqs.filter((u) => !/^https?:\/\/(127\.0\.0\.1|localhost)/.test(u) && !u.startsWith('data:') && !u.startsWith('blob:'));
    console.log(url, 'requests', reqs.length, 'external', JSON.stringify(ext), 'console', JSON.stringify(errs));
    await ctx.close();
  }
  await browser.close(); srv.close();
})().catch((e) => { console.error('FATAL', e.message.split('\n')[0]); process.exit(1); });
