const { test } = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { createClient, SCOPE, isConfigured } = require('../drive-upload.js');

const config = { clientId: 'client.apps.googleusercontent.com', apiKey: 'picker-key', projectNumber: '123', folderId: 'team-folder', folderName: 'Order Form' };
const folder = { id: config.folderId, name: 'Order Form', mimeType: 'application/vnd.google-apps.folder', capabilities: { canAddChildren: true } };
const workbook = new Blob([new Uint8Array([80, 75, 3, 4, 0, 255])]);

function runtime(options = {}) {
  const requests = [];
  const prompts = [];
  const pickerSettings = {};
  let authConfig;
  let missingFolder = options.needsPicker;
  class DocsView {
    constructor(view) { pickerSettings.view = view; }
    setIncludeFolders(value) { pickerSettings.includeFolders = value; return this; }
    setSelectFolderEnabled(value) { pickerSettings.selectFolderEnabled = value; return this; }
  }
  class PickerBuilder {
    setDeveloperKey(value) { pickerSettings.apiKey = value; return this; }
    setAppId(value) { pickerSettings.appId = value; return this; }
    setOAuthToken(value) { pickerSettings.token = value; return this; }
    setOrigin(value) { pickerSettings.origin = value; return this; }
    setTitle(value) { pickerSettings.title = value; return this; }
    addView(value) { return this; }
    setCallback(value) { this.callback = value; return this; }
    build() {
      const callback = this.callback;
      return { setVisible(visible) {
        if (!visible) return;
        queueMicrotask(() => {
          missingFolder = false;
          callback(options.pickerCancelled ? { action: 'cancel' }
            : { action: 'picked', docs: [{ id: options.pickedFolder || config.folderId }] });
        });
      } };
    }
  }
  const env = {
    Blob, crypto: webcrypto, location: { origin: 'https://cart-to-excel.vercel.app' },
    setTimeout, clearTimeout,
    gapi: { load(name, handlers) { assert.equal(name, 'picker'); handlers.callback(); } },
    google: {
      accounts: { oauth2: {
        hasGrantedAllScopes(response, scope) { assert.equal(scope, SCOPE); return !options.scopeDenied; },
        initTokenClient(value) {
          authConfig = value;
          return { requestAccessToken(prompt) {
            prompts.push(prompt);
            if (options.authPopupError) value.error_callback({ type: options.authPopupError });
            else value.callback(options.authDenied ? { error: 'access_denied' }
              : { access_token: 'test-token-' + prompts.length, expires_in: 3600 });
          } };
        }
      } },
      picker: { DocsView, PickerBuilder, ViewId: { FOLDERS: 'folders' }, Action: { PICKED: 'picked', CANCEL: 'cancel' } }
    },
    async fetch(url, request = {}) {
      requests.push({ url, ...request });
      if (options.networkError) throw new Error('network error');
      let data;
      let status = 200;
      if (options.status) {
        status = options.status;
        data = { error: { errors: [{ reason: options.reason }] } };
      } else if (request.method === 'POST') {
        if (options.uploadNetworkError) throw new Error('response lost');
        data = { id: 'uploaded-file', name: '20261011 Team order form.xlsx', parents: [config.folderId], webViewLink: options.link || 'https://docs.google.com/spreadsheets/d/uploaded-file/edit', owners: [{ displayName: 'Submitter', me: true }] };
      } else if (missingFolder) {
        status = options.folderGrant403 ? 403 : 404;
        data = options.folderGrant403 ? { error: { errors: [{ reason: 'appNotAuthorizedToFile' }] } } : {};
      } else {
        data = options.folder || folder;
      }
      return { ok: status >= 200 && status < 300, status, async json() { return data; } };
    }
  };
  return { env, requests, prompts, pickerSettings, get authConfig() { return authConfig; } };
}

async function signedIn(options) {
  const harness = runtime(options);
  const client = createClient(config, harness.env);
  await client.ready();
  await client.authorize();
  return { ...harness, client };
}

test('only drive.file is requested and authentication starts in the button call', async () => {
  const h = runtime();
  const client = createClient(config, h.env);
  await client.ready();
  const auth = client.authorize();
  assert.equal(h.prompts.length, 1);
  await auth;
  assert.equal(h.authConfig.scope, SCOPE);
  assert.equal(h.authConfig.include_granted_scopes, false);
  assert.equal(h.authConfig.client_id, config.clientId);
  await client.authorize();
  assert.equal(h.prompts.length, 1);
  client.clearAccount();
  await client.authorize();
  assert.equal(h.prompts.length, 2);
});

test('multipart upload preserves workbook bytes, exact destination, filename and submitter', async () => {
  const h = await signedIn();
  const result = await h.client.upload(workbook, '20261011 Team order form.xlsx');
  assert.equal(result.ownedByMe, true);
  assert.equal(result.owner, 'Submitter');
  assert.equal(h.requests.length, 2);
  const upload = h.requests[1];
  assert.equal(upload.method, 'POST');
  assert.equal(upload.headers.Authorization, 'Bearer test-token-1');
  assert.match(upload.url, /uploadType=multipart/);
  const bytes = Buffer.from(await upload.body.arrayBuffer());
  assert.ok(bytes.includes(Buffer.from(await workbook.arrayBuffer())));
  assert.ok(bytes.includes(Buffer.from('"parents":["team-folder"]')));
  assert.ok(bytes.includes(Buffer.from('"name":"20261011 Team order form.xlsx"')));
  assert.equal(h.requests.filter(r => ['DELETE', 'PATCH'].includes(r.method)).length, 0);
});

test('first-time folder grant uses Google Picker and checks metadata again before uploading', async () => {
  const h = await signedIn({ needsPicker: true });
  await h.client.upload(workbook, '20261011 Team order form.xlsx');
  assert.equal(h.requests.length, 3);
  assert.equal(h.pickerSettings.selectFolderEnabled, true);
  assert.equal(h.pickerSettings.origin, h.env.location.origin);
  assert.equal(h.pickerSettings.appId, config.projectNumber);
});

test('Google also requesting a folder grant with 403 opens Picker before upload', async () => {
  const h = await signedIn({ needsPicker: true, folderGrant403: true });
  await h.client.upload(workbook, '20261011 Team order form.xlsx');
  assert.equal(h.requests.length, 3);
  assert.equal(h.pickerSettings.selectFolderEnabled, true);
});

for (const [title, options, code] of [
  ['wrong folder', { needsPicker: true, pickedFolder: 'other-folder' }, 'wrong_folder'],
  ['cancelled folder picker', { needsPicker: true, pickerCancelled: true }, 'picker_cancelled'],
  ['read-only folder', { folder: { ...folder, capabilities: { canAddChildren: false } } }, 'folder_permission'],
  ['shared drive ownership', { folder: { ...folder, driveId: 'shared-drive' } }, 'shared_drive'],
  ['expired Google session', { status: 401 }, 'auth_expired'],
  ['disabled API', { status: 403, reason: 'accessNotConfigured' }, 'drive_request'],
  ['network failure', { networkError: true }, 'network']
]) {
  test(title + ' prevents file creation', async () => {
    const h = await signedIn(options);
    await assert.rejects(h.client.upload(workbook, '20261011 Team order form.xlsx'), error => error.code === code);
    assert.equal(h.requests.some(r => r.method === 'POST'), false);
  });
}

test('expired session clears the old token and requires another user login', async () => {
  const h = await signedIn({ status: 401 });
  await assert.rejects(h.client.upload(workbook, '20261011 Team order form.xlsx'));
  await h.client.authorize();
  assert.equal(h.prompts.length, 2);
});

test('uncertain upload response is never retried automatically', async () => {
  const h = await signedIn({ uploadNetworkError: true });
  await assert.rejects(h.client.upload(workbook, '20261011 Team order form.xlsx'), /Check the Order Form folder before trying again/);
  assert.equal(h.requests.filter(r => r.method === 'POST').length, 1);
});

test('unexpected link protocol is replaced by a safe Drive link', async () => {
  const h = await signedIn({ link: 'javascript:alert(1)' });
  const result = await h.client.upload(workbook, '20261011 Team order form.xlsx');
  assert.equal(result.url, 'https://drive.google.com/file/d/uploaded-file/view');
});

for (const options of [{ authDenied: true }, { scopeDenied: true }, { authPopupError: 'popup_closed' }, { authPopupError: 'popup_failed_to_open' }]) {
  test('authorization failure stops before Drive requests: ' + Object.keys(options)[0], async () => {
    const h = runtime(options);
    const client = createClient(config, h.env);
    await client.ready();
    await assert.rejects(client.authorize());
    assert.equal(h.requests.length, 0);
  });
}

test('missing config and unloaded SDK reject without requesting access', async () => {
  assert.equal(isConfigured(config), true);
  assert.equal(isConfigured({ ...config, clientId: '' }), false);
  await assert.rejects(createClient({}, runtime().env).ready(), /setup is incomplete/);
  await assert.rejects(createClient(config, runtime().env).authorize(), /Google is still loading/);
});
