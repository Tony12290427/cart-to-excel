import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { quantity, itemKey } from './parser.js';

const now = () => new Date().toISOString();
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const fail = (status, message) => { throw new HttpError(status, message); };
export const requireRole = (user, roles) => { if (!user || !roles.includes(user.role)) fail(403, '此操作需要相应团队角色'); };
const managed = ['manager', 'admin'];
const members = ['student', ...managed];
const clean = (v, max = 2000) => { if (typeof v !== 'string' || v.length > max) fail(400, '文字字段无效或过长'); return v.trim(); };
const q = (v, zero = true) => { try { return quantity(v, zero); } catch (e) { fail(400, e.message); } };
const round = (v) => Math.round(v * 1000) / 1000;
function humanLink(url) {
  if (!/^https:\/\/(?:docs|drive)\.google\.com\//.test(url || '')) return null;
  try { const u=new URL(url);u.searchParams.delete('ouid');u.searchParams.delete('authuser');return u.href; } catch { return null; }
}

export class Store {
  constructor(filename) {
    if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,role TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),csrf TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,drive_id TEXT UNIQUE NOT NULL,title TEXT NOT NULL,url TEXT NOT NULL,
        competition TEXT NOT NULL DEFAULT '',student_name TEXT NOT NULL DEFAULT '',state TEXT NOT NULL DEFAULT 'review',
        source_state TEXT NOT NULL DEFAULT 'current',modified_time TEXT,fingerprint TEXT,snapshot TEXT,pending_snapshot TEXT,
        import_error TEXT,version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),position INTEGER NOT NULL,
        name TEXT NOT NULL,link TEXT NOT NULL,type TEXT NOT NULL,requested REAL NOT NULL,ordered REAL NOT NULL DEFAULT 0,
        amount TEXT,currency TEXT,source_row INTEGER);
      CREATE TABLE IF NOT EXISTS batches(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),tracking TEXT NOT NULL,
        note TEXT NOT NULL,created_by TEXT REFERENCES users(id),created_at TEXT NOT NULL,arrived_at TEXT,
        claimed_by TEXT REFERENCES users(id),claimed_at TEXT);
      CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),batch_id TEXT NOT NULL REFERENCES batches(id),
        actor_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,voided_at TEXT,voided_by TEXT REFERENCES users(id),void_reason TEXT);
      CREATE TABLE IF NOT EXISTS receipt_lines(receipt_id TEXT NOT NULL REFERENCES receipts(id),item_id TEXT NOT NULL REFERENCES items(id),quantity REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS issues(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),receipt_id TEXT NOT NULL REFERENCES receipts(id),
        item_id TEXT NOT NULL REFERENCES items(id),description TEXT NOT NULL,resolved_at TEXT,resolved_by TEXT REFERENCES users(id),resolution TEXT);
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,order_id TEXT REFERENCES orders(id),actor_id TEXT,
        actor_name TEXT NOT NULL,action TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS item_order ON items(order_id);
      CREATE INDEX IF NOT EXISTS receipt_order ON receipts(order_id);
      CREATE INDEX IF NOT EXISTS event_order ON events(order_id,id);`);
    this.transaction(() => {
      for (const row of this.all('SELECT id,url FROM orders')) {
        const cleaned=humanLink(row.url);
        if (cleaned && cleaned!==row.url) this.run('UPDATE orders SET url=? WHERE id=?',cleaned,row.id);
      }
    });
  }
  one(sql, ...args) { return this.db.prepare(sql).get(...args); }
  all(sql, ...args) { return this.db.prepare(sql).all(...args); }
  run(sql, ...args) { return this.db.prepare(sql).run(...args); }
  transaction(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  close() { this.db.close(); }
  setMeta(key, value) { this.run('INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(value)); }
  meta(key) { const v = this.one('SELECT value FROM meta WHERE key=?', key); return v ? JSON.parse(v.value) : null; }
  user(id) { return this.one('SELECT * FROM users WHERE id=?', id); }
  loginUser(id, name, bootstrap) {
    if (typeof id !== 'string' || !id || id.length > 200) fail(401, 'Google 账号信息无效');
    this.run('INSERT INTO users VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name', id, clean(name || '团队成员', 200), id === bootstrap ? 'admin' : 'pending', now());
    if (id === bootstrap) this.run("UPDATE users SET role='admin' WHERE id=?", id);
    return this.user(id);
  }
  changeRole(actor, id, role) {
    requireRole(actor, ['admin']);
    if (!['pending', 'student', 'manager', 'admin', 'disabled'].includes(role)) fail(400, '无效角色');
    const user = this.user(id); if (!user) fail(404, '成员不存在');
    if (id === actor.id) fail(400, '不能在此修改自己的管理员角色');
    this.transaction(() => {
      this.run('UPDATE users SET role=? WHERE id=?', role, id);
      this.run('DELETE FROM sessions WHERE user_id=?', id);
      this.event(null, actor, 'member_role', { userId: id, name: user.name, role });
    });
    return this.user(id);
  }
  event(order, actor, action, payload) { this.run('INSERT INTO events(order_id,actor_id,actor_name,action,payload,created_at) VALUES(?,?,?,?,?,?)', order, actor?.id || null, actor?.name || 'Drive 同步', action, JSON.stringify(payload), now()); }
  source(id) { return this.one('SELECT * FROM orders WHERE drive_id=?', id); }
  sourceUrl(file) { return humanLink(file.webViewLink) || 'https://drive.google.com/file/d/' + encodeURIComponent(file.id) + '/view'; }
  newSource(file) {
    const id = randomUUID(), time = now();
    this.run('INSERT INTO orders(id,drive_id,title,url,modified_time,created_at,updated_at) VALUES(?,?,?,?,?,?,?)', id, file.id, file.name, this.sourceUrl(file), file.modifiedTime || '', time, time);
    return this.source(file.id);
  }
  writeItems(orderId, snapshot) {
    snapshot.items.forEach((i, index) => this.run('INSERT INTO items(id,order_id,position,name,link,type,requested,amount,currency,source_row) VALUES(?,?,?,?,?,?,?,?,?,?)', randomUUID(), orderId, index, i.name, i.link, i.type, i.quantity, i.amount || '', i.currency || '', i.sourceRow));
  }
  ingest(file, snapshot) {
    this.transaction(() => {
      const prior = this.source(file.id), order = prior || this.newSource(file);
      if (!snapshot) {
        this.run("UPDATE orders SET source_state='unreadable',import_error=?,modified_time=?,version=version+1,updated_at=? WHERE id=?", '未识别到标准订单表，需人工核实', file.modifiedTime || '', now(), order.id);
        return;
      }
      if (!prior || !order.snapshot) {
        this.writeItems(order.id, snapshot);
        this.run("UPDATE orders SET snapshot=?,fingerprint=?,competition=?,student_name=?,source_state='current',import_error=NULL WHERE id=?", JSON.stringify(snapshot), snapshot.fingerprint, snapshot.competition, snapshot.studentName, order.id);
        this.event(order.id, null, 'import', { itemCount: snapshot.items.length });
      } else if (order.fingerprint !== snapshot.fingerprint) {
        this.run("UPDATE orders SET pending_snapshot=?,source_state='changed',version=version+1 WHERE id=?", JSON.stringify(snapshot), order.id);
        this.event(order.id, null, 'source_changed', { itemCount: snapshot.items.length });
      } else {
        this.run("UPDATE orders SET source_state='current',pending_snapshot=NULL,import_error=NULL,version=version+? WHERE id=?", order.source_state === 'current' ? 0 : 1, order.id);
      }
      this.run('UPDATE orders SET title=?,url=?,modified_time=?,updated_at=? WHERE id=?', file.name, this.sourceUrl(file), file.modifiedTime || '', now(), order.id);
    });
  }
  importError(file, message) {
    this.transaction(() => {
      const order = this.source(file.id) || this.newSource(file);
      this.run("UPDATE orders SET source_state='unreadable',import_error=?,modified_time=?,version=version+1,updated_at=? WHERE id=?", String(message).slice(0,1000), file.modifiedTime || '', now(), order.id);
    });
  }
  markMissing(ids) {
    const seen = new Set(ids);
    this.transaction(() => {
      for (const o of this.all('SELECT id,drive_id,source_state FROM orders')) if (!seen.has(o.drive_id) && o.source_state !== 'missing') {
        this.run("UPDATE orders SET source_state='missing',version=version+1,updated_at=? WHERE id=?", now(), o.id);
        this.event(o.id, null, 'source_missing', {});
      }
    });
  }
  totals(id) { return new Map(this.all(`SELECT l.item_id, SUM(l.quantity) AS received FROM receipt_lines l JOIN receipts r ON r.id=l.receipt_id
    WHERE r.order_id=? AND r.voided_at IS NULL GROUP BY l.item_id`, id).map(r => [r.item_id, round(r.received)])); }
  detail(id) {
    const o = this.one('SELECT * FROM orders WHERE id=?', id); if (!o) fail(404, '订单不存在');
    const totals = this.totals(id);
    const items = this.all('SELECT * FROM items WHERE order_id=? ORDER BY position', id).map(i => ({ ...i, received: totals.get(i.id) || 0,
      unpurchased: round(i.requested - i.ordered), outstanding: round(i.ordered - (totals.get(i.id) || 0)) }));
    const batches = this.all(`SELECT b.*,u.name AS claimed_name FROM batches b LEFT JOIN users u ON b.claimed_by=u.id WHERE order_id=? ORDER BY created_at`, id);
    const issues = this.all(`SELECT i.*,it.name AS item_name,u.name AS resolved_name FROM issues i JOIN items it ON it.id=i.item_id LEFT JOIN users u ON u.id=i.resolved_by WHERE i.order_id=?`, id);
    const receipts = this.all(`SELECT r.*,u.name AS actor_name FROM receipts r JOIN users u ON u.id=r.actor_id WHERE r.order_id=? ORDER BY r.created_at`, id)
      .map(r => ({ ...r, lines: this.all('SELECT l.item_id,l.quantity,i.name FROM receipt_lines l JOIN items i ON i.id=l.item_id WHERE receipt_id=?', r.id) }));
    let status = o.state;
    if (o.state === 'active') {
      if (items.every(i => i.received === i.requested) && !issues.some(i => !i.resolved_at)) status = 'complete';
      else if (issues.some(i => !i.resolved_at)) status = 'issue';
      else if (items.some(i => i.received > 0)) status = 'partial_received';
      else if (batches.some(b => b.arrived_at && !b.claimed_at)) status = 'awaiting_pickup';
      else if (items.every(i => i.ordered === i.requested)) status = 'ordered';
      else if (items.some(i => i.ordered > 0)) status = 'partial_ordered';
      else status = 'awaiting_order';
    }
    const { snapshot, pending_snapshot, ...safe } = o;
    return { ...safe, status, items, batches, receipts, issues,
      pendingSource: pending_snapshot ? JSON.parse(pending_snapshot) : null,
      history: this.all('SELECT * FROM events WHERE order_id=? ORDER BY id DESC LIMIT 150', id).map(e => ({ ...e, payload: JSON.parse(e.payload) })) };
  }
  list() { return this.all("SELECT id FROM orders ORDER BY (state='active') DESC, modified_time DESC, created_at DESC").map(o => {
    const d = this.detail(o.id); const { history, receipts, pendingSource, ...summary } = d; return summary;
  }); }
  mutate(id, version, actor, roles, fn, needsActive = true) {
    requireRole(actor, roles);
    return this.transaction(() => {
      const o = this.one('SELECT * FROM orders WHERE id=?', id); if (!o) fail(404, '订单不存在');
      if (!Number.isInteger(version) || version !== o.version) fail(409, '订单已被其他人更新，请刷新后重试');
      if (needsActive && o.state !== 'active') fail(409, '请先由管理方确认纳入该订单');
      if (needsActive && o.source_state !== 'current') fail(409, 'Drive 原表变更或不可读取，请先核对原表');
      fn(o);
      this.run('UPDATE orders SET version=version+1,updated_at=? WHERE id=?', now(), id);
      return this.detail(id);
    });
  }
  classify(id, body, actor) {
    return this.mutate(id, body.version, actor, managed, o => {
      if (!['active', 'excluded', 'archived'].includes(body.state)) fail(400, '无效订单分类');
      if (body.state === 'active' && (!o.snapshot || o.source_state !== 'current')) fail(409, '原表未成功读取，不能纳入');
      this.run('UPDATE orders SET state=? WHERE id=?', body.state, id);
      this.event(id, actor, 'classification', { state: body.state, note: clean(body.note || '', 1000) });
    }, false);
  }
  purchase(id, body, actor) {
    return this.mutate(id, body.version, actor, managed, () => {
      const items = this.detail(id).items;
      if (!Array.isArray(body.lines) || body.lines.length !== items.length) fail(400, '请提供每项商品的已下单总数量');
      const input = new Map(body.lines.map(l => [l.itemId, q(l.quantity)]));
      if (input.size !== items.length || items.some(i => !input.has(i.id))) fail(400, '商品列表不匹配');
      for (const i of items) {
        const value = input.get(i.id);
        if (value < i.received || value > i.requested) fail(400, '已下单数量不能少于已验收数量或超过申请数量');
        this.run('UPDATE items SET ordered=? WHERE id=?', value, i.id);
      }
      this.event(id, actor, 'purchase', { lines: body.lines, note: clean(body.note || '', 1000) });
    });
  }
  addBatch(id, body, actor) {
    return this.mutate(id, body.version, actor, managed, () => {
      if (!this.detail(id).items.some(i => i.ordered > 0)) fail(409, '请先记录已下单数量');
      const batchId = randomUUID();
      this.run('INSERT INTO batches(id,order_id,tracking,note,created_by,created_at,arrived_at) VALUES(?,?,?,?,?,?,?)', batchId, id, clean(body.tracking || '', 150), clean(body.note || '', 1000), actor.id, now(), body.arrived === true ? now() : null);
      this.event(id, actor, 'batch_added', { batchId, tracking: body.tracking || '', arrived: body.arrived === true });
    });
  }
  arrive(id, body, actor) {
    return this.mutate(id, body.version, actor, managed, () => {
      const b = this.one('SELECT * FROM batches WHERE id=? AND order_id=?', body.batchId, id);
      if (!b) fail(404, '到货批次不存在'); if (b.arrived_at) fail(409, '这批已确认到校');
      this.run('UPDATE batches SET arrived_at=? WHERE id=?', now(), b.id);
      this.event(id, actor, 'arrived_at_school', { batchId: b.id });
    });
  }
  receive(id, body, actor) {
    return this.mutate(id, body.version, actor, members, () => {
      const b = this.one('SELECT * FROM batches WHERE id=? AND order_id=?', body.batchId, id);
      if (!b?.arrived_at) fail(409, '请先由管理方确认这批已到学校');
      const items = this.detail(id).items;
      if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > items.length) fail(400, '请填写本次验收');
      const seen = new Set(), lines = [];
      for (const l of body.lines) {
        const item = items.find(i => i.id === l.itemId); if (!item || seen.has(l.itemId)) fail(400, '商品不存在或重复');
        seen.add(l.itemId); const value = q(l.quantity); const issue = clean(l.issue || '', 1000);
        if (round(item.received + value) > item.ordered) fail(400, '本次验收后累计数量超过已下单数量');
        if (value || issue) lines.push({ itemId: l.itemId, quantity: value, issue });
      }
      if (!lines.length) fail(400, '请至少填写一项收到数量或异常');
      const receiptId = randomUUID();
      this.run('INSERT INTO receipts(id,order_id,batch_id,actor_id,created_at) VALUES(?,?,?,?,?)', receiptId, id, b.id, actor.id, now());
      for (const l of lines) {
        this.run('INSERT INTO receipt_lines VALUES(?,?,?)', receiptId, l.itemId, l.quantity);
        if (l.issue) this.run('INSERT INTO issues(id,order_id,receipt_id,item_id,description) VALUES(?,?,?,?,?)', randomUUID(), id, receiptId, l.itemId, l.issue);
      }
      if (!b.claimed_at) this.run('UPDATE batches SET claimed_by=?,claimed_at=? WHERE id=?', actor.id, now(), b.id);
      this.event(id, actor, 'receipt', { receiptId, batchId: b.id, lines });
    });
  }
  voidReceipt(id, body, actor) {
    return this.mutate(id, body.version, actor, members, () => {
      const r = this.one('SELECT * FROM receipts WHERE id=? AND order_id=?', body.receiptId, id);
      if (!r || r.voided_at) fail(404, '有效验收记录不存在');
      if (r.actor_id !== actor.id && !managed.includes(actor.role)) fail(403, '只能更正自己的验收记录');
      const reason = clean(body.reason || '', 1000); if (!reason) fail(400, '请填写更正原因');
      this.run('UPDATE receipts SET voided_at=?,voided_by=?,void_reason=? WHERE id=?', now(), actor.id, reason, r.id);
      this.run("UPDATE issues SET resolved_at=?,resolved_by=?,resolution=? WHERE receipt_id=? AND resolved_at IS NULL", now(), actor.id, '原验收已更正：' + reason, r.id);
      this.event(id, actor, 'void_receipt', { receiptId: r.id, reason });
    });
  }
  resolveIssue(id, body, actor) {
    return this.mutate(id, body.version, actor, members, () => {
      const issue = this.one('SELECT * FROM issues WHERE id=? AND order_id=?', body.issueId, id);
      if (!issue || issue.resolved_at) fail(404, '未处理异常不存在');
      const resolution = clean(body.resolution || '', 1000); if (!resolution) fail(400, '请填写处理结果');
      this.run('UPDATE issues SET resolved_at=?,resolved_by=?,resolution=? WHERE id=?', now(), actor.id, resolution, issue.id);
      this.event(id, actor, 'resolve_issue', { issueId: issue.id, resolution });
    });
  }
  acceptSource(id, body, actor) {
    return this.mutate(id, body.version, actor, managed, o => {
      if (!o.pending_snapshot) fail(409, '没有待确认的原表变更');
      const source = JSON.parse(o.pending_snapshot), old = this.detail(id).items;
      const oldKeys = old.map(itemKey), newKeys = source.items.map(itemKey);
      if (new Set(oldKeys).size !== oldKeys.length || new Set(newKeys).size !== newKeys.length) fail(409, '存在重复商品，需在原表中明确区分后重试');
      const byKey = new Map(old.map(i => [itemKey(i), i]));
      for (const item of old) if (!newKeys.includes(itemKey(item)) && (item.ordered || this.one('SELECT 1 FROM receipt_lines WHERE item_id=?', item.id))) fail(409, '已下单或验收的商品被删除或改名，请先核实并恢复原表，不能自动迁移进度');
      for (const incoming of source.items) {
        const prior = byKey.get(itemKey(incoming));
        if (prior && incoming.quantity < prior.ordered) fail(409, '新申请数量小于已下单数量，请先核实');
      }
      for (const item of old) if (!newKeys.includes(itemKey(item))) this.run('DELETE FROM items WHERE id=?', item.id);
      source.items.forEach((i, position) => {
        const prior = byKey.get(itemKey(i));
        if (prior) this.run('UPDATE items SET position=?,requested=?,type=?,amount=?,currency=?,source_row=? WHERE id=?', position, i.quantity, i.type, i.amount, i.currency, i.sourceRow, prior.id);
        else this.run('INSERT INTO items(id,order_id,position,name,link,type,requested,amount,currency,source_row) VALUES(?,?,?,?,?,?,?,?,?,?)', randomUUID(), id, position, i.name, i.link, i.type, i.quantity, i.amount, i.currency, i.sourceRow);
      });
      this.run("UPDATE orders SET snapshot=?,fingerprint=?,competition=?,student_name=?,pending_snapshot=NULL,source_state='current',import_error=NULL WHERE id=?", JSON.stringify(source), source.fingerprint, source.competition, source.studentName, id);
      this.event(id, actor, 'accept_source_changes', { itemCount: source.items.length });
    }, false);
  }
}
