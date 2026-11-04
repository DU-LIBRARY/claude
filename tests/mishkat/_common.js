// Shared helpers for the Mishkāt Playwright tests (Node, standard library + playwright).
'use strict';
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');
const CHROME = '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';

function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.unref();
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
  });
}

// Serve a directory with python3 -m http.server on a free port. Resolves once it answers.
async function serve(root) {
  const port = await freePort();
  const proc = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (d) => { stderr += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    const ok = await new Promise((res) => {
      const r = http.get(base + '/', (resp) => { resp.resume(); res(resp.statusCode < 500); });
      r.on('error', () => res(false));
      r.setTimeout(500, () => { r.destroy(); res(false); });
    });
    if (ok) return { base, port, close: () => proc.kill('SIGTERM'), stderr: () => stderr };
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill('SIGTERM');
  throw new Error('http.server did not start: ' + stderr);
}

// Collects failures for a page: failed requests, non-local hosts, HTTP errors, console errors, page errors.
function watch(page) {
  const log = { failed: [], external: [], http: [], consoleErrors: [], pageErrors: [] };
  const local = (u) => { try { const h = new URL(u).hostname; return h === '127.0.0.1' || h === 'localhost' || u.startsWith('data:') || u.startsWith('blob:'); } catch (e) { return true; } };
  page.on('request', (r) => { if (!local(r.url())) log.external.push(r.url()); });
  page.on('requestfailed', (r) => { if (r.url().startsWith('data:')) return; log.failed.push(`${r.method()} ${r.url()} ${r.failure() && r.failure().errorText}`); });
  page.on('response', (r) => { if (r.status() >= 400) log.http.push(`${r.status()} ${r.url()}`); });
  page.on('console', (m) => { if (m.type() === 'error') log.consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => log.pageErrors.push(String(e && e.message || e)));
  return log;
}

// Pretty result collector used by every script.
function makeReporter(name) {
  const results = [];
  return {
    results,
    check(label, ok, detail) {
      results.push({ label, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
      console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail !== undefined && detail !== '' ? ' — ' + detail : ''}`);
      return !!ok;
    },
    summary() {
      const fails = results.filter((r) => !r.ok);
      console.log(`\n${name}: ${results.length - fails.length}/${results.length} checks passed`);
      return fails.length === 0;
    }
  };
}

async function waitReady(page, timeout = 30000) {
  await page.waitForFunction(() => {
    const s = document.getElementById('status');
    return s && s.dataset.ready === '1';
  }, null, { timeout });
}

module.exports = { REPO, CHROME, serve, watch, makeReporter, waitReady, freePort };
