const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const JSZip = require('jszip');
const root = path.resolve(__dirname, '..');
const template = fs.readFileSync(path.join(root, 'template.xlsx'));
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lp8AAAAASUVORK5CYII=';
function environment() { const dom = new JSDOM(''); return { dom, env: { JSZip, TextDecoder, DOMParser: dom.window.DOMParser, XMLSerializer: dom.window.XMLSerializer } }; }
function replace(xml, ref, text, number = false) {
  const cell = number ? `<c r="${ref}" s="34"><v>${text}</v></c>` : `<c r="${ref}" s="32" t="inlineStr"><is><t>${String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</t></is></c>`;
  return xml.replace(new RegExp(`<c r="${ref}"[^>]*/>|<c r="${ref}"[^>]*>[\\s\\S]*?</c>`), cell);
}
async function fixture(options = {}) {
  const zip = await JSZip.loadAsync(template);
  let xml = await zip.file('xl/worksheets/sheet1.xml').async('string');
  for (const [ref, text, number] of [ ['C3','Import TEST'], ['H66','Fictional Student'],
    ['C11', options.hostile ? '<img src=x onerror=alert(1)>' : 'Test Motor'], ['F11',4,true], ['H11',100,true], ['G11','EE_Motor/ESC related'], ['D11','Online'], ['E11','https://example.com/motor'], ['B11',46000,true], ['K11','Approved'],
    ['C12','Test Cable'], ['F12',3,true], ['I12',60,true], ['G12','Custom category'], ['D12','Shop'], ['E12','https://example.com/cable'], ['B12',46001,true], ['K12','Approved'] ]) xml = replace(xml, ref, text, number);
  if (options.invalidQuantity) xml = replace(xml, 'F11', -1, true);
  if (options.multipleCurrencies) xml = replace(xml, 'I11', 25, true);
  if (options.extraRows) { xml = replace(xml, 'C41', 'Extra item'); xml = replace(xml, 'F41', 1, true); xml = replace(xml, 'G41', 'Others'); }
  if (options.entity) xml = xml.replace('<worksheet ', '<!DOCTYPE worksheet [<!ENTITY x "test">]><worksheet ');
  zip.file('xl/worksheets/sheet1.xml', xml);
  zip.file('customXml/preserve.xml', '<test>Keep this original data</test>');
  if (options.inline) {
    const h = environment(), stringsDoc = new h.env.DOMParser().parseFromString(await zip.file('xl/sharedStrings.xml').async('string'), 'application/xml');
    const strings = [...stringsDoc.getElementsByTagName('si')].map(node => [...node.getElementsByTagName('t')].map(t => t.textContent).join(''));
    xml = xml.replace(/<c ([^>]*?)t="s"([^>]*)><v>(\d+)<\/v><\/c>/g, (_,a,b,n) => `<c ${a}t="inlineStr"${b}><is><t>${strings[n].replace(/&/g,'&amp;').replace(/</g,'&lt;')}</t></is></c>`);
    zip.file('xl/worksheets/sheet1.xml', xml); zip.remove('xl/sharedStrings.xml'); h.dom.window.close();
  }
  if (options.renameSheet) {
    zip.file('xl/worksheets/order.xml', await zip.file('xl/worksheets/sheet1.xml').async('string')); zip.remove('xl/worksheets/sheet1.xml');
    if (zip.file('xl/worksheets/_rels/sheet1.xml.rels')) { zip.file('xl/worksheets/_rels/order.xml.rels', await zip.file('xl/worksheets/_rels/sheet1.xml.rels').async('string')); zip.remove('xl/worksheets/_rels/sheet1.xml.rels'); }
    zip.file('xl/_rels/workbook.xml.rels', (await zip.file('xl/_rels/workbook.xml.rels').async('string')).replace('worksheets/sheet1.xml','worksheets/order.xml'));
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports={fixture,environment,png};
