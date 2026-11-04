const { chromium } = require('playwright');
const { REPO, serve, watch, waitReady } = require('./_common');
(async () => {
  const srv = await serve(REPO);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const log = watch(page);
  await page.goto(srv.base + '/mishkat/');
  await waitReady(page);
  // Repro A: list -> reader -> Next -> Back
  await page.click('#row-h3081 a.rowlink');
  await page.waitForTimeout(600);
  await page.click('#next');
  await page.waitForTimeout(600);
  console.log('A after next', await page.evaluate(() => location.hash), await page.getAttribute('#app', 'data-view'));
  await page.click('#back');
  await page.waitForTimeout(800);
  console.log('A after back', await page.evaluate(() => location.hash), await page.getAttribute('#app', 'data-view'));
  // Repro B: list -> reader -> Back (should be list)
  await page.click('#row-h3081 a.rowlink').catch((e) => console.log('B row click failed', e.message.split('\n')[0]));
  await page.waitForTimeout(600);
  await page.click('#back');
  await page.waitForTimeout(800);
  console.log('B after back', await page.evaluate(() => location.hash), await page.getAttribute('#app', 'data-view'));
  console.log('errors', JSON.stringify(log.pageErrors), JSON.stringify(log.consoleErrors));
  await browser.close(); srv.close();
})().catch((e) => { console.error('FATAL', e.message.split('\n')[0]); process.exit(1); });
