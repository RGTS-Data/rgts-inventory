// POST /api/docs/check  進貨單核對（只有採購 GATE_EMAILS＝阿國）
// body: { doc_no, action: 'approve' | 'reject' | 'invoice_ok', note }
// 2026-10-10 起拆成兩段（Willy 回饋，Chris 選「先入庫，發票之後補」）：
//   approve    ＝ 確認收貨 → 過帳入庫。**不再要求發票**（月結廠商交貨時沒有發票）。
//   invoice_ok ＝ 發票核對完成：發票號碼＋未稅金額都要有，且與採購金額（原幣）差 ≤ 1 才能標記。
//   reject     ＝ 退回（只有還沒入庫的才能退；已入庫要退請開反向單）。
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
  const lines = (await env.DB.prepare(`SELECT * FROM inv_doc_lines WHERE doc_id = ? ORDER BY seq`).bind(d.id).all()).results || [];
  const poAmt = Math.round(lines.reduce((s, l) => s + (Number(l.amount) || 0), 0) * 100) / 100;
  const note = String(b.note || '');

  if (b.action === 'invoice_ok') {
    if (d.reverses) return err('反向單不用核對發票', 409);
    if (d.status === 'void' || d.status === 'rejected') return err(`這張單狀態是「${d.status}」`, 409);
    if (d.inv_checked_at) return err(`發票已由 ${d.inv_checked_by} 核對過`, 409);
    if (!d.invoice_no || d.invoice_amount == null) return err('還沒填發票號碼或發票未稅金額，請先補發票', 409, { code: 'no_invoice' });
    const diff = Math.round((Number(d.invoice_amount) - poAmt) * 100) / 100;
    if (Math.abs(diff) > AMOUNT_TOL) {
      return err(`金額不符：發票 ${d.invoice_amount}、採購 ${poAmt}（${d.currency || ''} 差 ${diff}）→ 請先修正發票金額或跟廠商確認`, 409,
        { code: 'amount_mismatch', invoice_amount: d.invoice_amount, po_amount: poAmt });
    }
    await env.DB.prepare(`UPDATE inv_docs SET inv_checked_by=?, inv_checked_at=?, inv_check_note=? WHERE id=?`)
      .bind(user.email, nowIso(), note, d.id).run();
    return ok({ doc_no: docNo, invoice_checked: true, po_amount: poAmt });
  }

  if (d.status !== 'pending') return err(`這張單狀態是「${d.status}」，不能${b.action === 'reject' ? '退回' : '確認收貨'}`, 409);
  if (b.action === 'reject') {
    await env.DB.prepare(`UPDATE inv_docs SET status='rejected', checked_by=?, checked_at=?, check_note=? WHERE id=?`)
      .bind(user.email, nowIso(), note, d.id).run();
    return ok({ doc_no: docNo, status: 'rejected' });
  }
  if (b.action !== 'approve') return err('action 要是 approve、reject 或 invoice_ok');
  // 過帳前再檢查一次超收（建單後可能有別張單先過帳）
  const recv = await receivedMap(env, lines.map((l) => l.po_line_id));
  for (const l of lines) {
    if (!l.po_line_id) continue;
    const po = await env.DB.prepare(`SELECT qty FROM purchase_lines WHERE id = ?`).bind(l.po_line_id).first();
    const r = recv.get(l.po_line_id) || { posted: 0 };
    if (r.posted + Number(l.qty) > (Number(po?.qty) || 0) + 1e-9) return err(`超收：${l.po_no} ${l.part_no || l.name || ''} 已入 ${r.posted}、本單 ${l.qty}、採購 ${po?.qty}`, 409);
  }
  const stmts = [env.DB.prepare(`UPDATE inv_docs SET checked_by=?, checked_at=?, check_note=? WHERE id=?`)
    .bind(user.email, nowIso(), note, d.id)];
  stmts.push(...postStmts(env, { type: 'receipt', docNo, invoiceNo: d.invoice_no, email: user.email, lines }));
  await env.DB.batch(stmts);
  return ok({ doc_no: docNo, status: 'posted', po_amount: poAmt, has_invoice: !!d.invoice_no,
    writeback: env.INV_WRITEBACK === '1' ? 'enabled-but-not-implemented' : 'disabled' });
}
