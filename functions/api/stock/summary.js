// GET /api/stock/summary  總表上方數字卡＋右側「近期單據」用（唯讀）
// 庫存數字（料號數、借出）前端從 stock/list 自己算，這裡只給單據相關的。
import { requireAuth } from '../_lib/auth.js';
import { ok, err } from '../_lib/json.js';

export async function onRequestGet({ request, env }) {
  const { failed } = requireAuth(request, env);
  if (failed) return failed;
  if (!env.DB) return err('DB binding missing', 500);
  // 近 7 天以台灣日期算（doc_date 存的是台灣日期 YYYY-MM-DD）
  const tw = new Date(Date.now() + 8 * 3600e3 - 6 * 86400e3).toISOString().slice(0, 10);
  const [pend, week, recent] = await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM inv_docs WHERE doc_type = 'receipt' AND status = 'pending'`),
    env.DB.prepare(`SELECT doc_type, COUNT(*) AS n FROM inv_docs WHERE status = 'posted' AND doc_date >= ? GROUP BY doc_type`).bind(tw),
    env.DB.prepare(
      `SELECT d.doc_no, d.doc_type, d.doc_date, d.status, d.vendor, d.project_no, d.reverses, d.created_by,
              (SELECT COUNT(*) FROM inv_doc_lines l WHERE l.doc_id = d.id) AS line_count,
              (SELECT SUM(qty) FROM inv_doc_lines l WHERE l.doc_id = d.id) AS qty_total
       FROM inv_docs d ORDER BY d.id DESC LIMIT 12`),
  ]);
  const w = {};
  for (const r of week.results || []) w[r.doc_type] = r.n;
  return ok({
    pending_receipts: pend.results?.[0]?.n || 0,
    week_from: tw,
    week: { receipt: w.receipt || 0, issue: w.issue || 0, transfer: w.transfer || 0 },
    recent: recent.results || [],
  });
}
