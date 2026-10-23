(function(root) {
  'use strict';

  var SCOPE = 'https://www.googleapis.com/auth/drive.file';
  var FOLDER_TYPE = 'application/vnd.google-apps.folder';
  var XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  var SHEET_TYPE = 'application/vnd.google-apps.spreadsheet';
  var MAX_FILE_BYTES = 5 * 1024 * 1024;

  function isConfigured(config) {
    return !!(config && config.clientId && config.apiKey && config.projectNumber && config.folderId);
  }

  function createClient(config, runtime) {
    var env = runtime || root;
    var token = '';
    var expiresAt = 0;
    var tokenClient;
    var readyPromise;
    var pendingAuth;

    function failure(message, code) {
      var error = new Error(message);
      error.code = code;
      return error;
    }

    function clearAccount() {
      token = '';
      expiresAt = 0;
    }

    function loadScript(url, available) {
      if (available()) return Promise.resolve();
      return new Promise(function(resolve, reject) {
        var script = env.document.createElement('script');
        var timer = env.setTimeout(function() {
          reject(failure('Google could not load. Check your connection and reload the page.', 'sdk_load'));
        }, 20000);
        script.src = url;
        script.async = true;
        script.onload = function() {
          env.clearTimeout(timer);
          if (available()) resolve();
          else reject(failure('Google could not initialize. Reload the page.', 'sdk_load'));
        };
        script.onerror = function() {
          env.clearTimeout(timer);
          reject(failure('Google could not load. Check your connection and reload the page.', 'sdk_load'));
        };
        env.document.head.appendChild(script);
      });
    }

    function ready() {
      if (!isConfigured(config)) return Promise.reject(failure('Google Drive setup is incomplete.', 'config'));
      if (readyPromise) return readyPromise;
      readyPromise = Promise.all([
        loadScript('https://accounts.google.com/gsi/client', function() {
          return !!(env.google && env.google.accounts && env.google.accounts.oauth2);
        }),
        loadScript('https://apis.google.com/js/api.js', function() {
          return !!(env.gapi && env.gapi.load);
        }).then(function() {
          return new Promise(function(resolve, reject) {
            env.gapi.load('picker', {
              callback: resolve,
              onerror: function() { reject(failure('Google folder picker could not load.', 'sdk_load')); },
              timeout: 20000,
              ontimeout: function() { reject(failure('Google folder picker timed out. Reload the page.', 'sdk_load')); }
            });
          });
        })
      ]).then(function() {
        tokenClient = env.google.accounts.oauth2.initTokenClient({
          client_id: config.clientId,
          scope: SCOPE,
          include_granted_scopes: false,
          callback: function(response) {
            if (!pendingAuth) return;
            var pending = pendingAuth;
            pendingAuth = null;
            if (response.error || !response.access_token) {
              pending.reject(failure('Google access was not granted. Try again when you are ready.', 'auth_denied'));
              return;
            }
            if (!env.google.accounts.oauth2.hasGrantedAllScopes(response, SCOPE)) {
              pending.reject(failure('Allow access to the files used by this app to upload your form.', 'auth_denied'));
              return;
            }
            token = response.access_token;
            expiresAt = Date.now() + Math.max(0, Number(response.expires_in || 0) - 60) * 1000;
            pending.resolve();
          },
          error_callback: function(error) {
            if (!pendingAuth) return;
            var pending = pendingAuth;
            pendingAuth = null;
            pending.reject(failure(error.type === 'popup_closed'
              ? 'Google sign-in was cancelled.'
              : 'Allow the Google sign-in popup, then try again.', 'auth_popup'));
          }
        });
      });
      return readyPromise;
    }

    // Called directly from the button event, before any asynchronous export.
    function authorize() {
      if (token && Date.now() < expiresAt) return Promise.resolve();
      if (!tokenClient) return Promise.reject(failure('Google is still loading. Please try again shortly.', 'sdk_load'));
      if (pendingAuth) return Promise.reject(failure('Finish the current Google sign-in first.', 'auth_busy'));
      clearAccount();
      return new Promise(function(resolve, reject) {
        pendingAuth = { resolve: resolve, reject: reject };
        try {
          tokenClient.requestAccessToken({ prompt: 'select_account' });
        } catch (error) {
          pendingAuth = null;
          reject(failure('Google sign-in could not open. Allow popups and try again.', 'auth_popup'));
        }
      });
    }

    async function request(url, options, binary) {
      options = options || {};
      options.cache = 'no-store';
      options.headers = Object.assign({}, options.headers, { Authorization: 'Bearer ' + token });
      var response;
      try {
        response = await env.fetch(url, options);
      } catch (error) {
        throw failure(options.method === 'PATCH'
          ? 'Could not confirm the update. Re-import the original file before trying again.'
          : options.method === 'POST'
          ? 'Could not confirm the upload. Check the Order Form folder before trying again.'
          : 'Could not reach Google Drive. Check your connection and try again.', options.method === 'PATCH' ? 'save_uncertain' : 'network');
      }
      var data;
      if (!binary || !response.ok) {
        try { data = await response.json(); } catch (ignored) { data = {}; }
      }
      if (response.status === 401) {
        clearAccount();
        throw failure('Your Google session expired. Sign in again with a Drive button.', 'auth_expired');
      }
      if (!response.ok) {
        var reason = data.error && data.error.errors && data.error.errors[0] && data.error.errors[0].reason;
        var message = 'Google Drive could not complete the request (' + response.status + ').';
        if (reason === 'accessNotConfigured' || reason === 'serviceDisabled') {
          message = 'Google Drive API is not enabled for this app. Contact the maintainer.';
        } else if (reason === 'storageQuotaExceeded') {
          message = 'Your Google Drive storage is full. Free some space before uploading.';
        } else if (reason === 'insufficientFilePermissions') {
          message = 'This Google account does not have the required file or folder permission.';
        } else if (response.status === 412) {
          throw failure('The original file changed. Re-import it before updating.', 'source_changed');
        } else if (response.status === 429 || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') {
          message = 'Google Drive is busy. Please try again later.';
        }
        var err = failure(message, 'drive_request');
        err.status = response.status;
        err.reason = reason;
        throw err;
      }
      if (binary) {
        var declared = response.headers && response.headers.get('Content-Length');
        if (Number(declared) > MAX_FILE_BYTES) throw failure('Order forms must be 5 MB or smaller.', 'file_size');
        if (response.body && response.body.getReader) {
          var reader = response.body.getReader(), chunks = [], length = 0;
          try {
            while (true) {
              var part = await reader.read();
              if (part.done) break;
              length += part.value.byteLength;
              if (length > MAX_FILE_BYTES) { await reader.cancel(); throw failure('Order forms must be 5 MB or smaller.', 'file_size'); }
              chunks.push(part.value);
            }
          } catch (error) { if (error.code) throw error; throw failure('Could not finish downloading the order form. Try importing again.', 'network'); }
          var bytes = new Uint8Array(length), offset = 0;
          chunks.forEach(function(chunk) { bytes.set(chunk, offset); offset += chunk.byteLength; });
          return bytes.buffer;
        }
        var buffer = await response.arrayBuffer();
        if (buffer.byteLength > MAX_FILE_BYTES) throw failure('Order forms must be 5 MB or smaller.', 'file_size');
        return buffer;
      }
      if (data && response.headers && response.headers.get) data.etag = response.headers.get('ETag') || '';
      return data;
    }

    function requireToken() {
      if (!token || Date.now() >= expiresAt) throw failure('Sign in again with a Drive button.', 'auth_expired');
    }

    function fileHeaders(source) {
      return source.resourceKey ? { 'X-Goog-Drive-Resource-Keys': source.id + '/' + source.resourceKey } : {};
    }

    function fileMetadata(source) {
      var fields = 'id,name,mimeType,size,version,modifiedTime,webViewLink,trashed,capabilities(canEdit,canDownload)';
      return request('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(source.id)
        + '?supportsAllDrives=true&fields=' + encodeURIComponent(fields), { headers: fileHeaders(source) });
    }

    function sameVersion(a, b) {
      return !!a.version && !!b.version && String(a.version) === String(b.version)
        && !!a.modifiedTime && a.modifiedTime === b.modifiedTime;
    }

    function chooseOrderFile() {
      return new Promise(function(resolve, reject) {
        var picker;
        try {
          var types = XLSX_TYPE + ',' + SHEET_TYPE;
          var team = new env.google.picker.DocsView(env.google.picker.ViewId.DOCS)
            .setMimeTypes(types).setIncludeFolders(true).setSelectFolderEnabled(false).setParent(config.folderId);
          var all = new env.google.picker.DocsView(env.google.picker.ViewId.DOCS).setMimeTypes(types);
          picker = new env.google.picker.PickerBuilder()
            .setDeveloperKey(config.apiKey).setAppId(String(config.projectNumber)).setOAuthToken(token)
            .setOrigin(env.location.origin).setTitle('Select an existing order form')
            .addView(team).addView(all).setCallback(function(data) {
              if (data.action === env.google.picker.Action.CANCEL) {
                picker.setVisible(false);
                reject(failure('Import cancelled. Your current items are unchanged.', 'picker_cancelled'));
              } else if (data.action === env.google.picker.Action.PICKED) {
                picker.setVisible(false);
                var doc = data.docs && data.docs[0];
                if (!doc || !/^[A-Za-z0-9_-]{1,200}$/.test(doc.id || '') ||
                    (doc.resourceKey && !/^[A-Za-z0-9_-]+$/.test(doc.resourceKey))) {
                  reject(failure('Choose an Excel order form or Google spreadsheet.', 'file_type'));
                } else resolve({ id: doc.id, resourceKey: doc.resourceKey || '' });
              }
            }).build();
          picker.setVisible(true);
        } catch (error) { reject(failure('The order-form picker could not open. Try again.', 'picker_load')); }
      });
    }

    async function importFile(status) {
      requireToken();
      status = status || function() {};
      var selected = await chooseOrderFile();
      status('Reading the selected order form…');
      var source = await fileMetadata(selected);
      if (source.id !== selected.id || source.trashed || [XLSX_TYPE, SHEET_TYPE].indexOf(source.mimeType) === -1)
        throw failure('Choose an Excel order form or Google spreadsheet.', 'file_type');
      if (source.capabilities && source.capabilities.canDownload === false) throw failure('This file does not allow downloading. Ask its owner for access.', 'file_permission');
      if (Number(source.size) > MAX_FILE_BYTES) throw failure('Order forms must be 5 MB or smaller.', 'file_size');
      source.resourceKey = selected.resourceKey;
      var url = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(source.id);
      url += source.mimeType === SHEET_TYPE ? '/export?mimeType=' + encodeURIComponent(XLSX_TYPE) : '?alt=media&supportsAllDrives=true';
      var bytes = await request(url, { headers: fileHeaders(source) }, true);
      var after = await fileMetadata(source);
      if (!sameVersion(source, after)) throw failure('The file changed while downloading. Import it again.', 'source_changed');
      return { source: Object.assign({}, after, { resourceKey: selected.resourceKey }), bytes: bytes };
    }

    async function updateFile(source, blob, status) {
      requireToken();
      if (!source || !/^[A-Za-z0-9_-]{1,200}$/.test(source.id || '') || [XLSX_TYPE, SHEET_TYPE].indexOf(source.mimeType) === -1)
        throw failure('Import the original order form before updating.', 'file_type');
      if (blob.size > MAX_FILE_BYTES) throw failure('Order forms must be 5 MB or smaller.', 'file_size');
      var latest = await fileMetadata(source);
      if (latest.trashed || latest.id !== source.id || latest.mimeType !== source.mimeType || !sameVersion(source, latest))
        throw failure('The original file changed. Re-import it before updating.', 'source_changed');
      if (!latest.capabilities || !latest.capabilities.canEdit) throw failure('You can read this file, but need editor access to update it. Save a copy instead.', 'file_permission');
      (status || function() {})('Updating the original order form…');
      var boundary = 'order_form_' + env.crypto.randomUUID().replace(/-/g, '');
      var body = new env.Blob([
        '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n',
        JSON.stringify({ mimeType: source.mimeType }),
        '\r\n--' + boundary + '\r\nContent-Type: ' + XLSX_TYPE + '\r\n\r\n', blob,
        '\r\n--' + boundary + '--\r\n'
      ], { type: 'multipart/related; boundary=' + boundary });
      var headers = Object.assign({}, fileHeaders(source), { 'Content-Type': body.type });
      if (latest.etag) headers['If-Match'] = latest.etag;
      var result = await request('https://www.googleapis.com/upload/drive/v3/files/' + encodeURIComponent(source.id)
        + '?uploadType=multipart&supportsAllDrives=true&fields=' + encodeURIComponent('id,name,mimeType,version,modifiedTime,webViewLink,capabilities(canEdit)'),
        { method: 'PATCH', headers: headers, body: body });
      if (result.id !== source.id) throw failure('Could not confirm the updated file. Re-import it before trying again.', 'save_uncertain');
      result.resourceKey = source.resourceKey || '';
      return result;
    }

    function folderMetadata() {
      var fields = 'id,name,mimeType,driveId,capabilities(canAddChildren)';
      return request('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(config.folderId)
        + '?supportsAllDrives=true&fields=' + encodeURIComponent(fields));
    }

    function checkFolder(folder) {
      if (folder.id !== config.folderId || folder.mimeType !== FOLDER_TYPE) {
        throw failure('Choose the team Order Form folder linked below, then try again.', 'wrong_folder');
      }
      if (folder.driveId) {
        throw failure('A shared drive owns its files. Use the configured shared My Drive folder for personal ownership.', 'shared_drive');
      }
      if (!folder.capabilities || !folder.capabilities.canAddChildren) {
        throw failure('This Google account needs editor access to the team Order Form folder.', 'folder_permission');
      }
      return folder;
    }

    function chooseFolder() {
      return new Promise(function(resolve, reject) {
        var picker;
        try {
          var view = new env.google.picker.DocsView(env.google.picker.ViewId.FOLDERS)
            .setIncludeFolders(true)
            .setSelectFolderEnabled(true);
          picker = new env.google.picker.PickerBuilder()
            .setDeveloperKey(config.apiKey)
            .setAppId(String(config.projectNumber))
            .setOAuthToken(token)
            .setOrigin(env.location.origin)
            .setTitle('Choose the team ' + config.folderName + ' folder')
            .addView(view)
            .setCallback(function(data) {
              if (data.action === env.google.picker.Action.CANCEL) {
                picker.setVisible(false);
                reject(failure('Folder selection was cancelled. Your form was not uploaded.', 'picker_cancelled'));
              } else if (data.action === env.google.picker.Action.PICKED) {
                picker.setVisible(false);
                var doc = data.docs && data.docs[0];
                if (!doc || doc.id !== config.folderId) {
                  reject(failure('That is a different folder. Choose the team Order Form folder linked below.', 'wrong_folder'));
                } else {
                  resolve();
                }
              }
            }).build();
          picker.setVisible(true);
        } catch (error) {
          reject(failure('The folder picker could not open. Contact the maintainer to check the Google configuration.', 'picker_load'));
        }
      });
    }

    async function upload(blob, filename, status) {
      status = status || function() {};
      if (!token || Date.now() >= expiresAt) {
        throw failure('Click Save to Drive to sign in again.', 'auth_expired');
      }
      var folder;
      try {
        folder = await folderMetadata();
      } catch (error) {
        if (error.status !== 404 && error.reason !== 'appNotAuthorizedToFile') throw error;
        status('First upload: choose the team Order Form folder in the Google picker.');
        await chooseFolder();
        folder = await folderMetadata();
      }
      checkFolder(folder);
      status('Uploading to ' + folder.name + '…');
      var boundary = 'order_form_' + env.crypto.randomUUID().replace(/-/g, '');
      var metadata = { name: filename, mimeType: XLSX_TYPE, parents: [config.folderId] };
      var body = new env.Blob([
        '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n',
        JSON.stringify(metadata),
        '\r\n--' + boundary + '\r\nContent-Type: ' + XLSX_TYPE + '\r\n\r\n',
        blob,
        '\r\n--' + boundary + '--\r\n'
      ], { type: 'multipart/related; boundary=' + boundary });
      var result = await request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields='
        + encodeURIComponent('id,name,webViewLink,parents,owners(displayName,me)'), {
        method: 'POST', headers: { 'Content-Type': body.type }, body: body
      });
      if (!result.id || !result.parents || result.parents.indexOf(config.folderId) === -1) {
        throw failure('Google did not confirm the destination. Check the Order Form folder before trying again.', 'unconfirmed');
      }
      // API links are checked before being passed to the page's link element.
      var link = result.webViewLink;
      if (!link || !/^https:\/\/(docs|drive)\.google\.com\//.test(link)) {
        link = 'https://drive.google.com/file/d/' + encodeURIComponent(result.id) + '/view';
      }
      return {
        name: result.name || filename, url: link, folder: folder.name,
        owner: result.owners && result.owners[0] && result.owners[0].displayName,
        ownedByMe: !!(result.owners && result.owners.some(function(owner) { return owner.me; }))
      };
    }

    return { ready: ready, authorize: authorize, upload: upload, importFile: importFile, updateFile: updateFile, clearAccount: clearAccount };
  }

  var api = { createClient: createClient, isConfigured: isConfigured, SCOPE: SCOPE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OrderFormDrive = api;
})(typeof window !== 'undefined' ? window : globalThis);
