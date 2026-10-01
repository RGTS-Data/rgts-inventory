// 讀 Google Sheet「庫存表」（名稱最大＝日期最新的分頁）→ 回傳表頭與原始列（已按表頭名對欄）
// admin/sync-sheet（寫入）與 stock/sheet-check（唯讀診斷）共用。
// ⚠ 用 FORMATTED_VALUE：純數字料號若是數值格，UNFORMATTED 會掉前導 0。
import { getAccessToken } from './google-auth.js';

export const DEFAULT_SHEET_ID = '1kAn9iVPWlX2qi0oaH_oEuh9QT44BaaVYXRAAKIZF2uc'; // 庫存表
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
export const COLS = { part_no: '產品編號', name: '品名規格', unit: '單位', wh_code: '倉庫編號',
  wh_name: '倉庫名稱', qty: '現有庫存', borrow_in: '借入數量', borrow_out: '借出數量' };

// 分頁挑選：名稱是純數字的取最大；都不是純數字就取第一個
export function pickTab(titles) {
  const nums = titles.filter((t) => /^\d+$/.test(String(t).trim()));
  if (nums.length) return nums.sort((a, b) => Number(b) - Number(a))[0];
  return titles[0];
}

// 回 { tab, header, raw, missing }；連線/權限錯誤直接 throw
export async function readStockSheet(env) {
  if (!env.SA_EMAIL || !env.SA_PRIVATE_KEY) throw new Error('SA_EMAIL / SA_PRIVATE_KEY 未設定');
  const sheetId = env.INV_SHEET_ID || DEFAULT_SHEET_ID;
  const token = await getAccessToken(env.SA_EMAIL, env.SA_PRIVATE_KEY, SCOPE);
  const H = { Authorization: `Bearer ${token}` };
  const meta = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties.title`, { headers: H });
  if (!meta.ok) throw new Error(`讀取分頁清單失敗 HTTP ${meta.status}`);
  const titles = ((await meta.json()).sheets || []).map((s) => s.properties.title);
  const tab = pickTab(titles);
  if (!tab) throw new Error('試算表沒有分頁');
  const range = encodeURIComponent(`'${tab.replace(/'/g, "''")}'`);
  const vr = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?valueRenderOption=FORMATTED_VALUE`, { headers: H });
  if (!vr.ok) throw new Error(`讀取分頁 ${tab} 失敗 HTTP ${vr.status}`);
  const values = (await vr.json()).values || [];
  const header = (values[0] || []).map((h) => String(h).trim());
  const idx = {};
  for (const [k, label] of Object.entries(COLS)) idx[k] = header.indexOf(label);
  const missing = Object.entries(idx).filter(([k, i]) => i < 0 && ['part_no', 'wh_code', 'qty'].includes(k)).map(([k]) => COLS[k]);
  const raw = values.slice(1).map((r, n) => {
    const o = { _row: n + 2 };               // Sheet 上的實際列號（表頭是第 1 列）
    for (const [k, i] of Object.entries(idx)) o[k] = i >= 0 ? r[i] : '';
    return o;
  });
  return { tab, header, raw, missing, titles };
}
