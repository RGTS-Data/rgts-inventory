// 採購明細的「已入庫（已過帳）」與「待核對（進貨單還沒過帳）」數量
import { chunk } from './util.js';
export async function receivedMap(env, ids) {
  const m = new Map();
  const get = (id) => m.get(id) || (m.set(id, { posted: 0, pending: 0 }), m.get(id));
  for (const c of chunk([...new Set(ids)].filter(Boolean))) {
    const ph = c.map(() => '?').join(',');
    for (const x of (await env.DB.prepare(
      `SELECT po_line_id, SUM(qty_delta) s FROM inv_moves WHERE type='receipt' AND po_line_id IN (${ph}) GROUP BY po_line_id`
    ).bind(...c).all()).results || []) get(x.po_line_id).posted = Number(x.s) || 0;
    for (const x of (await env.DB.prepare(
      `SELECT l.po_line_id, SUM(l.qty) s FROM inv_doc_lines l JOIN inv_docs d ON d.id = l.doc_id
       WHERE d.doc_type='receipt' AND d.status='pending' AND l.po_line_id IN (${ph}) GROUP BY l.po_line_id`
    ).bind(...c).all()).results || []) get(x.po_line_id).pending = Number(x.s) || 0;
  }
  return m;
}
