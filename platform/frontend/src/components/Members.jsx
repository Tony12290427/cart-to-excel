import { useState } from 'react';
import { labels } from '../display.jsx';

function MemberRow({ member, currentId, busy, onSave }) {
  const [role, setRole] = useState(member.role);
  return <form className="member-row" onSubmit={event => { event.preventDefault(); onSave(member.id, role); }}>
    <div><strong>{member.name}</strong><div className="muted">{labels[member.role]}</div></div>
    {member.id === currentId ? <span className="badge green">当前管理员</span> :
      <div className="actions">
        <select aria-label={`${member.name}角色`} value={role} disabled={busy} onChange={event => setRole(event.target.value)}>
          {['pending', 'student', 'manager', 'admin', 'disabled'].map(value => <option key={value} value={value}>{labels[value]}</option>)}
        </select>
        <button type="submit" disabled={busy}>保存角色</button>
      </div>}
  </form>;
}

export default function Members({ users, currentId, busy, onSave, onBack }) {
  return <div className="panel">
    <div className="section-head"><h2>团队成员与角色</h2><button className="small" disabled={busy} onClick={onBack}>返回订单详情</button></div>
    <p className="muted">登录者先等待批准。学生均可验收；管理方可记录下单和到校；管理员可分配角色。</p>
    {users.map(member => <MemberRow key={`${member.id}:${member.role}`} member={member} currentId={currentId} busy={busy} onSave={onSave} />)}
  </div>;
}
