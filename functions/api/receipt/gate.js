// POST /api/receipt/gate  進料門檻：阿國對完「廠商發票 vs 採購單金額」→ 一致才標 ok，該列才能入庫
// body: { po_line_id, invoice_no, invoice_amount }
// ⚠ 只有 GATE_EMAILS（預設阿國）能確認；X-Admin-Token（script）不可，避免繞過人工核對。
import { requireAuth } from '../_lib/auth.js';
import { ok, err, readBody } from '../_lib/json.js';
import { nowIso, AMOUNT_TOL, gateEmails } from '../_lib/util.js';

export async function onRequestPost({ request, env }) {
  const { user, failed } = requireAuth(request, env);
  if (failed) return failed;
  if (!env.DB) return err('DB binding missing', 500);
  if (user.via !== 'cf-access' || !gateEmails(env).includes(String(user.email).toLowerCase())) {
    return err('只有採購（阿國）能確認發票金額', 403);
  }
  const b = await readBody(request);
  const lineId = Number(b.po_line_id);
  const invoiceNo = String(b.invoice_no || '').trim();
  const invAmt = Number(b.invoice_amount);
  if (!lineId || !invoiceNo || !Number.isFinite(invAmt)) return err('po_line_id / invoice_no / invoice_amount 必填');

  const line = await env.DB.prepare(
    `SELECT id, amount, invoice_no FROM purchase_lines WHERE id = ?`
  ).bind(lineId).first();
  if (!line) return err('找不到採購明細', 404);

  const poAmt = Number(line.amount) || 0;
  const status = Math.abs(invAmt - poAmt) <= AMOUNT_TOL ? 'ok' : 'mismatch';
  await env.DB.prepare(
    `INSERT INTO inv_receipt_gate (po_line_id, invoice_no, invoice_amount, po_amount, status, checked_by, checked_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(po_line_id) DO UPDATE SET invoice_no=excluded.invoice_no, invoice_amount=excluded.invoice_amount,
       po_amount=excluded.po_amount, status=excluded.status, checked_by=excluded.checked_by, checked_at=excluded.checked_at`
  ).bind(lineId, invoiceNo, invAmt, poAmt, status, user.email, nowIso()).run();
  return ok({ po_line_id: lineId, status, po_amount: poAmt, invoice_amount: invAmt });
}
