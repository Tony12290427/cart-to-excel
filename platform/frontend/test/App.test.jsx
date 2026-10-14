import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App.jsx';
import { Store } from '../../lib/store.js';
import { demoReader, demoUsers } from '../../lib/demo.js';
import { synchronize } from '../../lib/drive.js';

const stores = [];
afterEach(() => { cleanup(); vi.unstubAllGlobals(); for (const store of stores.splice(0)) store.close(); });

async function setup() {
  const store = new Store(':memory:'); stores.push(store);
  for (const user of demoUsers) {
    store.loginUser(user.id, user.name);
    store.run('UPDATE users SET role=? WHERE id=?', user.role, user.id);
  }
  await synchronize(store, demoReader('test-folder'));
  let identity = null;
  const actions = { classify: 'classify', purchase: 'purchase', batches: 'addBatch', arrive: 'arrive', receive: 'receive',
    'void-receipt': 'voidReceipt', 'resolve-issue': 'resolveIssue', 'accept-source': 'acceptSource' };
  const api = async (path, body, csrf) => {
    if (path === 'config') return { demo: true, demoUsers, syncIntervalSeconds: 300 };
    if (path === 'demo-login') { identity = store.user(body.userId); return { user: identity, csrf: 'test-csrf' }; }
    if (!identity) throw Object.assign(new Error('请先登录'), { status: 401 });
    if (body !== undefined && csrf !== 'test-csrf') throw new Error('缺少会话 CSRF 校验');
    if (path === 'logout') { identity = null; return { ok: true }; }
    if (path === 'me') return { user: identity, csrf: 'test-csrf' };
    if (path === 'orders') return { orders: store.list(), sync: store.meta('sync') };
    if (path === 'members') return body ? store.changeRole(identity, body.userId, body.role) : store.all('SELECT * FROM users');
    const [, id, action] = path.split('/');
    return action ? store[actions[action]](id, body, identity) : store.detail(id);
  };
  render(<App apiRequest={api} />);
  const user = userEvent.setup();
  const click = async name => {
    await waitFor(() => expect(screen.getByRole('button', { name }).disabled).toBe(false));
    await user.click(screen.getByRole('button', { name }));
  };
  const detail = () => within(screen.getByRole('region', { name: '订单详情' }));
  const id = store.list().find(order => order.drive_id === 'demo-wheel-leg').id;
  const select = () => click(/轮足测试订单.xlsx/);
  const settle = () => waitFor(() => expect(screen.getByRole('button', { name: '刷新进度' }).disabled).toBe(false));
  return { store, id, user, click, detail, select, settle, expire: () => { identity = null; } };
}

test('React UI handles purchasing, two deliveries and two students receiving item quantities', async () => {
  const h = await setup();
  await h.click('管理方 · 演示'); await h.select();
  expect(h.detail().getByText('待核实')).toBeTruthy();
  await h.click('确认纳入订单');
  await h.click('全部商品已下单');
  await h.user.type(screen.getByLabelText('快递单号（可选）'), 'DEMO-ONE');
  await h.user.click(screen.getByLabelText('这批已经送到学校'));
  await h.click('新增到货批次');
  await waitFor(() => expect(h.store.detail(h.id).batches).toHaveLength(1)); await h.settle();
  await h.user.click(screen.getByText('新增一批快递'));
  await h.user.type(screen.getByLabelText('快递单号（可选）'), 'DEMO-TWO');
  await h.click('新增到货批次');
  await h.click('确认送到学校');
  await h.click('切换演示身份'); await h.click('学生甲 · 演示'); await h.select();
  expect(screen.queryByRole('button', { name: '全部商品已下单' })).toBeNull();
  await h.user.click(screen.getAllByRole('button', { name: '领取并验收' })[0]);
  const setQuantity = async (name, value) => {
    const input = screen.getByLabelText(`${name}本次合格数量`);
    await h.user.clear(input); await h.user.type(input, String(value));
  };
  await setQuantity('测试电机', 2); await setQuantity('测试接头', 5);
  await h.click('一键签收');
  await waitFor(() => expect(h.store.detail(h.id).status).toBe('partial_received')); await h.settle();
  expect(h.detail().getByText('测试电机 × 2；测试接头 × 5')).toBeTruthy();
  await h.click('切换演示身份'); await h.click('学生乙 · 演示'); await h.select();
  await h.click('领取并验收');
  await setQuantity('测试电机', 2); await setQuantity('测试接头', 5); await setQuantity('测试支架', 2);
  await h.click('一键签收');
  await waitFor(() => expect(h.store.detail(h.id).status).toBe('complete')); await h.settle();
  expect(h.detail().getByText('已到齐')).toBeTruthy();
  const order = h.store.detail(h.id);
  expect(order.receipts.map(receipt => receipt.actor_id)).toEqual(['demo-student', 'demo-student-2']);
  expect(order.items.map(item => item.received)).toEqual([4, 10, 2]);
  await h.click('刷新进度'); await h.settle();
  expect(h.detail().getByText('已到齐')).toBeTruthy();
}, 15000);

test('filtering preserves an unsaved quantity; a stale submit refreshes rather than overwriting another operator', async () => {
  const h = await setup(); await h.click('管理方 · 演示'); await h.select(); await h.click('确认纳入订单'); await h.settle();
  const input = screen.getByLabelText('测试电机已下单总数量');
  await h.user.clear(input); await h.user.type(input, '1');
  await h.user.type(screen.getByLabelText('搜索订单'), '轮足');
  await h.click(/待下单 \/ 未全部下单/);
  expect(screen.getByLabelText('测试电机已下单总数量').value).toBe('1');
  const current = h.store.detail(h.id);
  h.store.purchase(h.id, { version: current.version, lines: current.items.map(item => ({ itemId: item.id, quantity: 2 })) }, h.store.user('demo-manager'));
  await h.click('保存下单数量');
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('订单已被其他人更新'));
  await waitFor(() => expect(screen.getByLabelText('测试电机已下单总数量').value).toBe('2'));
  expect(h.store.detail(h.id).items.map(item => item.ordered)).toEqual([2, 2, 2]);
});

test('bulk receipt selects remaining quantities, skips completed items and keeps unchecked missing goods outstanding', async () => {
  const h = await setup();
  const manager = h.store.user('demo-manager');
  let order = h.store.classify(h.id, { version: h.store.detail(h.id).version, state: 'active' }, manager);
  order = h.store.purchase(h.id, { version: order.version, lines: order.items.map(item => ({ itemId: item.id, quantity: item.requested })) }, manager);
  order = h.store.addBatch(h.id, { version: order.version, arrived: true }, manager);
  order = h.store.receive(h.id, { version: order.version, batchId: order.batches[0].id,
    lines: order.items.map(item => ({ itemId: item.id, quantity: item.name === '测试电机' ? 1 : item.name === '测试支架' ? 2 : 0 })) }, h.store.user('demo-student'));
  await h.click('学生乙 · 演示'); await h.select(); await h.click('补充验收');
  expect(screen.getByLabelText('测试支架已到货').disabled).toBe(true);
  const all = screen.getByLabelText('一键全选');
  await h.user.click(all);
  expect(screen.getByLabelText('测试电机本次合格数量').value).toBe('3');
  expect(screen.getByLabelText('测试接头本次合格数量').value).toBe('10');
  expect(screen.getByLabelText('测试支架本次合格数量').value).toBe('0');
  await h.user.click(screen.getByLabelText('测试接头已到货'));
  expect(screen.getByLabelText('测试接头本次合格数量').value).toBe('0');
  expect(all.indeterminate).toBe(true);
  const motor = screen.getByLabelText('测试电机本次合格数量');
  await h.user.clear(motor); await h.user.type(motor, '2');
  expect(screen.getByLabelText('测试电机已到货').checked).toBe(true);
  await h.click('一键签收'); await h.settle();
  order = h.store.detail(h.id);
  expect(order.items.map(item => item.received)).toEqual([3, 0, 2]);
  expect(order.items.map(item => item.outstanding)).toEqual([1, 10, 0]);
  expect(order.receipts).toHaveLength(2);
  expect(order.receipts[1].actor_id).toBe('demo-student-2');
  expect(order.status).toBe('partial_received');
  await h.click('补充验收');
  await h.user.click(screen.getByLabelText('一键全选'));
  expect(screen.getByLabelText('测试电机本次合格数量').value).toBe('1');
  await h.user.click(screen.getByLabelText('一键全选'));
  expect(screen.getByLabelText('测试电机本次合格数量').value).toBe('0');
  expect(screen.getByLabelText('测试接头本次合格数量').value).toBe('0');
  await h.user.type(screen.getByLabelText('测试接头异常说明'), '这批缺少接头');
  await h.click('一键签收'); await h.settle();
  order = h.store.detail(h.id);
  expect(order.items.map(item => item.received)).toEqual([3, 0, 2]);
  expect(order.issues[0].description).toBe('这批缺少接头');
  expect(order.status).toBe('issue');
});

test('session expiry clears order data; admin role changes keep the member panel open', async () => {
  const h = await setup(); await h.click('管理方 · 演示'); await h.select();
  h.expire(); await h.click('确认纳入订单');
  await waitFor(() => expect(screen.getByRole('heading', { name: '把订单与到货进度放在一起' })).toBeTruthy());
  expect(screen.queryByRole('region', { name: '订单详情' })).toBeNull();
  expect(h.store.detail(h.id).state).toBe('review');
  await h.click('管理员 · 演示'); await h.click('成员与角色');
  await h.user.selectOptions(screen.getByLabelText('学生甲 · 演示角色'), 'manager');
  const row = screen.getByLabelText('学生甲 · 演示角色').closest('form');
  await h.user.click(within(row).getByRole('button', { name: '保存角色' }));
  await waitFor(() => expect(h.store.user('demo-student').role).toBe('manager'));
  expect(screen.getByRole('heading', { name: '团队成员与角色' })).toBeTruthy();
});

test('Google login callback uses the backend session and leaves an unknown member pending', async () => {
  let callback;
  const google = { accounts: { id: {
    initialize: vi.fn(options => { callback = options.callback; }),
    renderButton: vi.fn(container => {
      const button = document.createElement('button');
      button.textContent = 'Google 测试登录';
      button.onclick = () => callback({ credential: 'fictional-id-token' });
      container.append(button);
    }),
  } } };
  vi.stubGlobal('google', google);
  const member = { id: 'new-member', name: '新成员', role: 'pending' };
  const request = vi.fn(async (path, body) => {
    if (path === 'config') return { demo: false, clientId: 'test-client.apps.googleusercontent.com' };
    if (path === 'me') throw Object.assign(new Error('请先登录'), { status: 401 });
    if (path === 'login') {
      expect(body).toEqual({ credential: 'fictional-id-token' });
      return { user: member, csrf: 'server-session-csrf' };
    }
    throw new Error('待批准成员不应读取订单');
  });
  render(<App apiRequest={request} />);
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Google 测试登录' }));
  expect(await screen.findByRole('heading', { name: '等待加入团队' })).toBeTruthy();
  expect(screen.getByText('新成员 · 待批准')).toBeTruthy();
  expect(google.accounts.id.initialize.mock.calls[0][0].client_id).toBe('test-client.apps.googleusercontent.com');
  expect(request.mock.calls.some(([path]) => path === 'orders')).toBe(false);
});
