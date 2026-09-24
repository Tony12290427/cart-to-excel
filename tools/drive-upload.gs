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

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var p = (e && e.parameter) || {};
    if (p.token !== TOKEN) return reply({ ok: false, error: 'bad token' });
    if (!p.data) return reply({ ok: false, error: 'no file data' });

    var bytes = Utilities.base64Decode(p.data);
    if (bytes.length > MAX_BYTES) {
      return reply({ ok: false, error: 'file too large (' + bytes.length + ' bytes)' });
    }

    var name = String(p.filename || 'order form.xlsx')
      .replace(/[\\/:*?"<>|]/g, '')      // keep it a legal Drive file name
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 150);
    if (!/\.xlsx$/i.test(name)) name += '.xlsx';

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

/** Run this once from the editor to check FOLDER_ID and permissions. */
function testWrite() {
  var folder = DriveApp.getFolderById(FOLDER_ID);
  var file = folder.createFile(
    Utilities.newBlob('drive-upload test ' + new Date(), 'text/plain', 'drive-upload-test.txt')
  );
  Logger.log('folder: ' + folder.getName() + '\nfile: ' + file.getUrl());
}
