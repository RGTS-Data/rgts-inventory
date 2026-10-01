// POST /api/admin/sync-sheet[?dry=1]  從 Google Sheet「庫存表」同步庫存（覆蓋）
// - 讀「名稱最大」的分頁（分頁名＝日期 YYMMDD，最大＝最新；Chris 2026-10-01 選 b）
// - 用 Sheets API v4 拿 JSON（不必解 xlsx），表頭按名稱對欄，不靠欄位位置
//   ⚠ 用 FORMATTED_VALUE（看到什麼拿什麼）：純數字料號（0110300853）若是數值格，UNFORMATTED 會掉前導 0；
//     數量的千分位 / "3.00" 由 cleanRows 的 num() 處理。
// - dry=1：只回「會寫幾列、幾列數量有變」，不寫入
// - 觸發：首頁按鈕（CF Access JWT）或 status-update-worker 每週排程（X-Admin-Token）
//   ⚠ /api/admin/* 在 CF Access 走 Bypass（排程打得進來），所以這支一定要 requireAuth。
// - 成功/失敗都寫一筆 inv_imports（source='sheet:<分頁>' 或 'sheet-fail:<原因>'），排錯用。
import { requireAuth } from '../_lib/auth.js';
import { ok, err } from '../_lib/json.js';
import { nowIso } from '../_lib/util.js';
import { getAccessToken } from '../_lib/google-auth.js';
import { cleanRows, loadOld, buildStmts, importLogStmt } from '../_lib/stock-upsert.js';

const DEFAULT_SHEET_ID = '1kAn9iVPWlX2qi0oaH_oEuh9QT44BaaVYXRAAKIZF2uc'; // 庫存表
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const COLS = { part_no: '產品編號', name: '品名規格', unit: '單位', wh_code: '倉庫編號',
  wh_name: '倉庫名稱', qty: '現有庫存', borrow_in: '借入數量', borrow_out: '借出數量' };
const ROWS_PER_BATCH = 100; // 每個 D1 batch 最多 ~200 句（upsert＋可能的 adjust）

// 分頁挑選：名稱是純數字的取最大；都不是純數字就取第一個
export function pickTab(titles) {
  const nums = titles.filter((t) => /^\d+$/.test(String(t).trim()));
  if (nums.length) return nums.sort((a, b) => Number(b) - Number(a))[0];
  return titles[0];
}

async function logFail(env, batch, why, email) {
  try {
    await importLogStmt(env, { batch, ts: nowIso(), source: 'sheet-fail:' + String(why).slice(0, 80), rows: 0, email }).run();
  } catch {}
}

export async function onRequestPost({ request, env }) {
  const { user, failed } = requireAuth(request, env);
  if (failed) return failed;
  if (!env.DB) return err('DB binding missing', 500);
  const dry = new URL(request.url).searchParams.get('dry') === '1';
  const batch = 'sync-' + nowIso();
  const email = user.email;
  if (!env.SA_EMAIL || !env.SA_PRIVATE_KEY) return err('SA_EMAIL / SA_PRIVATE_KEY 未設定', 500);
  const sheetId = env.INV_SHEET_ID || DEFAULT_SHEET_ID;

  let tab, values;
  try {
    const token = await getAccessToken(env.SA_EMAIL, env.SA_PRIVATE_KEY, SCOPE);
    const H = { Authorization: `Bearer ${token}` };
    const meta = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties.title`, { headers: H });
    if (!meta.ok) throw new Error(`讀取分頁清單失敗 HTTP ${meta.status}`);
    const titles = ((await meta.json()).sheets || []).map((s) => s.properties.title);
    tab = pickTab(titles);
    if (!tab) throw new Error('試算表沒有分頁');
    const range = encodeURIComponent(`'${tab.replace(/'/g, "''")}'`);
    const vr = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?valueRenderOption=FORMATTED_VALUE`, { headers: H });
    if (!vr.ok) throw new Error(`讀取分頁 ${tab} 失敗 HTTP ${vr.status}`);
    values = (await vr.json()).values || [];
  } catch (e) {
    if (!dry) await logFail(env, batch, e.message, email);
    return err(e.message, 502);
  }

  const header = (values[0] || []).map((h) => String(h).trim());
  const idx = {};
  for (const [k, label] of Object.entries(COLS)) idx[k] = header.indexOf(label);
  const missing = Object.entries(idx).filter(([k, i]) => i < 0 && ['part_no', 'wh_code', 'qty'].includes(k)).map(([k]) => COLS[k]);
  if (missing.length) {
    if (!dry) await logFail(env, batch, '缺欄位 ' + missing.join('/'), email);
    return err(`分頁 ${tab} 找不到欄位：${missing.join('、')}`, 422);
  }
  const raw = values.slice(1).map((r) => {
    const o = {};
    for (const [k, i] of Object.entries(idx)) o[k] = i >= 0 ? r[i] : '';
    return o;
  });
  const list = cleanRows(raw);
  // 對帳用：Sheet 列數 ≠ 寫入列數時，要分得出是空白列、缺料號/倉庫，還是同料號同倉重複
  const blank = raw.filter((o) => Object.values(o).every((v) => String(v ?? '').trim() === '')).length;
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
  await importLogStmt(env, { batch, ts, source: 'sheet:' + tab, rows: list.length, email }).run();
  return ok({ batch, tab, rows: list.length, adjusted, ...stats });
}
