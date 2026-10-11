const fs = require('node:fs');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { JSDOM } = require('jsdom');
const JSZip = require('jszip');
const root = require('node:path').resolve(__dirname, '..') + require('node:path').sep;
const src = fs.readFileSync(root + 'index.html', 'utf8');
const inline = [...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lp8AAAAASUVORK5CYII=';
function page(mode = 'direct') {
  const dom = new JSDOM(src, { url: 'https://cart-to-excel.vercel.app', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const requests = [];
  let auth;
  w.Blob = Blob;
  // Adapt JSDOM typed arrays to the Node JSZip realm; workbook code stays unchanged.
  w.JSZip = { loadAsync: data => JSZip.loadAsync(Buffer.from(data)).then(zip => {
    const file = zip.file.bind(zip);
    zip.file = function(name, value, options) {
      if (arguments.length === 1) return file(name);
      return file(name, ArrayBuffer.isView(value) ? Buffer.from(value) : value, options);
    };
    return zip;
  }) };
  w.alert = message => { throw new Error(message); };
  Object.defineProperty(w, 'crypto', { value: webcrypto });
  w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (target, name) => name === 'getImageData' ? (() => ({ data: new Uint8ClampedArray(4) })) : (() => {}) });
  w.HTMLCanvasElement.prototype.toDataURL = () => png;
  w.Element.prototype.scrollIntoView = () => {};
  w.ORDER_FORM_DRIVE_CONFIG = mode === 'legacy' ? {} : { clientId: 'client', apiKey: mode === 'partial' ? '' : 'key', projectNumber: mode === 'partial' ? '' : '123', folderId: '1EC0L0S0kHn8UAIEY-nukXsTujPfX2ImG', folderName: 'Order Form' };
  w.google = { accounts: { oauth2: {
    hasGrantedAllScopes: () => true,
    initTokenClient(config) { return { requestAccessToken() { auth = () => config.callback({ access_token: 'test-token', expires_in: 3600 }); } }; }
  } } };
  w.gapi = { load(name, config) { config.callback(); } };
  w.fetch = async (url, options = {}) => {
    requests.push({ url, ...options });
    return { ok: true, status: 200, json: async () => options.method === 'POST'
      ? { id: 'test-file', name: '20261011 Wheel leg order form.xlsx', parents: [w.ORDER_FORM_DRIVE_CONFIG.folderId], webViewLink: 'https://docs.google.com/spreadsheets/d/test-file/edit', owners: [{ displayName: 'Test Student', me: true }] }
      : { id: w.ORDER_FORM_DRIVE_CONFIG.folderId, name: 'Order Form', mimeType: 'application/vnd.google-apps.folder', capabilities: { canAddChildren: true } }
    };
  };
  w.eval(fs.readFileSync(root + 'drive-upload.js', 'utf8'));
  w.eval(inline.join('\n') + `\nwindow.seedItems = function() { items = [{id:1,name:'Brushless Motor',spec:'1106',price:25,quantity:2,category:'Others',location:'Online',link:'https://item.taobao.com/item.htm?id=123'}]; signatureDataUrl = '${png}'; signatureAspect = 4; renderEditor(); }; window.changeWhileAuthorizing = function() { items[0].quantity = 99; signatureDataUrl = null; };`);
  const competition = w.document.getElementById('input-competition');
  const student = w.document.getElementById('input-student');
  competition.value = 'Wheel leg';
  student.value = 'Test Student';
  w.seedItems();
  return { dom, w, requests, authorize: () => auth() };
}
async function tick() { await new Promise(resolve => setTimeout(resolve, 0)); }
(async () => {
  const h = page();
  for (let i = 0; i < 3; i++) await tick();
  assert.equal(h.w.document.getElementById('btn-drive').disabled, false);
  h.w.document.getElementById('btn-drive').click();
  assert.equal(h.w.document.getElementById('btn-drive').disabled, true);
  assert.equal(h.requests.length, 0);
  h.w.document.getElementById('input-competition').value = 'Changed while signing in';
  h.w.document.getElementById('input-student').value = 'Changed student';
  h.w.changeWhileAuthorizing();
  h.authorize();
  for (let i = 0; i < 200 && !h.w.driveLinkUrl && h.w.driveBusy; i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(h.requests.length, 2, h.w.document.getElementById('drive-status').textContent);
  assert.equal(h.w.driveBusy, false);
  assert.match(h.w.document.getElementById('drive-status').textContent, /Owner: Test Student \(your Google account\)/);
  const body = Buffer.from(await h.requests[1].body.arrayBuffer());
  const start = body.indexOf(Buffer.from([80, 75, 3, 4]));
  const end = body.lastIndexOf(Buffer.from('\r\n--order_form_'));
  const zip = await JSZip.loadAsync(body.subarray(start, end));
  const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
  assert.match(sheet, /<c r="C3"[^>]*><is><t>Wheel leg<\/t><\/is><\/c>/);
  assert.match(sheet, /<c r="H66"[^>]*><is><t>Test Student<\/t><\/is><\/c>/);
  assert.match(sheet, /<c r="F11"[^>]*><v>2<\/v><\/c>/);
  assert.match(sheet, /<c r="H11"[^>]*><v>50<\/v><\/c>/);
  assert.ok(zip.file('xl/media/image3.png'));
  const signature = await zip.file('xl/drawings/drawing1.xml').async('string');
  assert.match(signature, /signature.png/);
  assert.match(signature, /<xdr:row>69<\/xdr:row>/);
  const today = new Date();
  const stamp = today.getFullYear() + String(today.getMonth() + 1).padStart(2, '0') + String(today.getDate()).padStart(2, '0');
  assert.ok(body.includes(Buffer.from('"name":"' + stamp + ' Wheel leg order form.xlsx"')));
  assert.equal(h.w.document.getElementById('btn-export').disabled, true); // edited away the required signature
  h.dom.window.close();
  const legacy = page('legacy');
  assert.equal(legacy.w.directDrive, null);
  assert.equal(legacy.w.document.getElementById('btn-drive').disabled, false);
  assert.equal(legacy.w.document.getElementById('btn-drive-account'), null);
  legacy.dom.window.close();
  const partial = page('partial');
  assert.equal(partial.w.document.getElementById('btn-drive').disabled, true);
  assert.equal(partial.w.document.getElementById('btn-export').disabled, false);
  assert.match(partial.w.document.getElementById('drive-status').textContent, /setup is incomplete/);
  partial.dom.window.close();
  console.log('PASS: real xlsx multipart roundtrip, signature, auth-wait snapshot, success/owner UI, legacy fallback, incomplete config');
})().catch(error => { console.error(error); process.exitCode = 1; });
