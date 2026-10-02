// POST /api/import/stock  期初庫存匯入（Excel「庫存表」，前端 SheetJS 解析後分批送）
// body: { batch, source, rows:[{part_no,wh_code,wh_name,name,unit,qty,borrow_in,borrow_out}] }
// 覆蓋語意見 _lib/stock-upsert.js（Chris 2026-10-01：先用覆蓋，直到 Willy 全轉線上作業）。
import { requireAuth } from '../_lib/auth.js';
import { ok, err, readBody } from '../_lib/json.js';
import { nowIso } from '../_lib/util.js';
import { cleanRows, loadOld, buildStmts, importLogStmt } from '../_lib/stock-upsert.js';
import { onlineStarted } from '../_lib/docs.js';

export async function onRequestPost({ request, env }) {
  const { user, failed } = requireAuth(request, env);
  if (failed) return failed;
  if (!env.DB) return err('DB binding missing', 500);
  const b = await readBody(request);
  const batch = String(b.batch || '').trim();
  const rows = Array.isArray(b.rows) ? b.rows : [];
  if (!batch) return err('batch required');
  if (!rows.length) return err('rows empty');
  if (rows.length > 80) return err('一次最多 80 列（D1 batch 上限），請分批');

  // 已開始線上進出料 → 覆蓋會蓋掉線上數字，要 force（首頁/匯入頁會二次確認）
  if (!b.force) {
    const on = await onlineStarted(env);
    if (on.n > 0) return err(`已開始線上進出料（${on.n} 筆），不能再用 Excel 覆蓋`, 409, { code: 'online_started' });
  }
  const list = cleanRows(rows);
  if (!list.length) return err('沒有有效列（料號與倉庫編號必填）');
  const old = await loadOld(env, list.map((x) => x.part));
  const ts = nowIso();
  const { stmts, adjusted } = buildStmts(env, list, old, { batch, ts, email: user.email });
  const dataDate = /^\d{4}-\d{2}-\d{2}$/.test(String(b.data_date || '')) ? b.data_date : null;
  stmts.push(importLogStmt(env, { batch, ts, source: String(b.source || ''), rows: list.length, email: user.email, dataDate }));
  await env.DB.batch(stmts);
  return ok({ batch, upserted: list.length, adjusted });
}
