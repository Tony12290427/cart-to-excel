const { test } = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { createClient, SCOPE, fileReference } = require('../drive-upload.js');
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SHEET = 'application/vnd.google-apps.spreadsheet';
const config = { clientId: 'client', apiKey: 'key', projectNumber: '123', folderId: 'team-folder', folderName: 'Order Form' };

async function harness(options = {}) {
  const requests = [], settings = {}, revision = () => ({ version: '7', modifiedTime: '2026-10-23T00:00:00Z' });
  let reads = 0;
  class DocsView {
    constructor(id) { settings.views = (settings.views || []).concat(id); }
    setMimeTypes(types) { settings.types = types; return this; }
    setIncludeFolders() { return this; } setSelectFolderEnabled() { return this; }
    setParent(id) { settings.parent = id; return this; }
  }
  class PickerBuilder {
    setDeveloperKey() { return this; } setAppId() { return this; }
    setOAuthToken() { return this; } setTitle() { return this; }
    setOrigin(origin) { settings.origin = origin; return this; }
    addView() { return this; } setCallback(callback) { this.callback = callback; return this; }
    build() { const callback = this.callback; return { setVisible(visible) { if (visible) queueMicrotask(() => callback(options.cancel ? { action: 'cancel' } : { action: 'picked', docs: [{ id: 'order-file', resourceKey: 'resource-key' }] })); } }; }
  }
  const metadata = () => ({ id: 'order-file', name: 'Existing order form.xlsx', mimeType: options.native ? SHEET : XLSX,
    ...revision(), capabilities: { canEdit: !options.readOnly, canDownload: true }, webViewLink: 'https://drive.google.com/file/d/order-file/view' });
  const env = { Blob, crypto: webcrypto, setTimeout, clearTimeout, location: { origin: 'https://cart-to-excel.vercel.app' },
    gapi: { load(name, handlers) { handlers.callback(); } },
    google: { accounts: { oauth2: {
      hasGrantedAllScopes(response, scope) { assert.equal(scope, SCOPE); return true; },
      initTokenClient(config) { return { requestAccessToken() { config.callback({ access_token: 'test-only-token', expires_in: 3600 }); } }; },
    } }, picker: { DocsView, PickerBuilder, ViewId: { DOCS: 'docs' }, Action: { PICKED: 'picked', CANCEL: 'cancel' } } },
    async fetch(url, request = {}) {
      requests.push({ url, ...request });
      assert.equal(request.headers.Authorization, 'Bearer test-only-token');
      if (request.method === 'PATCH') {
        if (options.lostResponse) throw new Error('response lost');
        if (options.precondition) return new Response(JSON.stringify({ error: {} }), { status: 412 });
        return new Response(JSON.stringify({ ...metadata(), version: '8', modifiedTime: '2026-10-23T00:01:00Z' }), { status: 200 });
      }
      if (url.includes('alt=media') || url.includes('/export?')) {
        if (options.largeFile) return new Response(new Uint8Array(1), { headers: { 'Content-Length': 6 * 1024 * 1024 } });
        if (options.largeStream) return new Response(new Uint8Array(5 * 1024 * 1024 + 1));
        return new Response(new Uint8Array([80, 75, 3, 4]));
      }
      reads++;
      const value = metadata();
      if (options.changeDuringRead && reads === 2 || options.changeBeforeSave && reads >= 3) value.version = '9';
      if (options.unreadable) value.capabilities.canDownload = false;
      if (options.wrongType) value.mimeType = 'application/pdf';
      return new Response(JSON.stringify(value), { headers: { ETag: '"revision-7"' } });
    },
  };
  const client = createClient(config, env); await client.ready(); await client.authorize();
  return { client, requests, settings };
}

for (const native of [false, true]) test(`Picker reads selected ${native ? 'Google Sheet' : 'XLSX'} with drive.file and preserves its source version`, async () => {
  const h = await harness({ native }); const result = await h.client.importFile();
  assert.equal(result.source.id, 'order-file'); assert.equal(result.source.version, '7');
  assert.deepEqual([...new Uint8Array(result.bytes)], [80, 75, 3, 4]);
  assert.equal(h.settings.parent, 'team-folder');
  assert.match(h.settings.types, /spreadsheetml.sheet/);
  assert.match(h.requests[1].url, native ? /\/export\?mimeType=/ : /alt=media/);
  assert.equal(h.requests[1].headers['X-Goog-Drive-Resource-Keys'], 'order-file/resource-key');
  assert.equal(h.requests.some(request => request.method), false);
});

test('link import reads only a validated Google file ID without opening Picker', async () => {
  assert.deepEqual(fileReference('https://docs.google.com/spreadsheets/d/order-file/edit?resourcekey=resource-key'),{id:'order-file',resourceKey:'resource-key'});
  for(const link of ['https://evil.example/file/d/order-file','https://drive.google.com.evil.example/file/d/order-file','http://drive.google.com/file/d/order-file','https://drive.google.com/drive/folders/team-folder'])assert.throws(()=>fileReference(link));
  const h=await harness();const result=await h.client.importFile(undefined,'https://drive.google.com/file/d/order-file/view');
  assert.equal(result.source.id,'order-file');assert.equal(h.settings.views,undefined);
  assert.equal(h.requests.some(request=>request.method),false);
});

for (const native of [false, true]) test(`update ${native ? 'native Sheet' : 'XLSX'} uses the same ID, no rename/move, and a conditional PATCH`, async () => {
  const h = await harness({ native }), source = (await h.client.importFile()).source;
  const result = await h.client.updateFile(source, new Blob(['fixture']));
  const patch = h.requests.find(request => request.method === 'PATCH');
  assert.match(patch.url, /upload\/drive\/v3\/files\/order-file\?/);
  assert.equal(patch.headers['If-Match'], '"revision-7"');
  const body = await patch.body.text();
  assert.ok(body.includes(JSON.stringify({ mimeType: native ? SHEET : XLSX })));
  assert.equal(body.includes('"parents"'), false); assert.equal(body.includes('"name"'), false);
  assert.equal(result.id, source.id); assert.equal(result.version, '8');
  assert.equal(h.requests.some(request => request.method === 'POST' || request.method === 'DELETE'), false);
});

for (const [options, code] of [[{ cancel: true }, 'picker_cancelled'], [{ changeDuringRead: true }, 'source_changed'],
  [{ unreadable: true }, 'file_permission'], [{ wrongType: true }, 'file_type'], [{ largeFile: true }, 'file_size'], [{ largeStream: true }, 'file_size']]) {
  test(`failed import preserves the caller's draft: ${JSON.stringify(options)}`, async () => {
    const h = await harness(options); await assert.rejects(h.client.importFile(), error => error.code === code);
    assert.equal(h.requests.some(request => request.method), false);
  });
}
for (const [options, code] of [[{ readOnly: true }, 'file_permission'], [{ changeBeforeSave: true }, 'source_changed'],
  [{ precondition: true }, 'source_changed'], [{ lostResponse: true }, 'save_uncertain']]) {
  test(`original update fails safely: ${JSON.stringify(options)}`, async () => {
    const h = await harness(options), source = (await h.client.importFile()).source;
    await assert.rejects(h.client.updateFile(source, new Blob(['fixture'])), error => error.code === code);
    assert.equal(h.requests.filter(request => request.method === 'PATCH').length, options.precondition || options.lostResponse ? 1 : 0);
  });
}
