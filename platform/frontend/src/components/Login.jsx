import { useEffect, useRef } from 'react';

let googleScript;
function loadGoogle() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  if (!googleScript) {
    googleScript = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.onload = () => resolve(window.google);
      script.onerror = () => {
        script.remove();
        googleScript = null;
        reject(new Error('Google 登录组件加载失败，请刷新重试'));
      };
      document.head.append(script);
    });
  }
  return googleScript;
}

function GoogleSignIn({ clientId, onCredential, onError, busy }) {
  const container = useRef(null);
  const handlers = useRef({ onCredential, onError });
  handlers.current = { onCredential, onError };
  useEffect(() => {
    let alive = true;
    loadGoogle().then(google => {
      if (!alive) return;
      google.accounts.id.initialize({
        client_id: clientId,
        callback: response => { if (alive) handlers.current.onCredential(response.credential); },
      });
      google.accounts.id.renderButton(container.current, { theme: 'outline', size: 'large', text: 'signin_with' });
    }).catch(error => { if (alive) handlers.current.onError(error.message); });
    return () => { alive = false; };
  }, [clientId]);
  return <div id="google-signin" ref={container} aria-busy={busy} />;
}

export default function Login({ config, busy, onLogin, onError }) {
  return <section className="login">
    <h1>把订单与到货进度放在一起</h1>
    <p className="muted">管理方确认下单和到校，学生逐项核对收到的数量。每次操作记录实际账号和时间。</p>
    {config.demo ? <>
      <p className="alert">本机演示使用虚构订单，身份切换只用于验收流程。</p>
      <div className="demo-chooser">{config.demoUsers.map(user =>
        <button key={user.id} disabled={busy} onClick={() => onLogin('demo-login', { userId: user.id })}>{user.name}</button>
      )}</div>
    </> : config.clientId ?
      <GoogleSignIn clientId={config.clientId} busy={busy} onError={onError}
        onCredential={credential => onLogin('login', { credential })} /> :
      <p className="alert">需要先配置平台 Google 登录客户端。请联系平台维护者。</p>}
  </section>;
}

export function Pending({ user, busy, onRefresh }) {
  return <section className="login">
    <h1>{user.role === 'disabled' ? '账号已停用' : '等待加入团队'}</h1>
    <p>请让平台管理员批准你的账号，之后可以查看订单并登记验收。</p>
    <p className="muted">若你是首位平台管理员，在后台按配置说明使用下面的 Google 账号 ID 完成首次管理员设置，再点击重新检查。</p>
    <code>{user.id}</code>
    <div className="actions"><button disabled={busy} onClick={onRefresh}>重新检查</button></div>
  </section>;
}
