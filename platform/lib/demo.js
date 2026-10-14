import { createHash } from 'node:crypto';
import { XLSX } from './parser.js';

export const demoUsers = [
  { id: 'demo-manager', name: '管理方 · 演示', role: 'manager' },
  { id: 'demo-student', name: '学生甲 · 演示', role: 'student' },
  { id: 'demo-student-2', name: '学生乙 · 演示', role: 'student' },
  { id: 'demo-admin', name: '管理员 · 演示', role: 'admin' }
];
export function demoReader(folderId) {
  const source = (name, items) => {
    const s = { sheetName: 'Order Form', competition: name, studentName: '测试同学', items: items.map((i, index) => ({
      sourceRow: 11 + index, name: i[0], quantity: i[1], link: '', type: 'Components', amount: '', currency: 'CNY' })) };
    return { ...s, fingerprint: createHash('sha256').update(JSON.stringify(s)).digest('hex') };
  };
  const forms = new Map([
    ['demo-wheel-leg', source('轮足项目', [['测试电机', 4], ['测试接头', 10], ['测试支架', 2]])],
    ['demo-line-follow', source('循线项目', [['测试传感器', 3], ['测试连接线', 6]])],
    ['demo-budget', null]
  ]);
  const files = [...forms.keys()].map((id, i) => ({ id, name: ['轮足测试订单.xlsx', '循线测试订单.xlsx', '测试预算表.xlsx'][i],
    mimeType: XLSX, modifiedTime: '2026-10-14T00:00:00Z', parents: [folderId] }));
  return { list: async () => files, read: async (f) => forms.get(f.id) };
}
