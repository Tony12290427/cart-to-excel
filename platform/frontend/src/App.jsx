import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest as defaultRequest } from './api.js';
import { isMember, labels } from './display.jsx';
import Login, { Pending } from './components/Login.jsx';
import Orders from './components/Orders.jsx';
import OrderDetail from './components/OrderDetail.jsx';
import Members from './components/Members.jsx';

export default function App({ apiRequest = defaultRequest }) {
  const [config, setConfig] = useState(null);
  const [user, setUser] = useState(null);
  const [orders, setOrders] = useState([]);
  const [sync, setSync] = useState(null);
  const [selected, setSelected] = useState(null);
  const [current, setCurrent] = useState(null);
  const [members, setMembers] = useState(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [fatal, setFatal] = useState(null);
  const [notice, setNotice] = useState(null);
  const session = useRef({ user: null, csrf: '' });
  const selection = useRef(null);
  const locked = useRef(false);
  const refreshSequence = useRef(0);
  const api = useCallback((path, data) => apiRequest(path, data, session.current.csrf), [apiRequest]);
  const toast = useCallback((message, error = false) => setNotice({ message, error }), []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  const remember = useCallback(result => {
    session.current = result;
    setUser(result.user);
  }, []);

  const clearSession = useCallback(() => {
    refreshSequence.current++;
    session.current = { user: null, csrf: '' };
    selection.current = null;
    setUser(null); setOrders([]); setSync(null); setSelected(null); setCurrent(null); setMembers(null);
    setFilter('all'); setSearch('');
  }, []);

  const load = useCallback(async (identity = session.current.user) => {
    const sequence = ++refreshSequence.current;
    if (!isMember(identity)) { setOrders([]); setCurrent(null); setMembers(null); return; }
    const result = await api('orders');
    if (sequence !== refreshSequence.current) return;
    setOrders(result.orders); setSync(result.sync);
    const id = selection.current;
    if (id && result.orders.some(order => order.id === id)) {
      const detail = await api('orders/' + id);
      if (sequence === refreshSequence.current && id === selection.current) setCurrent(detail);
    } else { selection.current = null; setSelected(null); setCurrent(null); }
  }, [api]);

  useEffect(() => {
    let alive = true;
    async function initialize() {
      try {
        const settings = await api('config');
        if (!alive) return;
        setConfig(settings);
        let identity;
        try { identity = await api('me'); } catch (error) { if (error.status !== 401) throw error; }
        if (!alive) return;
        if (identity) { remember(identity); await load(identity.user); }
        if (alive) setReady(true);
      } catch (error) { if (alive) { setFatal(error.message); setReady(true); } }
    }
    void initialize();
    return () => { alive = false; refreshSequence.current++; };
  }, [api, load, remember]);

  const run = async operation => {
    if (locked.current) return;
    locked.current = true; setBusy(true);
    try { await operation(); }
    catch (error) {
      toast(error.message, true);
      if (error.status === 401) clearSession();
      else if (session.current.user) {
        try { const identity = await api('me'); remember(identity); await load(identity.user); }
        catch (refreshError) { if (refreshError.status === 401) clearSession(); }
      }
    } finally { locked.current = false; setBusy(false); }
  };

  const refresh = () => run(async () => {
    const identity = await api('me'); remember(identity); await load(identity.user);
    if (members && identity.user.role === 'admin') setMembers(await api('members'));
  });

  const login = (path, data) => run(async () => {
    const identity = await api(path, data); remember(identity); await load(identity.user);
  });

  const select = id => run(async () => {
    selection.current = id; setSelected(id); setMembers(null); setCurrent(null);
    const sequence = ++refreshSequence.current;
    const detail = await api('orders/' + id);
    if (sequence === refreshSequence.current && selection.current === id) setCurrent(detail);
  });

  const mutate = (action, data = {}) => {
    if (!current) return;
    const order = current;
    return run(async () => {
      const updated = await api(`orders/${order.id}/${action}`, { version: order.version, ...data });
      if (selection.current === order.id) setCurrent(updated);
      toast('已保存，操作人和时间已记录');
      await load();
    });
  };

  return <>
    <header className="topbar">
      <a className="brand" href="/">Order Form <span>订单管理</span></a>
      <div id="account">{user && <><span>{user.name} · {labels[user.role]}</span>
        <button className="small" disabled={busy} onClick={() => run(async () => { await api('logout', {}); clearSession(); })}>
          {config?.demo ? '切换演示身份' : '退出'}</button></>}</div>
    </header>
    {config?.demo && <div className="banner">本机演示 · 虚构订单与身份 · 尚未连接实际 Drive</div>}
    <main aria-busy={busy || !ready}>
      {!ready ? <p className="empty">正在载入订单平台…</p> : fatal ?
        <section className="login"><h1>平台暂时无法连接</h1><p>{fatal}</p><button onClick={() => window.location.reload()}>重新连接</button></section> :
        !user ? <Login config={config} busy={busy} onLogin={login} onError={message => toast(message, true)} /> :
        !isMember(user) ? <Pending user={user} busy={busy} onRefresh={refresh} /> :
        <Orders config={config} user={user} orders={orders} sync={sync} selected={selected} filter={filter}
          search={search} busy={busy} onFilter={setFilter} onSearch={setSearch} onSelect={select} onRefresh={refresh}
          onMembers={() => run(async () => setMembers(await api('members')))}
          onSync={() => run(async () => { const result = await api('sync', {}); toast(result.ok ? '同步完成' : result.error || '部分文件读取失败', !result.ok); await load(); })}>
          {members ? <Members users={members} currentId={user.id} busy={busy} onBack={() => setMembers(null)}
            onSave={(userId, role) => run(async () => { await api('members', { userId, role }); setMembers(await api('members')); toast('成员角色已更新'); })} /> :
            current ? <OrderDetail key={`${current.id}:${current.version}`} order={current} user={user} demo={config.demo} busy={busy} onMutate={mutate} /> :
            <div className="panel empty">{selected ? '正在载入订单详情…' : '选择一份订单，查看下单、到校和验收记录。'}</div>}
        </Orders>}
    </main>
    {notice && <div id="notice" className={notice.error ? 'error' : ''} role="status" aria-live="polite">{notice.message}</div>}
    <footer>用于团队下单与收货核对。账号姓名、操作时间和验收数量会保存在平台；原始表格保留在 Google Drive。</footer>
  </>;
}
