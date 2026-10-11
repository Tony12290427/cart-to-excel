/**
 * Receive an order-form .xlsx from the web page and file it in a Drive folder.
 *
 * ---------------------------------------------------------------------------
 * Setup (about 5 minutes, once — needs your Google account, cannot be automated)
 * ---------------------------------------------------------------------------
 *  1. Open https://script.google.com  →  New project
 *  2. Delete the sample Code.gs contents and paste this whole file
 *  3. Set FOLDER_ID below to the target folder's id — the part after
 *     /folders/ in the folder URL, e.g. .../folders/1EC0L0S0kHn8UAIEY-...  →  1EC0L0S0kHn8UAIEY-...
 *  4. Set TOKEN to any random string, and put the SAME string in index.html
 *     (DRIVE_UPLOAD_TOKEN). It is a speed bump against scanners, not security:
 *     the page is public, so anyone reading its source can see it. Rotate it by
 *     editing both places.
 *  5. Deploy → New deployment → Web app
 *         Execute as:        User accessing the web app   ← so the file is theirs
 *         Who has access:    Anyone
 *     Each person approves the consent screen on their first upload.
 *  6. Copy the resulting /exec URL into index.html → DRIVE_UPLOAD_URL
 *
 *  The folder must stay shared as "Anyone with the link → Editor", because the
 *  script now writes with the submitting person's permission. That requirement is
 *  also why the page opens the upload in a new tab instead of using fetch: a
 *  cross-origin fetch cannot carry the visitor's Google session.
 *
 * Sanity check: run testWrite() once from the editor. It should drop a small
 * text file into the folder and log its URL. If that fails, the folder id or
 * the permission is wrong and uploads will fail too.
 *
 * Notes
 *  - Files are created by the person who submits them: their name on the file and
 *    their storage quota, which is the whole point of running as the visitor.
 *  - A repeated export is kept rather than replacing anything — it lands as
 *    "... (2).xlsx". Nothing here can delete a file (see REPLACE_SAME_NAME).
 *  - Callers that ask without a nonce (curl, tests) still get JSON; the browser
 *    form asks with one and gets a small page instead.
 */

var FOLDER_ID = '1EC0L0S0kHn8UAIEY-nukXsTujPfX2ImG';   // ← your folder
var TOKEN = 'change-me-to-something-random';            // ← must match index.html
var MAX_BYTES = 8 * 1024 * 1024;                        // 8 MB is plenty for a form
var MAX_PER_DAY = 50;                                   // sandbox against bulk abuse

// Replace an existing file with the same name instead of keeping both?
// OFF by default, and that default matters: trashing by name is the ONLY way
// this endpoint could destroy anything, and anyone holding the public URL could
// then overwrite a teammate's submission by guessing its name. With it off the
// endpoint is purely additive — the worst case is extra files, never a lost one.
// A re-export simply lands as "... (2).xlsx".
var REPLACE_SAME_NAME = false;

// The page lives in a public repo, so both the URL and the token are readable by
// anyone. These checks are what stop the endpoint being useful as free file hosting
// on a trusted domain: only something that really is an order form gets written,
// and only a limited number of times per day.
var NAME_PATTERN = /^\d{8}( .+)? order form\.xlsx$/;

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var p = (e && e.parameter) || {};
    if (p.token !== TOKEN) return respond({ ok: false, error: 'bad token' }, p);
    if (!p.data) return respond({ ok: false, error: 'no file data' }, p);

    // 1. daily cap — a real team submits a handful of forms, not hundreds
    var props = PropertiesService.getScriptProperties();
    var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var countKey = 'uploads-' + today;
    var used = Number(props.getProperty(countKey) || 0);
    if (used >= MAX_PER_DAY) {
      return respond({ ok: false, error: 'daily upload limit reached (' + MAX_PER_DAY + ')' }, p);
    }

    var bytes = Utilities.base64Decode(p.data);
    if (bytes.length > MAX_BYTES) {
      return respond({ ok: false, error: 'file too large (' + bytes.length + ' bytes)' }, p);
    }

    // 2. it has to actually be an xlsx: ZIP magic, plus a workbook entry inside.
    //    An xlsx cannot carry VBA macros (that would be .xlsm), so anything that
    //    passes these two checks is a harmless spreadsheet whoever sent it.
    if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4B ||
        bytes[2] !== 0x03 || bytes[3] !== 0x04) {
      return respond({ ok: false, error: 'not a zip/xlsx payload' }, p);
    }
    if (!containsWorkbookEntry(bytes)) {
      return respond({ ok: false, error: 'zip has no xl/workbook.xml — not an xlsx' }, p);
    }

    // 3. and the name has to look like one of our forms
    var name = String(p.filename || '')
      .replace(/[\\/:*?"<>|]/g, '')      // keep it a legal Drive file name
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 150);
    if (!NAME_PATTERN.test(name)) {
      return respond({ ok: false, error: 'unexpected file name: ' + name.slice(0, 60) }, p);
    }

    var folder = DriveApp.getFolderById(FOLDER_ID);

    // This endpoint must never be able to lose a file. If replacing is disabled
    // (the default) a name clash is resolved by adding a suffix, so a second
    // export from the same student coexists rather than deleting the first.
    var replaced = 0;
    if (REPLACE_SAME_NAME) {
      var previous = folder.getFilesByName(name);
      while (previous.hasNext()) {
        previous.next().setTrashed(true);
        replaced++;
      }
    } else {
      name = unusedName(folder, name);
    }

    var blob = Utilities.newBlob(
      bytes,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      name
    );
    var file = folder.createFile(blob);
    props.setProperty(countKey, String(used + 1));
    return respond({
      ok: true,
      name: file.getName(),
      url: file.getUrl(),
      replaced: replaced,
      folder: folder.getName()
    }, p);
  } catch (err) {
    return respond({ ok: false, error: String(err && err.message ? err.message : err) }, p);
  } finally {
    try { lock.releaseLock(); } catch (ignored) {}
  }
}

/**
 * How to answer. The page submits a form and lets the browser open it in a new
 * tab, because a cross-origin fetch cannot carry the visitor's Google session —
 * a top-level navigation can. That tab therefore gets a small HTML page, while
 * API callers (curl, tests) asked without a nonce and still get JSON.
 */
function respond(result, p) {
  if (!p || !p.nonce) return reply(result);

  var name = escapeHtml(result.name || p.filename || '');
  var folder = escapeHtml(result.folder || '');
  var body = result.ok
    ? '<h1>✅ Saved / 已保存</h1>'
      + '<p><b>' + name + '</b></p>'
      + (folder ? '<p>Folder / 文件夹：' + folder + '</p>' : '')
      + (result.url ? '<p><a href="' + escapeHtml(result.url) + '" target="_blank" rel="noopener">'
          + 'Open the file / 打开文件</a></p>' : '')
      + '<p class="hint">You can close this tab and go back to the tool. / 可以关闭这个标签页，回到工具继续。</p>'
    : '<h1>⚠ Upload failed / 上传失败</h1>'
      + '<p>' + escapeHtml(result.error || 'unknown error') + '</p>'
      + '<p class="hint">Send this message to whoever maintains the tool. / 把这句话发给维护者。</p>';

  return HtmlService.createHtmlOutput(
    '<!doctype html><html><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<style>body{font:15px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;'
    + 'max-width:640px;margin:60px auto;padding:0 22px;color:#222}'
    + 'h1{font-size:20px;margin:0 0 14px}p{margin:6px 0}'
    + '.hint{color:#8a8a8a;font-size:13px;margin-top:28px}a{color:#1a73e8}</style>'
    + '</head><body>' + body + '</body></html>'
  ).setTitle(result.ok ? 'Saved' : 'Upload failed');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Browsers send a GET when someone opens the /exec URL directly: say hello
// instead of returning an error page.
function doGet() {
  return reply({ ok: true, service: 'order-form upload', hint: 'POST filename + data + token' });
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * "a.xlsx" -> "a (2).xlsx" when "a.xlsx" is already there, so nothing is ever
 * overwritten. Only ever appends; never touches an existing file.
 */
function unusedName(folder, name) {
  if (!folder.getFilesByName(name).hasNext()) return name;
  var base = name.replace(/\.xlsx$/i, '');
  for (var n = 2; n < 100; n++) {
    var candidate = base + ' (' + n + ').xlsx';
    if (!folder.getFilesByName(candidate).hasNext()) return candidate;
  }
  return base + ' ' + new Date().getTime() + '.xlsx';
}

/**
 * Does the zip contain xl/workbook.xml? Walks the local file headers instead of
 * unzipping: each entry begins with PK\x03\x04, and bytes 26-27 of that header
 * hold the length of the entry name.
 */
function containsWorkbookEntry(bytes) {
  var want = 'xl/workbook.xml';
  for (var i = 0; i + 30 < bytes.length; i++) {
    if (bytes[i] !== 0x50 || bytes[i + 1] !== 0x4B ||
        bytes[i + 2] !== 0x03 || bytes[i + 3] !== 0x04) continue;
    var nameLen = bytes[i + 26] + (bytes[i + 27] << 8);
    if (nameLen <= 0 || nameLen > 200) continue;
    var name = '';
    for (var j = 0; j < nameLen && i + 30 + j < bytes.length; j++) {
      name += String.fromCharCode(bytes[i + 30 + j]);
    }
    if (name === want) return true;
  }
  return false;
}


/** Run this once from the editor to check FOLDER_ID and permissions. */
function testWrite() {
  var folder = DriveApp.getFolderById(FOLDER_ID);
  var file = folder.createFile(
    Utilities.newBlob('drive-upload test ' + new Date(), 'text/plain', 'drive-upload-test.txt')
  );
  Logger.log('folder: ' + folder.getName() + '\nfile: ' + file.getUrl());
}
