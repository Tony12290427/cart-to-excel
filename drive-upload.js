(function(root) {
  'use strict';

  var SCOPE = 'https://www.googleapis.com/auth/drive.file';
  var FOLDER_TYPE = 'application/vnd.google-apps.folder';
  var XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

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

    async function request(url, options) {
      options = options || {};
      options.headers = Object.assign({}, options.headers, { Authorization: 'Bearer ' + token });
      var response;
      try {
        response = await env.fetch(url, options);
      } catch (error) {
        throw failure(options.method === 'POST'
          ? 'Could not confirm the upload. Check the Order Form folder before trying again.'
          : 'Could not reach Google Drive. Check your connection and try again.', 'network');
      }
      var data;
      try { data = await response.json(); } catch (ignored) { data = {}; }
      if (response.status === 401) {
        clearAccount();
        throw failure('Your Google session expired. Click Save to Drive to sign in again.', 'auth_expired');
      }
      if (!response.ok) {
        var reason = data.error && data.error.errors && data.error.errors[0] && data.error.errors[0].reason;
        var message = 'Google Drive could not complete the request (' + response.status + ').';
        if (reason === 'accessNotConfigured' || reason === 'serviceDisabled') {
          message = 'Google Drive API is not enabled for this app. Contact the maintainer.';
        } else if (reason === 'storageQuotaExceeded') {
          message = 'Your Google Drive storage is full. Free some space before uploading.';
        } else if (reason === 'insufficientFilePermissions') {
          message = 'This Google account needs editor access to the team Order Form folder.';
        } else if (response.status === 429 || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') {
          message = 'Google Drive is busy. Please try again later.';
        }
        var err = failure(message, 'drive_request');
        err.status = response.status;
        err.reason = reason;
        throw err;
      }
      return data;
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

    return { ready: ready, authorize: authorize, upload: upload, clearAccount: clearAccount };
  }

  var api = { createClient: createClient, isConfigured: isConfigured, SCOPE: SCOPE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OrderFormDrive = api;
})(typeof window !== 'undefined' ? window : globalThis);
