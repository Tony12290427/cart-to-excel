// Run locally only after the Google-verified pending account ID is visible.
// No OAuth credential, email allowlist or user-provided role is trusted here.
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { Store } from '../lib/store.js';
const sub = process.argv[2];
if (!sub || !/^\d{10,40}$/.test(sub)) throw new Error('Provide the Google-verified account ID from the pending-membership page.');
const envPath = '.env', env = await readFile(envPath, 'utf8');
const existing = /^BOOTSTRAP_ADMIN_SUB=(.*)$/m.exec(env)?.[1].trim();
if (existing && existing !== sub) throw new Error('A different bootstrap administrator is configured. Refusing to replace it.');
const dbPath = /^DB_PATH=(.*)$/m.exec(env)?.[1].trim() || './data/orders.sqlite';
const store = new Store(dbPath);
try {
  const user = store.user(sub);
  if (!user) throw new Error('Account must first complete server-verified Google login.');
  await writeFile(envPath, /^BOOTSTRAP_ADMIN_SUB=/m.test(env) ? env.replace(/^BOOTSTRAP_ADMIN_SUB=.*$/m, 'BOOTSTRAP_ADMIN_SUB=' + sub) : env + '\nBOOTSTRAP_ADMIN_SUB=' + sub + '\n', { mode: 0o600 });
  await chmod(envPath, 0o600);
  store.transaction(() => {
    store.run("UPDATE users SET role='admin' WHERE id=?", sub);
    store.event(null, { id: sub, name: user.name }, 'bootstrap_admin', { method: 'local_verified_account_setup' });
  });
  console.log('Verified administrator configured. Refresh the platform.');
} finally { store.close(); }
