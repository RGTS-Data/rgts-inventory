// GET /api/receipt/lines?q=&all=1  進料用：查採購明細（採購單號/料號/廠商/專案），附「已入庫量」與「發票核對狀態」
// 附「已入（已過帳）」與「待核對（進貨單未過帳）」；預設只列還沒入滿的；all=1 連已入滿的一起列。唯讀 purchase_*。
import { requireAuth } from '../_lib/auth.js';
import { ok, err } from '../_lib/json.js';
import { gateEmails } from '../_lib/util.js';
import { receivedMap } from '../_lib/receipt-qty.js';

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
  const recv = await receivedMap(env, lines.map((x) => x.id));
  const rows = lines.map((x) => {
    const r = recv.get(x.id) || { posted: 0, pending: 0 };
    return { ...x, received: r.posted, pending: r.pending };
  }).filter((x) => all || x.received + x.pending < (Number(x.qty) || 0));
  const canGate = user.via === 'cf-access' && gateEmails(env).includes(String(user.email).toLowerCase());
  return ok({ rows, can_gate: canGate, truncated: lines.length >= 300 });
}
