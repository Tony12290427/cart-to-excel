import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const SHEET = 'application/vnd.google-apps.spreadsheet';
export const PARSER_VERSION = 'order-table-rows-v3';
const xml = new XMLParser({ ignoreAttributes: false, parseTagValue: false, processEntities: true,
  isArray: (name) => ['row', 'c', 'si', 'r', 'sheet', 'Relationship'].includes(name) });
const text = (v) => v == null ? '' : typeof v !== 'object' ? String(v)
  : Array.isArray(v) ? v.map(text).join('') : v.t != null ? text(v.t)
    : v.r != null ? text(v.r) : String(v['#text'] || '');
const label = (s) => String(s).toLowerCase().replace(/[\s._\n()-]/g, '');
const hash = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const itemKey = (i) => JSON.stringify([i.name.trim(), i.link.trim()]);
export function quantity(value, allowZero = false) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(\.\d{1,3})?$/.test(value.trim())))
    throw new Error('数量必须是数字，最多三位小数');
  const n = Number(value);
  if (!Number.isFinite(n) || n < (allowZero ? 0 : 0.001) || n > 1000000 || Math.abs(n * 1000 - Math.round(n * 1000)) > 1e-6)
    throw new Error('数量须在 0.001 到 1,000,000 之间，最多三位小数');
  return n;
}

// Stream each selected XML entry with a cap. Do not execute formulas or retain
// signature images; the platform links to the original form in Drive.
async function readEntry(zip, name, budget) {
  const entry = zip.file(name);
  if (!entry) throw new Error('工作簿缺少必要文件');
  const chunks = [];
  await new Promise((resolve, reject) => {
    const stream = entry.nodeStream('nodebuffer');
    stream.on('data', (chunk) => {
      budget.bytes += chunk.length;
      if (budget.bytes > 8 * 1024 * 1024) { stream.destroy(); reject(new Error('工作簿 XML 解压超过 8 MB')); }
      else chunks.push(chunk);
    });
    stream.on('error', reject); stream.on('end', resolve);
  });
  const str = Buffer.concat(chunks).toString('utf8');
  if (/<!DOCTYPE|<!ENTITY/i.test(str)) throw new Error('不支持包含 XML 实体声明的工作簿');
  return xml.parse(str);
}

export async function parseOrderWorkbook(bytes) {
  if (bytes.length > 8 * 1024 * 1024) throw new Error('工作簿超过 8 MB');
  const zip = await JSZip.loadAsync(bytes);
  const budget = { bytes: 0 };
  const workbook = await readEntry(zip, 'xl/workbook.xml', budget);
  const rels = await readEntry(zip, 'xl/_rels/workbook.xml.rels', budget);
  const relation = new Map((rels.Relationships?.Relationship || []).filter(r => r['@_TargetMode'] !== 'External')
    .map(r => [r['@_Id'], r['@_Target']]));
  let strings = [];
  if (zip.file('xl/sharedStrings.xml')) strings = (await readEntry(zip, 'xl/sharedStrings.xml', budget)).sst?.si?.map(text) || [];
  const results = [];
  const sheets = workbook.workbook?.sheets?.sheet || [];
  if (sheets.length > 20) throw new Error('工作表过多，需人工确认');
  for (const s of sheets) {
    if (s['@_state'] === 'hidden' || s['@_state'] === 'veryHidden') continue;
    const target = relation.get(s['@_r:id']);
    if (!target) continue;
    const entry = path.posix.normalize(target.startsWith('/') ? target.slice(1) : 'xl/' + target);
    if (!entry.startsWith('xl/worksheets/') || !entry.endsWith('.xml')) continue;
    const doc = await readEntry(zip, entry, budget);
    const cells = new Map();
    for (const row of doc.worksheet?.sheetData?.row || []) {
      for (const c of row.c || []) {
        const ref = c['@_r'];
        let val = c['@_t'] === 's' ? strings[Number(c.v)] : c['@_t'] === 'inlineStr' ? text(c.is) : text(c.v);
        if (val == null) val = '';
        cells.set(ref, { value: String(val), formula: c.f != null });
      }
    }
    let header;
    for (let r = 1; r <= 20; r++) {
      const cols = {};
      for (const [ref, c] of cells) {
        const m = /^([A-Z]+)(\d+)$/.exec(ref);
        if (Number(m?.[2]) !== r) continue;
        const key = label(c.value);
        if (key === 'itemname') cols.name = m[1];
        if (key === 'qty' || key === 'quantity') cols.qty = m[1];
        if (key === 'link') cols.link = m[1];
        if (key === 'type') cols.type = m[1];
      }
      if (cols.name && cols.qty && cols.link && cols.type) { header = { r, ...cols }; break; }
    }
    if (!header) continue;
    const items = [];
    const get = (col, r) => cells.get(col + r)?.value.trim() || '';
    const relevant = new RegExp('^(?:' + header.name + '|' + header.qty + ')([0-9]+)$');
    const rows = [...new Set([...cells.keys()].map(ref => relevant.exec(ref)?.[1]).filter(Boolean).map(Number))]
      .filter(r => r > header.r).sort((a,b) => a-b);
    let ended = false;
    for (const r of rows) {
      const name = get(header.name, r), q = get(header.qty, r);
      if (!name && !q) continue;
      // HKUST forms have totals/signature blocks after the item table.
      if (/^(total|totalamount|totalcost|subtotal|studentname|signofstudent|approvedby|總計|合計)$/.test(label(name).replace(/[:：]/g,''))) { ended = true; continue; }
      if (ended) {
        if (name && q && Number(q) > 0) throw new Error('商品表后还有数量行，需人工核实，不能静默忽略');
        continue;
      }
      if (!name || !q) throw new Error(`第 ${r} 行商品名或数量缺失，需人工检查`);
      if (name.length > 2000) throw new Error(`第 ${r} 行商品名过长`);
      const link = get(header.link, r);
      const amountCol = ['H', 'I', 'J'].find(c => get(c, r));
      const amount = amountCol ? get(amountCol, r) : '';
      items.push({ sourceRow: r, name, quantity: quantity(q), link: /^https?:\/\//i.test(link) ? link : '',
        type: get(header.type, r), amount, currency: amountCol ? get(amountCol, header.r + 1) : '' });
      if (items.length > 100) throw new Error('商品超过第一版的 100 项上限，请拆分，不能截断导入');
    }
    if (!items.length) continue;
    results.push({ sheetName: s['@_name'], competition: get('C', 3), studentName: get('H', 66), items });
  }
  if (!results.length) return null;
  if (results.length !== 1) throw new Error('多个工作表包含订单，第一版需要分成独立订单文件');
  return { ...results[0], fingerprint: hash(results[0]) };
}
