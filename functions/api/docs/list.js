// GET /api/docs/list?type=&status=&q=&from=&to=  單據清單（q 比對單號／廠商／發票／專案／明細料號）
import { requireAuth } from '../_lib/auth.js';
import { ok, err } from '../_lib/json.js';
import { gateEmails } from '../_lib/util.js';

export async function onRequestGet({ request, env }) {
  const { user, failed } = requireAuth(request, env);
  if (failed) return failed;
  if (!env.DB) return err('DB binding missing', 500);
  const u = new URL(request.url);
  const w = [], b = [];
  const p = (k) => (u.searchParams.get(k) || '').trim();
  if (p('type')) { w.push('d.doc_type = ?'); b.push(p('type')); }
  if (p('status')) { w.push('d.status = ?'); b.push(p('status')); }
  if (p('from')) { w.push('d.doc_date >= ?'); b.push(p('from')); }
  if (p('to')) { w.push('d.doc_date <= ?'); b.push(p('to')); }
  if (p('q')) {
    const q = `%${p('q')}%`;
    w.push(`(d.doc_no LIKE ? OR d.vendor LIKE ? OR d.invoice_no LIKE ? OR d.project_no LIKE ?
           OR EXISTS (SELECT 1 FROM inv_doc_lines l WHERE l.doc_id = d.id AND (l.part_no LIKE ? OR l.po_no LIKE ?)))`);
    b.push(q, q, q, q, q, q);
  }
  const r = await env.DB.prepare(
    `SELECT d.*, (SELECT COUNT(*) FROM inv_doc_lines l WHERE l.doc_id = d.id) AS line_count,
            (SELECT SUM(qty) FROM inv_doc_lines l WHERE l.doc_id = d.id) AS qty_total,
            (SELECT SUM(amount) FROM inv_doc_lines l WHERE l.doc_id = d.id) AS amount_total
     FROM inv_docs d ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY d.id DESC LIMIT 500`
  ).bind(...b).all();
  const canCheck = user.via === 'cf-access' && gateEmails(env).includes(String(user.email).toLowerCase());
  return ok({ rows: r.results || [], can_check: canCheck });
}
