import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { Store, fail, requireRole } from './lib/store.js';
import { DriveReader, synchronize } from './lib/drive.js';
import { demoReader, demoUsers } from './lib/demo.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const hash = s => createHash('sha256').update(s).digest('hex');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const SESSION_MS = 12 * 60 * 60 * 1000;

export async function createApplication(options = {}) {
  const demo = options.demo ?? false;
  const COOKIE = demo ? 'order_demo_session' : 'order_session';
  const host = options.host || '127.0.0.1';
  const production = options.production ?? false;
  const origin = options.origin || 'http://127.0.0.1:8787';
  if (demo && (production || !['127.0.0.1', '::1', 'localhost'].includes(host))) throw new Error('演示身份只允许本机开发使用');
  if (production && (!origin.startsWith('https://') || !options.clientId || !options.bootstrap)) throw new Error('正式环境须配置 HTTPS、Google 登录 client ID 和管理员账号 ID');
  const store = options.store || new Store(options.dbPath || path.join(root, 'data', demo ? 'demo.sqlite' : 'orders.sqlite'));
  const folderId = options.folderId || '1EC0L0S0kHn8UAIEY-nukXsTujPfX2ImG';
  if (demo) {
    if (store.all('SELECT id FROM orders').length && store.meta('mode') !== 'demo') throw new Error('不能在实际订单数据库中启用演示身份');
    store.setMeta('mode', 'demo');
    for (const user of demoUsers) {
      store.loginUser(user.id, user.name);
      store.run('UPDATE users SET role=? WHERE id=?', user.role, user.id);
    }
  } else if (store.meta('mode') === 'demo') throw new Error('正式模式不能使用演示数据库');
  const reader = options.reader || (demo ? demoReader(folderId) : new DriveReader({ folderId, serviceAccount: options.serviceAccount }));
  const verifier = options.verifyToken || (async (credential) => {
    if (!options.clientId) fail(503, '尚未配置平台 Google 登录客户端');
    const ticket = await new OAuth2Client(options.clientId).verifyIdToken({ idToken: credential, audience: options.clientId });
    const p = ticket.getPayload();
    if (!p?.sub) fail(401, 'Google 登录信息无效');
    return { id: p.sub, name: p.name || '团队成员' };
  });
  let activeSync;
  const sync = () => {
    if (activeSync) return activeSync;
    activeSync = synchronize(store, reader).finally(() => { activeSync = null; });
    return activeSync;
  };
  const assets = new Map([['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']], ['/style.css', ['style.css', 'text/css']]]);
  const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
  function session(req) {
    const raw = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
    if (!raw || raw.length > 200) return null;
    const s = store.one('SELECT * FROM sessions WHERE hash=? AND expires>?', hash(raw), Date.now());
    if (!s) return null;
    const user = store.user(s.user_id);
    return user ? { ...s, user } : null;
  }
  function issueSession(res, user) {
    const raw = randomBytes(32).toString('hex'), csrf = randomBytes(32).toString('hex');
    store.run('DELETE FROM sessions WHERE expires<?', Date.now());
    store.run('INSERT INTO sessions VALUES(?,?,?,?)', hash(raw), user.id, csrf, Date.now() + SESSION_MS);
    res.setHeader('Set-Cookie', `${COOKIE}=${raw}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${production ? '; Secure' : ''}`);
    return { user, csrf };
  }
  async function body(req) {
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) fail(415, '需要 JSON 请求');
    let size = 0, chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > 128 * 1024) fail(413, '请求过大'); chunks.push(chunk); }
    try { const b = JSON.parse(Buffer.concat(chunks).toString()); if (!b || Array.isArray(b) || typeof b !== 'object') throw new Error(); return b; }
    catch { fail(400, 'JSON 格式无效'); }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; frame-src https://accounts.google.com; connect-src 'self' https://accounts.google.com; style-src 'self' https://accounts.google.com; img-src 'self' data:; base-uri 'none'; object-src 'none'; frame-ancestors 'none'");
    try {
      const url = new URL(req.url, origin), p = url.pathname;
      if (req.method === 'GET' && assets.has(p)) {
        const [filename, type] = assets.get(p);
        const content = await readFile(path.join(root, 'public', filename));
        res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' }); return res.end(content);
      }
      if (!p.startsWith('/api/')) fail(404, '页面不存在');
      if (req.method === 'GET' && p === '/api/config') return json(res, 200, { demo, clientId: options.clientId || '', folderId, syncIntervalSeconds: options.intervalSeconds ?? 300, demoUsers: demo ? demoUsers : [] });
      if (req.method === 'GET' && p === '/api/health') return json(res, 200, { ok: true, mode: demo ? 'demo' : 'live' });
      if (req.method !== 'GET') {
        if (req.method !== 'POST') fail(405, '不支持的请求方法');
        if (req.headers.origin !== origin) fail(403, '请求来源不匹配');
      }
      if (req.method === 'POST' && p === '/api/login') {
        const b = await body(req);
        if (typeof b.credential !== 'string' || b.credential.length > 16000) fail(400, '登录信息无效');
        let identity; try { identity = await verifier(b.credential); } catch (e) { if (e.status) throw e; fail(401, 'Google 登录验证失败，请重新登录'); }
        const user = store.loginUser(identity.id, identity.name, options.bootstrap);
        return json(res, 200, issueSession(res, user));
      }
      if (req.method === 'POST' && p === '/api/demo-login') {
        if (!demo) fail(404, '接口不存在');
        const b = await body(req), user = demoUsers.find(u => u.id === b.userId);
        if (!user) fail(400, '无效演示身份'); return json(res, 200, issueSession(res, store.user(user.id)));
      }
      const s = session(req); if (!s) fail(401, '请先登录');
      if (req.method === 'GET' && p === '/api/me') return json(res, 200, { user: s.user, csrf: s.csrf });
      if (req.method === 'POST' && !equal(req.headers['x-csrf-token'], s.csrf)) fail(403, '请求校验失败，请刷新页面');
      if (req.method === 'POST' && p === '/api/logout') {
        store.run('DELETE FROM sessions WHERE hash=?', s.hash);
        res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${production ? '; Secure' : ''}`);
        return json(res, 200, { ok: true });
      }
      requireRole(s.user, ['student', 'manager', 'admin']);
      if (req.method === 'GET' && p === '/api/orders') return json(res, 200, { orders: store.list(), sync: store.meta('sync') });
      if (req.method === 'POST' && p === '/api/sync') { requireRole(s.user, ['manager', 'admin']); return json(res, 200, await sync()); }
      if (req.method === 'GET' && p === '/api/members') { requireRole(s.user, ['admin']); return json(res, 200, store.all('SELECT * FROM users ORDER BY created_at')); }
      if (req.method === 'POST' && p === '/api/members') { const b = await body(req); return json(res, 200, store.changeRole(s.user, b.userId, b.role)); }
      const match = /^\/api\/orders\/([0-9a-f-]{36})(?:\/([a-z-]+))?$/.exec(p);
      if (match && req.method === 'GET' && !match[2]) return json(res, 200, store.detail(match[1]));
      if (match && req.method === 'POST') {
        const actions = { classify: 'classify', purchase: 'purchase', batches: 'addBatch', arrive: 'arrive', receive: 'receive', 'void-receipt': 'voidReceipt', 'resolve-issue': 'resolveIssue', 'accept-source': 'acceptSource' };
        const action = actions[match[2]]; if (!action) fail(404, '操作不存在');
        return json(res, 200, store[action](match[1], await body(req), s.user));
      }
      fail(404, '接口不存在');
    } catch (error) {
      json(res, error.status || 500, { error: error.status ? error.message : '服务器处理失败，请联系管理员' });
      if (!error.status) process.stderr.write('Platform request failed: ' + error.constructor.name + '\n');
    }
  });
  let timer;
  const start = async (port = 8787) => {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
    const effectivePort = server.address().port;
    if (options.origin === 'dynamic') throw new Error('PUBLIC_ORIGIN 必须是明确的网站来源');
    const interval = options.intervalSeconds ?? 300;
    if (options.autoSync !== false) { void sync(); if (interval > 0) { timer = setInterval(() => { void sync(); }, interval * 1000); timer.unref(); } }
    return { port: effectivePort, host };
  };
  const close = async () => { clearInterval(timer); await new Promise(resolve => server.close(resolve)); await activeSync; if (!options.store) store.close(); };
  return { server, store, sync, start, close };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const demo = process.argv.includes('--demo');
  const host = process.env.HOST || '127.0.0.1', port = Number(demo ? process.env.DEMO_PORT || 8788 : process.env.PORT || 8787);
  const origin = demo ? `http://${host}:${port}` : process.env.PUBLIC_ORIGIN || `http://${host}:${port}`;
  const app = await createApplication({ demo, host, origin, production: process.env.NODE_ENV === 'production',
    dbPath: demo ? (process.env.DEMO_DB_PATH || path.join(root, 'data/demo.sqlite')) : process.env.DB_PATH,
    clientId: process.env.GOOGLE_CLIENT_ID, bootstrap: process.env.BOOTSTRAP_ADMIN_SUB,
    folderId: process.env.DRIVE_FOLDER_ID, serviceAccount: process.env.DRIVE_SERVICE_ACCOUNT,
    intervalSeconds: Math.max(30, Number(process.env.SYNC_INTERVAL_SECONDS || 300)) });
  await app.start(port);
  process.stdout.write(`Order platform: ${origin} (${demo ? 'fictional demo' : 'Google/Drive live mode'})\n`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
}
