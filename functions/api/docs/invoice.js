// POST /api/docs/invoice  進貨單補／改發票：{ doc_no, invoice_no, invoice_date, invoice_amount, fx_rate }
// 月結廠商交貨時沒有發票 → 進貨單先入庫，發票到了再來這裡補（Willy 2026-10-10）。
// 任何登入者可改（Willy 製單、阿國核對都會用）；阿國「發票核對完成」後鎖住，不能再改。
// 反向單、作廢、退回的單不能改。送什麼欄位就改什麼（沒送的維持原值）。
import { requireAuth } from '../_lib/auth.js';
import { ok, err, readBody } from '../_lib/json.js';
import { optNum } from '../_lib/util.js';
import { docDate } from '../_lib/docs.js';
import { guiError, poInvoices, reconcileInvoice, normGui } from '../_lib/gui.js';

export async function onRequestPost({ request, env }) {
  const { failed } = requireAuth(request, env);
  if (failed) return failed;
  if (!env.DB) return err('DB binding missing', 500);
  const b = await readBody(request);
  const d = await env.DB.prepare(`SELECT * FROM inv_docs WHERE doc_no = ? AND doc_type = 'receipt'`).bind(String(b.doc_no || '').trim()).first();
  if (!d) return err('找不到進貨單', 404);
  if (d.reverses) return err('反向單不能改發票', 409);
  if (d.status === 'void' || d.status === 'rejected') return err(`這張單狀態是「${d.status}」，不能改`, 409);
  if (d.inv_checked_at) return err(`發票已由 ${d.inv_checked_by} 核對完成，不能再改`, 409);

  const set = [], bind = [];
  // 發票防錯（2026-10-17）：格式＋跟採購總表（阿國）對；no_gui＝無統一發票（國外／淘寶／收據）免格式檢查
  const noGui = 'no_gui' in b ? (b.no_gui ? 1 : 0) : (d.no_gui ? 1 : 0);
  if ('no_gui' in b) { set.push('no_gui=?'); bind.push(noGui); }
  if ('invoice_no' in b) {
    const ge = guiError(b.invoice_no, noGui);
    if (ge) return err(ge, 400, { code: 'gui_format' });
    let v = (noGui ? String(b.invoice_no || '').trim() : normGui(b.invoice_no)) || null;
    if (v) {
      const ids = ((await env.DB.prepare(`SELECT po_line_id FROM inv_doc_lines WHERE doc_id = ?`).bind(d.id).all()).results || []).map((x) => x.po_line_id);
      const inv = reconcileInvoice(v, await poInvoices(env, ids), noGui);
      if (inv.error) return err(inv.error, 409, { code: inv.code, po_invoice: inv.po_invoice });
      v = inv.invoice;
    }
    set.push('invoice_no=?'); bind.push(v);
  }
  if ('invoice_date' in b) { set.push('invoice_date=?'); bind.push(b.invoice_date ? docDate(b.invoice_date) : null); }
  if ('invoice_amount' in b) {
    const v = optNum(b.invoice_amount);
    if (Number.isNaN(v)) return err('發票未稅金額要是數字');
    set.push('invoice_amount=?'); bind.push(v);
  }
  if ('fx_rate' in b && d.currency !== 'NTD') {
    const v = optNum(b.fx_rate);
    if (Number.isNaN(v) || (v != null && v <= 0)) return err('匯率要是大於 0 的數字');
    set.push('fx_rate=?'); bind.push(v);
  }
  if (!set.length) return err('沒有要改的欄位');
  await env.DB.prepare(`UPDATE inv_docs SET ${set.join(', ')} WHERE id = ?`).bind(...bind, d.id).run();
  return ok({ doc_no: d.doc_no });
}
