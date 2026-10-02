// GET /api/part/detail?part=  料號查詢（正航：訂單查詢「物料在各專案的需求與領用」＋銷貨單「各物料領料紀錄」）
// 回：各倉庫存、各專案 BOM 需求/已領/未領、未進完的採購明細、最近單據異動
import { requireAuth } from '../_lib/auth.js';
import { ok, err } from '../_lib/json.js';
import { normPart } from '../_lib/util.js';
import { receivedMap } from '../_lib/receipt-qty.js';

export async function onRequestGet({ request, env }) {
  const { failed } = requireAuth(request, env);
  if (failed) return failed;
  if (!env.DB) return err('DB binding missing', 500);
  const part = normPart(new URL(request.url).searchParams.get('part'));
  if (!part) return err('料號必填');

  const stock = (await env.DB.prepare(
    `SELECT wh_code, wh_name, name, unit, qty, borrow_in, borrow_out, location, location_by, location_at, updated_at FROM inv_stock WHERE part_no = ? ORDER BY wh_code`
  ).bind(part).all()).results || [];

  // 各專案需求：現行 BOM（同一專案同料號多列 → 加總；劃線不算；總量沒填用單量×台數）
  const bom = (await env.DB.prepare(
    `SELECT p.project_no, p.model, p.units, p.status AS bom_status,
            SUM(CASE WHEN COALESCE(i.qty_total,0) > 0 THEN i.qty_total ELSE COALESCE(i.qty_per,0) * COALESCE(p.units,0) END) AS need
     FROM bom_items i JOIN bom_projects p ON p.id = i.project_id
     WHERE UPPER(TRIM(i.part_no)) = ? AND p.is_current = 1 AND COALESCE(i.is_struck,0) = 0
     GROUP BY p.id HAVING need > 0 ORDER BY p.project_no DESC LIMIT 300`
  ).bind(part).all()).results || [];
  const issued = new Map();
  for (const x of (await env.DB.prepare(
    `SELECT project_no, -SUM(qty_delta) q FROM inv_moves WHERE type='issue' AND part_no = ? GROUP BY project_no`
  ).bind(part).all()).results || []) issued.set(String(x.project_no || '').toUpperCase(), Number(x.q) || 0);
  const projects = bom.map((x) => {
    const iss = issued.get(String(x.project_no).toUpperCase()) || 0;
    return { ...x, issued: iss, remaining: Math.max(0, Math.round((x.need - iss) * 1e6) / 1e6) };
  });

  // 採購：未進完的明細
  const pl = (await env.DB.prepare(
    `SELECT l.id, o.po_no, o.vendor, o.order_date, l.qty, l.unit_price, l.need_date, l.vendor_eta, l.project_no, l.arrival_date
     FROM purchase_lines l JOIN purchase_orders o ON o.id = l.po_id
     WHERE UPPER(TRIM(l.part_no)) = ? ORDER BY o.order_date DESC LIMIT 100`
  ).bind(part).all()).results || [];
  const recv = await receivedMap(env, pl.map((x) => x.id));
  const purchases = pl.map((x) => {
    const r = recv.get(x.id) || { posted: 0, pending: 0 };
    return { ...x, received: r.posted, pending: r.pending, open: Math.max(0, (Number(x.qty) || 0) - r.posted) };
  });

  const moves = (await env.DB.prepare(
    `SELECT m.ts, m.type, m.wh_code, m.qty_delta, m.qty_after, m.project_no, m.note, m.created_by, d.doc_no, d.doc_date, d.reverses
     FROM inv_moves m LEFT JOIN inv_docs d ON d.id = m.doc_id
     WHERE m.part_no = ? ORDER BY m.id DESC LIMIT 200`
  ).bind(part).all()).results || [];

  return ok({ part_no: part, stock, projects, purchases, moves });
}
