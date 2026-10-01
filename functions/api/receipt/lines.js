// GET /api/receipt/lines?q=&all=1  進料用：查採購明細（採購單號/料號/廠商/專案），附「已入庫量」與「發票核對狀態」
// 預設只列「還沒入滿」的；all=1 連已入滿的一起列。唯讀 purchase_*。
import { requireAuth } from '../_lib/auth.js';
import { ok, err } from '../_lib/json.js';
import { chunk, gateEmails } from '../_lib/util.js';

export async function onRequestGet({ request, env }) {
  const { user, failed } = requireAuth(request, env);
  if (failed) return failed;
  if (!env.DB) return err('DB binding missing', 500);
  const u = new URL(request.url);
  const q = (u.searchParams.get('q') || '').trim();
  const all = u.searchParams.get('all') === '1';
  if (q.length < 2) return err('請輸入至少 2 個字（採購單號／料號／廠商／專案）');
  const like = `%${q}%`;
  const r = await env.DB.prepare(
    `SELECT l.id, l.po_id, o.po_no, o.vendor, o.order_date, l.part_no, l.name, l.spec, l.qty, l.unit_price,
            l.amount, l.currency, l.invoice_no, l.arrival_date, l.project_no
     FROM purchase_lines l JOIN purchase_orders o ON o.id = l.po_id
     WHERE (o.po_no LIKE ? OR l.part_no LIKE ? OR o.vendor LIKE ? OR l.project_no LIKE ?)
       AND COALESCE(l.part_no,'') <> ''
     ORDER BY o.order_date DESC, l.id DESC LIMIT 300`
  ).bind(like, like, like, like).all();
  const lines = r.results || [];
  const ids = lines.map((x) => x.id);
  const recv = new Map(), gate = new Map();
  for (const c of chunk(ids)) {
    const ph = c.map(() => '?').join(',');
    for (const x of (await env.DB.prepare(
      `SELECT po_line_id, SUM(qty_delta) s FROM inv_moves WHERE type='receipt' AND po_line_id IN (${ph}) GROUP BY po_line_id`
    ).bind(...c).all()).results || []) recv.set(x.po_line_id, Number(x.s) || 0);
    for (const g of (await env.DB.prepare(
      `SELECT * FROM inv_receipt_gate WHERE po_line_id IN (${ph})`
    ).bind(...c).all()).results || []) gate.set(g.po_line_id, g);
  }
  const rows = lines.map((x) => ({ ...x, received: recv.get(x.id) || 0, gate: gate.get(x.id) || null }))
    .filter((x) => all || x.received < (Number(x.qty) || 0));
  const canGate = user.via === 'cf-access' && gateEmails(env).includes(String(user.email).toLowerCase());
  return ok({ rows, can_gate: canGate, truncated: lines.length >= 300 });
}
