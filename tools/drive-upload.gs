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
 *         Execute as:        Me
 *         Who has access:    Anyone
 *     Authorise it when asked (the consent screen is for your own script).
 *  6. Copy the resulting /exec URL into index.html → DRIVE_UPLOAD_URL
 *
 * Sanity check: run testWrite() once from the editor. It should drop a small
 * text file into the folder and log its URL. If that fails, the folder id or
 * the permission is wrong and uploads will fail too.
 *
 * Notes
 *  - Files are created by whoever deploys the script, so they count against that
 *    account's storage. Share the folder with the team; do not share this URL
 *    outside it.
 *  - Re-uploading the same file name trashes the older copy, so a student who
 *    exports twice does not leave two submissions behind.
 *  - The page posts as a "simple request" (form-encoded) which keeps it clear of
 *    CORS preflight, and Apps Script answers on a domain that allows the origin.
 */

var FOLDER_ID = '1EC0L0S0kHn8UAIEY-nukXsTujPfX2ImG';   // ← your folder
var TOKEN = 'change-me-to-something-random';            // ← must match index.html
var MAX_BYTES = 8 * 1024 * 1024;                        // 8 MB is plenty for a form
var MAX_PER_DAY = 50;                                   // sandbox against bulk abuse

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
    if (p.token !== TOKEN) return reply({ ok: false, error: 'bad token' });
    if (!p.data) return reply({ ok: false, error: 'no file data' });

    // 1. daily cap — a real team submits a handful of forms, not hundreds
    var props = PropertiesService.getScriptProperties();
    var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var countKey = 'uploads-' + today;
    var used = Number(props.getProperty(countKey) || 0);
    if (used >= MAX_PER_DAY) {
      return reply({ ok: false, error: 'daily upload limit reached (' + MAX_PER_DAY + ')' });
    }

    var bytes = Utilities.base64Decode(p.data);
    if (bytes.length > MAX_BYTES) {
      return reply({ ok: false, error: 'file too large (' + bytes.length + ' bytes)' });
    }

    // 2. it has to actually be an xlsx: ZIP magic, plus a workbook entry inside.
    //    An xlsx cannot carry VBA macros (that would be .xlsm), so anything that
    //    passes these two checks is a harmless spreadsheet whoever sent it.
    if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4B ||
        bytes[2] !== 0x03 || bytes[3] !== 0x04) {
      return reply({ ok: false, error: 'not a zip/xlsx payload' });
    }
    if (!containsWorkbookEntry(bytes)) {
      return reply({ ok: false, error: 'zip has no xl/workbook.xml — not an xlsx' });
    }

    // 3. and the name has to look like one of our forms
    var name = String(p.filename || '')
      .replace(/[\\/:*?"<>|]/g, '')      // keep it a legal Drive file name
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 150);
    if (!NAME_PATTERN.test(name)) {
      return reply({ ok: false, error: 'unexpected file name: ' + name.slice(0, 60) });
    }

    var folder = DriveApp.getFolderById(FOLDER_ID);

    // Same name = the same student exported again: replace, do not pile up copies
    var previous = folder.getFilesByName(name);
    var replaced = 0;
    while (previous.hasNext()) {
      previous.next().setTrashed(true);
      replaced++;
    }

    var blob = Utilities.newBlob(
      bytes,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      name
    );
    var file = folder.createFile(blob);
    props.setProperty(countKey, String(used + 1));
    return reply({
      ok: true,
      name: file.getName(),
      url: file.getUrl(),
      replaced: replaced,
      folder: folder.getName()
    });
  } catch (err) {
    return reply({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    try { lock.releaseLock(); } catch (ignored) {}
  }
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
