// POST /api/docs/check  進貨單核對（只有採購 GATE_EMAILS＝阿國）
// body: { doc_no, action: 'approve' | 'reject', note }
// approve：發票未稅金額 vs 採購金額（Σ 單價×數量）差 ≤ 1 元才放行 → 過帳入庫；差太多直接擋（Chris：確定一致才可入）。
import { requireAuth } from '../_lib/auth.js';
import { ok, err, readBody } from '../_lib/json.js';
import { nowIso, AMOUNT_TOL, gateEmails } from '../_lib/util.js';
import { postStmts } from '../_lib/docs.js';
import { receivedMap } from '../_lib/receipt-qty.js';

export async function onRequestPost({ request, env }) {
  const { user, failed } = requireAuth(request, env);
  if (failed) return failed;
  if (!env.DB) return err('DB binding missing', 500);
  if (user.via !== 'cf-access' || !gateEmails(env).includes(String(user.email).toLowerCase())) {
    return err('只有採購（阿國）能核對進貨單', 403);
  }
  const b = await readBody(request);
  const docNo = String(b.doc_no || '').trim();
  const d = await env.DB.prepare(`SELECT * FROM inv_docs WHERE doc_no = ? AND doc_type = 'receipt'`).bind(docNo).first();
  if (!d) return err('找不到進貨單', 404);
  if (d.status !== 'pending') return err(`這張單狀態是「${d.status}」，不能核對`, 409);
  const lines = (await env.DB.prepare(`SELECT * FROM inv_doc_lines WHERE doc_id = ? ORDER BY seq`).bind(d.id).all()).results || [];
  const poAmt = Math.round(lines.reduce((s, l) => s + (Number(l.amount) || 0), 0) * 100) / 100;

  if (b.action === 'reject') {
    await env.DB.prepare(`UPDATE inv_docs SET status='rejected', checked_by=?, checked_at=?, check_note=? WHERE id=?`)
      .bind(user.email, nowIso(), String(b.note || ''), d.id).run();
    return ok({ doc_no: docNo, status: 'rejected' });
  }
  if (b.action !== 'approve') return err('action 要是 approve 或 reject');
  if (Math.abs((Number(d.invoice_amount) || 0) - poAmt) > AMOUNT_TOL) {
    return err(`金額不符：發票 ${d.invoice_amount}、採購 ${poAmt}（差 ${Math.round((d.invoice_amount - poAmt) * 100) / 100}）→ 不能入庫，請退回修正`, 409,
      { code: 'amount_mismatch', invoice_amount: d.invoice_amount, po_amount: poAmt });
  }
  // 過帳前再檢查一次超收（建單後可能有別張單先過帳）
  const recv = await receivedMap(env, lines.map((l) => l.po_line_id));
  for (const l of lines) {
    if (!l.po_line_id) continue;
    const po = await env.DB.prepare(`SELECT qty FROM purchase_lines WHERE id = ?`).bind(l.po_line_id).first();
    const r = recv.get(l.po_line_id) || { posted: 0 };
    if (r.posted + Number(l.qty) > (Number(po?.qty) || 0) + 1e-9) return err(`超收：${l.po_no} ${l.part_no} 已入 ${r.posted}、本單 ${l.qty}、採購 ${po?.qty}`, 409);
  }
  const stmts = [env.DB.prepare(`UPDATE inv_docs SET checked_by=?, checked_at=?, check_note=? WHERE id=?`)
    .bind(user.email, nowIso(), String(b.note || ''), d.id)];
  stmts.push(...postStmts(env, { type: 'receipt', docNo, invoiceNo: d.invoice_no, email: user.email, lines }));
  await env.DB.batch(stmts);
  return ok({ doc_no: docNo, status: 'posted', po_amount: poAmt, writeback: env.INV_WRITEBACK === '1' ? 'enabled-but-not-implemented' : 'disabled' });
}
