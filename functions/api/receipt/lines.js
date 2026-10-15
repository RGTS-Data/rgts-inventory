// GET /api/receipt/lines?q=&all=1  進料用（q 可放多個條件，空白／逗號隔開）：查採購明細（採購單號/料號/廠商/專案），附「已入庫量」與「發票核對狀態」
// 運費這種沒料號的列也列（is_fee），只算金額不入庫。
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
  // 一次查多張採購單（Willy 2026-10-15：廠商常一次交好幾張單、開一張發票）：
  // 空白／逗號／頓號／分號／換行隔開＝多個條件，任一個符合就列（OR）。最多 20 個（每個 4 個參數，D1 一句上限 100）。
  const terms = [...new Set(q.split(/[\s,，、;；]+/).map((t) => t.trim()).filter((t) => t.length >= 2))].slice(0, 20);
  if (!terms.length) return err('請輸入至少 2 個字（採購單號／料號／廠商／專案；多張採購單用空白或逗號隔開）');
  const cond = terms.map(() => '(o.po_no LIKE ? OR l.part_no LIKE ? OR o.vendor LIKE ? OR l.project_no LIKE ?)').join(' OR ');
  const binds = terms.flatMap((t) => { const like = `%${t}%`; return [like, like, like, like]; });
  const r = await env.DB.prepare(
    `SELECT l.id, l.po_id, o.po_no, o.vendor, o.order_date, l.part_no, l.name, l.spec, l.qty, l.unit_price,
            l.amount, l.currency, l.invoice_no, l.arrival_date, l.project_no
     FROM purchase_lines l JOIN purchase_orders o ON o.id = l.po_id
     WHERE ${cond}
     ORDER BY o.order_date DESC, o.po_no, l.id LIMIT 300`
  ).bind(...binds).all();
  const lines = r.results || [];
  const recv = await receivedMap(env, lines.map((x) => x.id));
  const rows = lines.map((x) => {
    const r = recv.get(x.id) || { posted: 0, pending: 0 };
    // 沒料號的列（運費等）也列出：可勾進進貨單算金額，但過帳不動庫存（Chris 2026-10-10）
    return { ...x, received: r.posted, pending: r.pending, is_fee: !String(x.part_no || '').trim() };
  }).filter((x) => all || x.received + x.pending < (Number(x.qty) || 0));
  const canGate = user.via === 'cf-access' && gateEmails(env).includes(String(user.email).toLowerCase());
  return ok({ rows, terms, can_gate: canGate, truncated: lines.length >= 300 });
}
