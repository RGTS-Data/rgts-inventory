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
  // 數字一律轉成數值再比（"400.00" 與 "400" 是同一個數，不能算不同）
  const n = (v) => { const x = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(x) ? x : 0; };
  const sig = (r) => JSON.stringify([String(r.name ?? '').trim(), n(r.qty), n(r.borrow_in), n(r.borrow_out)]);
  const identical = dups.filter(([, rows]) => rows.every((r) => sig(r) === sig(rows[0]))).length;
  const differ = dups.filter(([, rows]) => new Set(rows.map((r) => n(r.qty))).size > 1);
  const extraRowNos = dups.flatMap(([, rows]) => rows.slice(1).map((r) => r._row)).sort((a, b) => a - b);
  // 區塊判斷：是不是「前一段、後一段」兩份匯出疊在一起
  const split = extraRowNos[0] || 0;
  const firstHalf = s.raw.filter((r) => r._row < split).length;
  const secondHalf = s.raw.filter((r) => r._row >= split).length;
  const crossBlock = dups.filter(([, rows]) => rows.some((r) => r._row < split) && rows.some((r) => r._row >= split)).length;
  const sameBlock = dups.length - crossBlock;
  // 數量不同時，前段 vs 後段誰大
  let laterBigger = 0, laterSmaller = 0;
  for (const [, rows] of differ) {
    const a = rows.filter((r) => r._row < split).reduce((t, r) => t + n(r.qty), 0);
    const b = rows.filter((r) => r._row >= split).reduce((t, r) => t + n(r.qty), 0);
    if (b > a) laterBigger++; else if (b < a) laterSmaller++;
  }
  return ok({
    tab: s.tab, titles: s.titles, sheet_rows: s.raw.length,
    dup_groups: dups.length, dup_extra_rows: extraRowNos.length,
    identical_groups: identical, qty_differ_groups: differ.length,
    split_row: split || null, rows_before_split: firstHalf, rows_from_split: secondHalf,
    groups_across_blocks: crossBlock, groups_within_one_block: sameBlock,
    differ_later_bigger: laterBigger, differ_later_smaller: laterSmaller,
    differ_examples: differ.slice(0, 20).map(([k, rows]) => ({ key: k, rows: rows.map((r) => ({ row: r._row, name: r.name, qty: r.qty, wh: r.wh_name })) })),
  });
}
