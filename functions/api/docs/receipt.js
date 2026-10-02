// POST /api/docs/receipt  建立進貨單（Willy）→ 狀態「待核對」，**還不進庫存**
// body: { doc_date, vendor, invoice_no, invoice_amount(未稅), note, lines:[{po_line_id, qty, wh_code, note}] }
// 照正航：進貨單從採購單帶入、發票號碼在表頭、一張可含多張採購單的明細（同一廠商）。
// 門檻（Chris 2026-10-01）：阿國在 /api/docs/check 核對「發票金額＝採購金額」後才過帳入庫。
import { requireAuth } from '../_lib/auth.js';
import { ok, err, readBody } from '../_lib/json.js';
import { chunk } from '../_lib/util.js';
import { createDoc, docDate, parseLines } from '../_lib/docs.js';
import { receivedMap } from '../_lib/receipt-qty.js';

export async function onRequestPost({ request, env }) {
  const { user, failed } = requireAuth(request, env);
  if (failed) return failed;
  if (!env.DB) return err('DB binding missing', 500);
  const b = await readBody(request);
  const lines = parseLines(b.lines).filter((l) => l.po_line_id && l.qty > 0);
  const invoiceNo = String(b.invoice_no || '').trim();
  const invAmt = Number(String(b.invoice_amount ?? '').replace(/,/g, ''));
  if (!lines.length) return err('至少要有一列（勾選採購明細並填數量）');
  if (lines.length > 80) return err('一張單最多 80 列');
  if (!invoiceNo) return err('發票號碼必填');
  if (!Number.isFinite(invAmt)) return err('發票未稅金額必填');

  const ids = lines.map((l) => l.po_line_id);
  const po = new Map();
  for (const c of chunk(ids)) {
    for (const x of (await env.DB.prepare(
      `SELECT l.id, l.part_no, l.name, l.qty, l.unit_price, o.po_no, o.vendor
       FROM purchase_lines l JOIN purchase_orders o ON o.id = l.po_id WHERE l.id IN (${c.map(() => '?').join(',')})`
    ).bind(...c).all()).results || []) po.set(x.id, x);
  }
  const vendors = new Set();
  const recv = await receivedMap(env, ids);
  for (const l of lines) {
    const p = po.get(l.po_line_id);
    if (!p) return err(`找不到採購明細 #${l.po_line_id}`, 404);
    if (!String(p.part_no || '').trim()) return err(`採購明細 #${l.po_line_id} 沒有料號`, 422);
    vendors.add(p.vendor);
    const r = recv.get(l.po_line_id) || { posted: 0, pending: 0 };
    const left = (Number(p.qty) || 0) - r.posted - r.pending;
    if (l.qty > left + 1e-9) return err(`超收：${p.po_no} ${p.part_no} 採購 ${p.qty}、已入 ${r.posted}、待核對 ${r.pending}、本次 ${l.qty}`, 409, { code: 'over_receive' });
    Object.assign(l, {
      part_no: String(p.part_no).trim().toUpperCase(), name: p.name, po_no: p.po_no,
      unit_price: p.unit_price, amount: Math.round((Number(p.unit_price) || 0) * l.qty * 100) / 100,
      wh_code: l.wh_code || 'Z',
    });
  }
  if (vendors.size > 1) return err('一張進貨單只能同一家廠商：' + [...vendors].join('、'));
  const { docNo } = await createDoc(env, 'receipt', {
    doc_date: docDate(b.doc_date), status: 'pending', vendor: [...vendors][0],
    invoice_no: invoiceNo, invoice_amount: invAmt, note: b.note ? String(b.note) : null,
  }, lines, { email: user.email });
  const total = lines.reduce((s, l) => s + l.amount, 0);
  return ok({ doc_no: docNo, status: 'pending', po_amount: Math.round(total * 100) / 100, invoice_amount: invAmt });
}
