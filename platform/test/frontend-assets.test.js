import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../server.js';
import { Store } from '../lib/store.js';

test('same-origin server serves the React build with CSP and rejects private/source paths', async () => {
  const store = new Store(':memory:');
  const app = await createApplication({ demo: true, store, autoSync: false });
  const { port } = await app.start(0);
  const base = `http://127.0.0.1:${port}`;
  try {
    const page = await fetch(base + '/');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /^text\/html/);
    assert.match(page.headers.get('content-security-policy'), /script-src 'self' https:\/\/accounts.google.com\/gsi\/client/);
    const html = await page.text();
    assert.match(html, /id="root"/);
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^" ]+\.(?:js|css))"/g)].map(match => match[1]);
    assert.ok(assets.some(asset => asset.endsWith('.js')));
    assert.ok(assets.some(asset => asset.endsWith('.css')));
    for (const asset of assets) {
      const response = await fetch(base + asset);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), asset.endsWith('.js') ? /^text\/javascript/ : /^text\/css/);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    }
    for (const url of ['/.env', '/src/App.jsx', '/assets/%2e%2e%2f.env', '/assets/missing.js', '/app.js', '/style.css']) {
      assert.equal((await fetch(base + url)).status, 404, url);
    }
  } finally { await app.close(); store.close(); }
});
