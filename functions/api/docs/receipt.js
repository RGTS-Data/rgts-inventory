// POST /api/docs/receipt  建立進貨單（Willy）→ 狀態「待核對」，**還不進庫存**
// body: { doc_date, invoice_no?, invoice_date?, invoice_amount?(未稅), fx_rate?, note, lines:[{po_line_id, qty, wh_code, note}] }
// 照正航：進貨單從採購單帶入、一張可含多張採購單的明細（同一廠商、同一幣別）。
// 2026-10-10（Willy 回饋，Chris 選「先入庫，發票之後補」）：
//  - 發票號碼／日期／金額都改**選填**：很多廠商（國倫）月結整批開，交貨時沒有發票 → 之後在單據頁補（/api/docs/invoice）。
//  - 阿國按「確認收貨」就入庫（/api/docs/check approve）；發票金額核對另外一步（invoice_ok），不再擋入庫。
//  - 幣別取自採購明細（一張單一種）；匯率依廠商發票輸入，NTD 固定 1。
//  - 運費這種沒料號的採購列可以勾：算進採購金額（好跟發票總額對），過帳不動庫存。
import { requireAuth } from '../_lib/auth.js';
import { ok, err, readBody } from '../_lib/json.js';
import { chunk, normCur, optNum } from '../_lib/util.js';
import { createDoc, docDate, parseLines } from '../_lib/docs.js';
import { receivedMap } from '../_lib/receipt-qty.js';

export async function onRequestPost({ request, env }) {
  const { user, failed } = requireAuth(request, env);
  if (failed) return failed;
  if (!env.DB) return err('DB binding missing', 500);
  const b = await readBody(request);
  const lines = parseLines(b.lines).filter((l) => l.po_line_id && l.qty > 0);
  const invoiceNo = String(b.invoice_no || '').trim() || null;
  const invAmt = optNum(b.invoice_amount);
  const fx = optNum(b.fx_rate);
  if (!lines.length) return err('至少要有一列（勾選採購明細並填數量）');
  if (lines.length > 80) return err('一張單最多 80 列');
  if (Number.isNaN(invAmt)) return err('發票未稅金額要是數字（沒有發票就留空）');
  if (Number.isNaN(fx) || (fx != null && fx <= 0)) return err('匯率要是大於 0 的數字（還不知道就留空）');
  const invDate = b.invoice_date ? docDate(b.invoice_date) : null;

  const ids = lines.map((l) => l.po_line_id);
  const po = new Map();
  for (const c of chunk(ids)) {
    for (const x of (await env.DB.prepare(
      `SELECT l.id, l.part_no, l.name, l.spec, l.qty, l.unit_price, l.currency, o.po_no, o.vendor
       FROM purchase_lines l JOIN purchase_orders o ON o.id = l.po_id WHERE l.id IN (${c.map(() => '?').join(',')})`
    ).bind(...c).all()).results || []) po.set(x.id, x);
  }
  const vendors = new Set(), curs = new Set();
  const recv = await receivedMap(env, ids);
  for (const l of lines) {
    const p = po.get(l.po_line_id);
    if (!p) return err(`找不到採購明細 #${l.po_line_id}`, 404);
    vendors.add(p.vendor);
    curs.add(normCur(p.currency));
    const r = recv.get(l.po_line_id) || { posted: 0, pending: 0 };
    const left = (Number(p.qty) || 0) - r.posted - r.pending;
    const part = String(p.part_no || '').trim().toUpperCase();
    if (l.qty > left + 1e-9) return err(`超收：${p.po_no} ${part || p.name || p.spec || '(無料號)'} 採購 ${p.qty}、已入 ${r.posted}、待核對 ${r.pending}、本次 ${l.qty}`, 409, { code: 'over_receive' });
    Object.assign(l, {
      part_no: part || null,                              // 沒料號＝運費等，過帳不動庫存
      name: p.name || p.spec || null, po_no: p.po_no,
      unit_price: p.unit_price, amount: Math.round((Number(p.unit_price) || 0) * l.qty * 100) / 100,
      wh_code: part ? (l.wh_code || 'Z') : null,
    });
  }
  if (vendors.size > 1) return err('一張進貨單只能同一家廠商：' + [...vendors].join('、'));
  if (curs.size > 1) return err('一張進貨單只能同一種幣別：' + [...curs].join('、'));
  const currency = [...curs][0];
  const { docNo } = await createDoc(env, 'receipt', {
    doc_date: docDate(b.doc_date), status: 'pending', vendor: [...vendors][0],
    invoice_no: invoiceNo, invoice_amount: invAmt, invoice_date: invDate,
    currency, fx_rate: currency === 'NTD' ? 1 : fx, note: b.note ? String(b.note) : null,
  }, lines, { email: user.email });
  const total = lines.reduce((s, l) => s + l.amount, 0);
  return ok({ doc_no: docNo, status: 'pending', currency, po_amount: Math.round(total * 100) / 100, invoice_amount: invAmt });
}
