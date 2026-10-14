import { GoogleAuth, Impersonated } from 'google-auth-library';
import { XLSX, SHEET, parseOrderWorkbook, PARSER_VERSION } from './parser.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
export class DriveReader {
  constructor({ folderId, serviceAccount, fetchImpl = fetch, authClient }) {
    if (!/^[A-Za-z0-9_-]+$/.test(folderId || '')) throw new Error('DRIVE_FOLDER_ID 无效');
    this.folderId = folderId; this.fetch = fetchImpl;
    this.auth = authClient; this.serviceAccount = serviceAccount;
  }
  async client() {
    if (!this.auth) {
      const source = await new GoogleAuth({ scopes: this.serviceAccount ? ['https://www.googleapis.com/auth/cloud-platform'] : [SCOPE] }).getClient();
      this.auth = this.serviceAccount ? new Impersonated({ sourceClient: source, targetPrincipal: this.serviceAccount,
        targetScopes: [SCOPE], delegates: [], lifetime: 3600 }) : source;
    }
    return this.auth;
  }
  async request(route, params = {}, binary = false) {
    const token = await (await this.client()).getAccessToken();
    if (!token?.token) throw new Error('未取得 Drive 后台读取凭据');
    const url = new URL('https://www.googleapis.com/drive/v3/' + route);
    for (const [key, value] of Object.entries(params)) if (value != null) url.searchParams.set(key, String(value));
    const response = await this.fetch(url, { headers: { Authorization: 'Bearer ' + token.token }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) {
      const error = new Error(`Drive 读取失败 (${response.status})：请检查服务账号凭据及文件夹共享权限`);
      error.status = response.status; throw error;
    }
    if (!binary) return response.json();
    const chunks = []; let length = 0;
    for await (const part of response.body) {
      length += part.length;
      if (length > 8 * 1024 * 1024) throw new Error('订单文件超过 8 MB');
      chunks.push(part);
    }
    return Buffer.concat(chunks);
  }
  async list() {
    const files = []; let pageToken; const seenTokens = new Set();
    do {
      const page = await this.request('files', { q: `'${this.folderId}' in parents and trashed = false`, pageSize: 100,
        pageToken, fields: 'nextPageToken,incompleteSearch,files(id,name,mimeType,modifiedTime,webViewLink,parents)', supportsAllDrives: true });
      if (page.incompleteSearch) throw new Error('Drive 返回不完整列表，保留现有订单并等待重试');
      files.push(...page.files || []); pageToken = page.nextPageToken;
      if (pageToken && seenTokens.has(pageToken)) throw new Error('Drive 分页标记重复，保留现有订单并重试');
      if (pageToken) seenTokens.add(pageToken);
      if (files.length > 10000) throw new Error('文件夹超过第一版同步上限');
    } while (pageToken);
    return files;
  }
  async read(file) {
    if (!file.parents?.includes(this.folderId)) throw new Error('订单不在配置的文件夹内');
    if (![XLSX, SHEET].includes(file.mimeType)) return null;
    const route = 'files/' + encodeURIComponent(file.id);
    const bytes = await this.request(file.mimeType === SHEET ? route + '/export' : route,
      file.mimeType === SHEET ? { mimeType: XLSX } : { alt: 'media' }, true);
    return parseOrderWorkbook(bytes);
  }
}

export async function synchronize(store, reader) {
  if (store.syncRunning) return { running: true };
  store.syncRunning = true;
  const startedAt = new Date().toISOString();
  store.setMeta('sync', { running: true, startedAt });
  let result;
  try {
    const files = await reader.list(); // finish every page before marking anything missing
    const reparse = store.meta('parserVersion') !== PARSER_VERSION;
    let updated = 0, errors = 0;
    let cursor = 0, processed = 0;
    const worker = async () => { while (cursor < files.length) {
      const file = files[cursor++];
      if (![XLSX, SHEET].includes(file.mimeType)) continue;
      const prior = store.source(file.id);
      if (!reparse && prior && prior.modified_time === file.modifiedTime && (prior.state === 'excluded' || (prior.source_state !== 'unreadable' && prior.source_state !== 'missing'))) continue;
      try { store.ingest(file, await reader.read(file)); updated++; }
      catch (error) { store.importError(file, error.message); errors++; }
      processed++;
      store.setMeta('sync', { running: true, startedAt, scanned: files.length, processed, updated, errors });
    } };
    // Three bounded readers keep initial imports usable without unbounded ZIP
    // memory or API fan-out; SQLite writes stay synchronous/transactional.
    await Promise.all(Array.from({ length: 3 }, worker));
    store.markMissing(files.map(f => f.id));
    store.setMeta('parserVersion', PARSER_VERSION);
    result = { running: false, ok: errors === 0, finishedAt: new Date().toISOString(), startedAt, scanned: files.length, updated, errors };
  } catch (error) {
    // Error messages produced here contain no tokens or private file contents.
    result = { running: false, ok: false, startedAt, finishedAt: new Date().toISOString(), error: error.message };
  } finally { store.syncRunning = false; }
  store.setMeta('sync', result); return result;
}
