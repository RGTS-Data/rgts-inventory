// GET /api/stock/sheet-check  唯讀診斷：Google Sheet「庫存表」裡「同料號同倉庫出現不只一列」的情形
// 用途：同步時有列被當成重複合併（只留最後一列）→ 先看清楚那些列是什麼，再決定該加總還是真的重複。
// 不寫任何資料。放在 /api/stock/（走登入、有 CF JWT），瀏覽器直接打開就能看。
import { requireAuth } from '../_lib/auth.js';
import { ok, err } from '../_lib/json.js';
import { normPart } from '../_lib/util.js';
import { readStockSheet } from '../_lib/sheet.js';

export async function onRequestGet({ request, env }) {
  const { failed } = requireAuth(request, env);
  if (failed) return failed;
  let s;
  try { s = await readStockSheet(env); } catch (e) { return err(e.message, 502); }
  const groups = new Map();
  for (const r of s.raw) {
    const part = normPart(r.part_no), wh = String(r.wh_code ?? '').trim().toUpperCase();
    if (!part || !wh) continue;
    const k = `${part}|${wh}`;
    (groups.get(k) || groups.set(k, []).get(k)).push(r);
  }
  const dups = [...groups.entries()].filter(([, rows]) => rows.length > 1);
  const sig = (r) => JSON.stringify([r.name, r.unit, r.wh_name, r.qty, r.borrow_in, r.borrow_out]);
  const identical = dups.filter(([, rows]) => rows.every((r) => sig(r) === sig(rows[0]))).length;
  const qtyDiffer = dups.filter(([, rows]) => new Set(rows.map((r) => String(r.qty))).size > 1).length;
  const extraRowNos = dups.flatMap(([, rows]) => rows.slice(1).map((r) => r._row)).sort((a, b) => a - b);
  return ok({
    tab: s.tab, titles: s.titles, header: s.header, sheet_rows: s.raw.length,
    dup_groups: dups.length, dup_extra_rows: extraRowNos.length,
    identical_groups: identical, qty_differ_groups: qtyDiffer,
    first_extra_row: extraRowNos[0] || null, last_extra_row: extraRowNos[extraRowNos.length - 1] || null,
    examples: dups.slice(0, 25).map(([k, rows]) => ({ key: k, rows })),
  });
}
