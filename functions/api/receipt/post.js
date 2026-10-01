// POST /api/receipt/post  進料入庫
// body: { po_line_id, qty, wh_code='Z', note }
// 門檻（Chris 2026-10-01）：必須先經 receipt/gate 確認「發票金額 = 採購單金額」(status=ok)，否則 409。
// 不可超收：累計入庫量 ≤ 採購數量。
// 回寫採購總表 arrival_date：預留開關 INV_WRITEBACK（預設關，Chris 綠燈前不做）。
import { requireAuth } from '../_lib/auth.js';
import { ok, err, readBody } from '../_lib/json.js';
import { nowIso, normPart } from '../_lib/util.js';

export async function onRequestPost({ request, env }) {
  const { user, failed } = requireAuth(request, env);
  if (failed) return failed;
  if (!env.DB) return err('DB binding missing', 500);
  const b = await readBody(request);
  const lineId = Number(b.po_line_id);
  const qty = Number(b.qty);
  const wh = String(b.wh_code || 'Z').trim().toUpperCase();
  if (!lineId || !(qty > 0)) return err('po_line_id 與 qty(>0) 必填');

  const line = await env.DB.prepare(
    `SELECT l.id, l.po_id, l.part_no, l.name, l.qty, l.amount, l.project_no, o.po_no
     FROM purchase_lines l JOIN purchase_orders o ON o.id = l.po_id WHERE l.id = ?`
  ).bind(lineId).first();
  if (!line) return err('找不到採購明細', 404);
  const part = normPart(line.part_no);
  if (!part) return err('此採購明細沒有料號，無法入庫', 422);

  const gate = await env.DB.prepare(`SELECT * FROM inv_receipt_gate WHERE po_line_id = ?`).bind(lineId).first();
  if (!gate || gate.status !== 'ok') {
    return err('尚未通過發票金額核對（需阿國確認廠商發票與採購單金額一致）', 409, {
      code: 'gate_not_ok', gate_status: gate ? gate.status : 'none',
    });
  }

  const got = await env.DB.prepare(
    `SELECT COALESCE(SUM(qty_delta),0) AS s FROM inv_moves WHERE type='receipt' AND po_line_id = ?`
  ).bind(lineId).first();
  const received = Number(got?.s) || 0;
  if (received + qty > (Number(line.qty) || 0) + 1e-9) {
    return err(`超收：採購 ${line.qty}、已入 ${received}、本次 ${qty}`, 409, { code: 'over_receive' });
  }

  const ts = nowIso();
  const meta = await env.DB.prepare(
    `SELECT name, unit FROM inv_stock WHERE part_no = ? LIMIT 1`
  ).bind(part).first();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO inv_stock (part_no, wh_code, name, unit, qty, updated_at) VALUES (?,?,?,?,?,?)
       ON CONFLICT(part_no, wh_code) DO UPDATE SET qty = qty + excluded.qty, updated_at = excluded.updated_at`
    ).bind(part, wh, meta?.name || line.name || null, meta?.unit || null, qty, ts),
    env.DB.prepare(
      `INSERT INTO inv_moves (ts,type,part_no,wh_code,qty_delta,qty_after,project_no,po_id,po_line_id,invoice_no,amount,note,created_by)
       VALUES (?,?,?,?,?,(SELECT qty FROM inv_stock WHERE part_no=? AND wh_code=?),?,?,?,?,?,?,?)`
    ).bind(ts, 'receipt', part, wh, qty, part, wh, line.project_no || null, line.po_id, lineId,
      gate.invoice_no, line.amount ?? null, b.note ? String(b.note) : null, user.email),
  ]);

  // 回寫採購總表：預留，預設不做
  const writeback = env.INV_WRITEBACK === '1' ? 'enabled-but-not-implemented' : 'disabled';
  return ok({ po_line_id: lineId, part_no: part, wh_code: wh, received: received + qty, writeback });
}
