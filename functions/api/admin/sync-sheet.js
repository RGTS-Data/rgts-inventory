// POST /api/admin/sync-sheet[?dry=1]  從 Google Sheet「庫存表」同步庫存（覆蓋）
// - 讀「名稱最大」的分頁（分頁名＝日期 YYMMDD，最大＝最新；Chris 2026-10-01 選 b）
// - 用 Sheets API v4 拿 JSON（不必解 xlsx），表頭按名稱對欄，不靠欄位位置
//   ⚠ 用 FORMATTED_VALUE（看到什麼拿什麼）：純數字料號（0110300853）若是數值格，UNFORMATTED 會掉前導 0；
//     數量的千分位 / "3.00" 由 cleanRows 的 num() 處理。
// - dry=1：只回「會寫幾列、幾列數量有變」，不寫入
// - 觸發：首頁按鈕（CF Access JWT）或 status-update-worker 每週排程（X-Admin-Token）
//   ⚠ /api/admin/* 在 CF Access 走 Bypass（排程打得進來），所以這支一定要 requireAuth。
// - ⛔ 一旦有線上進料/領料（inv_moves 有 receipt/issue）就自動停止覆蓋（Chris 2026-10-01 選 a）：
//   覆蓋會把線上進出的數字蓋回 Excel 值。排程永遠不帶 force → 從那天起每週同步自動跳過（留 sync-skip 紀錄）。
//   真的要再覆蓋（例：線上只是測試）→ 首頁按鈕會二次確認後帶 force=1。
// - 成功/失敗都寫一筆 inv_imports（source='sheet:<分頁>' 或 'sheet-fail:<原因>'），排錯用。
import { requireAuth } from '../_lib/auth.js';
import { ok, err } from '../_lib/json.js';
import { nowIso } from '../_lib/util.js';
import { readStockSheet } from '../_lib/sheet.js';
import { onlineStarted } from '../_lib/docs.js';
import { cleanRows, loadOld, buildStmts, importLogStmt, latestDataDate } from '../_lib/stock-upsert.js';

const ROWS_PER_BATCH = 100; // 每個 D1 batch 最多 ~200 句（upsert＋可能的 adjust）

export { pickTab } from '../_lib/sheet.js';

async function logFail(env, batch, why, email) {
  try {
    await importLogStmt(env, { batch, ts: nowIso(), source: 'sheet-fail:' + String(why).slice(0, 80), rows: 0, email }).run();
  } catch {}
}

export async function onRequestPost({ request, env }) {
  const { user, failed } = requireAuth(request, env);
  if (failed) return failed;
  if (!env.DB) return err('DB binding missing', 500);
  const sp = new URL(request.url).searchParams;
  const dry = sp.get('dry') === '1';
  const force = sp.get('force') === '1';
  const batch = 'sync-' + nowIso();
  const email = user.email;
  if (!force) {
    const on = await onlineStarted(env);
    if (on.n > 0) {
      if (!dry) await importLogStmt(env, { batch, ts: nowIso(), source: 'sync-skip:已線上進出料', rows: 0, email }).run();
      return err(`已開始線上進出料（${on.n} 筆，最早 ${String(on.first_ts).slice(0, 10)}），覆蓋同步已停止`, 409,
        { code: 'online_started', moves: on.n, first_ts: on.first_ts });
    }
  }
  let tab, raw, missing;
  try {
    ({ tab, raw, missing } = await readStockSheet(env));
  } catch (e) {
    if (!dry) await logFail(env, batch, e.message, email);
    return err(e.message, 502);
  }
  // 資料日期：分頁名 YYMMDD → 20YY-MM-DD。比目前庫存的資料日期舊（或一樣）就不覆蓋（例 260629 不准蓋 10/02 的存量明細表）
  const dataDate = /^\d{6}$/.test(String(tab)) ? `20${tab.slice(0, 2)}-${tab.slice(2, 4)}-${tab.slice(4, 6)}` : null;
  if (!force) {
    const cur = await latestDataDate(env);
    if (cur && (!dataDate || dataDate <= cur)) {
      if (!dry) await importLogStmt(env, { batch, ts: nowIso(), source: `sync-skip:分頁${tab}不比現有${cur}新`, rows: 0, email }).run();
      return err(`Sheet 分頁「${tab}」不比目前庫存的資料日期 ${cur} 新，不覆蓋`, 409, { code: 'older_data', tab, current: cur });
    }
  }
  if (missing.length) {
    if (!dry) await logFail(env, batch, '缺欄位 ' + missing.join('/'), email);
    return err(`分頁 ${tab} 找不到欄位：${missing.join('、')}`, 422);
  }
  const list = cleanRows(raw);
  // 對帳用：Sheet 列數 ≠ 寫入列數時，要分得出是空白列、缺料號/倉庫，還是同料號同倉重複
  const blank = raw.filter((o) => Object.entries(o).every(([k, v]) => k === '_row' || String(v ?? '').trim() === '')).length;
  const noKey = raw.filter((o) => !String(o.part_no ?? '').trim() || !String(o.wh_code ?? '').trim()).length - blank;
  const stats = { sheet_rows: raw.length, blank, no_key: noKey, merged_dup: raw.length - blank - noKey - list.length };
  if (!list.length) {
    if (!dry) await logFail(env, batch, '0 筆有效列', email);
    return err(`分頁 ${tab} 沒有有效列`, 422);
  }

  const old = await loadOld(env, null);
  const ts = nowIso();
  if (dry) {
    const changed = list.filter((x) => (old.get(`${x.part}|${x.wh}`) ?? 0) !== x.qty).length;
    const added = list.filter((x) => !old.has(`${x.part}|${x.wh}`)).length;
    return ok({ dry: true, tab, rows: list.length, changed, added, ...stats });
  }

  let adjusted = 0;
  for (let i = 0; i < list.length; i += ROWS_PER_BATCH) {
    const part = list.slice(i, i + ROWS_PER_BATCH);
    const r = buildStmts(env, part, old, { batch, ts, email });
    adjusted += r.adjusted;
    try {
      await env.DB.batch(r.stmts);
    } catch (e) {
      await logFail(env, batch, `寫入第 ${i} 列起失敗：${e.message}`, email);
      return err(`寫入失敗（已寫 ${i} 列，可重跑）：${e.message}`, 500);
    }
  }
  await importLogStmt(env, { batch, ts, source: 'sheet:' + tab, rows: list.length, email, dataDate }).run();
  return ok({ batch, tab, rows: list.length, adjusted, ...stats });
}
