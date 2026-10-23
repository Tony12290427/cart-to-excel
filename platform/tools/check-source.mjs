// Read-only importer verification. Input is a downloaded XLSX; output contains
// only structural counts, never student names, signatures or product details.
import { readFile } from 'node:fs/promises';
import { parseOrderWorkbook } from '../lib/parser.js';
const parsed = await parseOrderWorkbook(await readFile(process.argv[2]));
console.log(JSON.stringify({ recognized: !!parsed, itemCount: parsed?.items.length || 0,
  allQuantitiesValid: parsed?.items.every(i => Number.isFinite(i.quantity) && i.quantity > 0) || false }));
