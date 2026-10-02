// POST /api/docs/reverse  反向單（沖銷）：{ doc_no, note }
// 已過帳的單不作廢（Chris 2026-10-02：用反向單）。整張沖：每列數量取負、同倉同料、同採購明細，
// 一張原單只能沖一次；反向單本身不能再沖。單號 RV＋日期＋流水，doc_type 沿用原單（查詢/統計自然抵銷）。
// 權限：進貨單的沖銷只限採購（阿國），因為它會改「已入庫量」；領料／調撥任何登入者都可。
// 庫存不夠沖（例：進貨後已被領走）→ 整張不過帳（409）。
import { requireAuth } from '../_lib/auth.js';
import { ok, err, readBody } from '../_lib/json.js';
import { gateEmails } from '../_lib/util.js';
import { createDoc, docDate, REVERSE_PREFIX } from '../_lib/docs.js';

export async function onRequestPost({ request, env }) {
  const { user, failed } = requireAuth(request, env);
  if (failed) return failed;
  if (!env.DB) return err('DB binding missing', 500);
  const b = await readBody(request);
  const reason = String(b.note || '').trim();
  if (!reason) return err('請寫沖銷原因');
  const d = await env.DB.prepare(`SELECT * FROM inv_docs WHERE doc_no = ?`).bind(String(b.doc_no || '')).first();
  if (!d) return err('找不到單據', 404);
  if (d.status !== 'posted') return err('只有「已過帳」的單需要反向單；未過帳的請直接作廢', 409);
  if (d.reverses) return err('這張本身就是反向單，不能再沖', 409);
  if (d.reversed_by) return err(`這張已經被 ${d.reversed_by} 沖銷過`, 409);
  if (d.doc_type === 'receipt' && !(user.via === 'cf-access' && gateEmails(env).includes(String(user.email).toLowerCase()))) {
    return err('進貨單的沖銷只限採購（阿國）', 403);
  }
  const src = (await env.DB.prepare(`SELECT * FROM inv_doc_lines WHERE doc_id = ? ORDER BY seq`).bind(d.id).all()).results || [];
  const lines = src.map((l) => ({
    part_no: l.part_no, name: l.name, qty: -Number(l.qty), wh_code: l.wh_code, to_wh: l.to_wh,
    po_line_id: l.po_line_id, po_no: l.po_no, unit_price: l.unit_price,
    amount: l.amount == null ? null : -Number(l.amount), note: l.note,
  }));
  try {
    const { docNo } = await createDoc(env, d.doc_type, {
      doc_date: docDate(b.doc_date), status: 'draft', vendor: d.vendor, invoice_no: d.invoice_no,
      invoice_amount: d.invoice_amount == null ? null : -Number(d.invoice_amount), project_no: d.project_no,
      note: `沖銷 ${d.doc_no}：${reason}`, reverses: d.doc_no,
    }, lines, {
      post: true, email: user.email, project: d.project_no, invoiceNo: d.invoice_no, prefix: REVERSE_PREFIX,
      extra: [(no) => env.DB.prepare(`UPDATE inv_docs SET reversed_by = ? WHERE id = ? AND reversed_by IS NULL`).bind(no, d.id)],
    });
    return ok({ doc_no: docNo, reverses: d.doc_no });
  } catch (e) {
    if (e.code === 'insufficient') return err('庫存不夠沖銷（可能已被領走或調走），整張未過帳', 409, { code: 'insufficient' });
    throw e;
  }
}
