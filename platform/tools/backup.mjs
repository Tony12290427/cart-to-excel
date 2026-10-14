import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, chmod } from 'node:fs/promises';
import path from 'node:path';
const source = process.argv[2], target = process.argv[3];
if (!source || !target || path.resolve(source) === path.resolve(target)) throw new Error('Usage: node tools/backup.mjs <source.sqlite> <backup.sqlite>');
await mkdir(path.dirname(path.resolve(target)), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(source, { readOnly: true });
try { await backup(db, target); await chmod(target, 0o600); console.log('SQLite backup saved.'); } finally { db.close(); }
