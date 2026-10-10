// 共用小工具
export const nowIso = () => new Date().toISOString();

// 料號正規化：去空白、轉大寫（比對 purchase_lines.part_no 用）
export const normPart = (s) => String(s ?? '').trim().toUpperCase();

// D1 一句 SQL 最多 100 個參數 → IN(...) 一律切批（同 bom-tool/rgts-rma 的教訓）
export const SQL_IN_CHUNK = 90;
export function chunk(arr, n = SQL_IN_CHUNK) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// 金額容差（發票 vs 採購單）：1 元以內視為一致（匯兌/四捨五入）
export const AMOUNT_TOL = 1;

// 有權確認「發票金額一致」的人（逗號分隔 email，不分大小寫）；預設阿國
export function gateEmails(env) {
  return String(env.GATE_EMAILS || 'gary_chen@nord-titan.com')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

// 幣別：空白／TWD／NT → NTD；其他大寫（採購總表實際只有 NTD/USD/RMB）
export function normCur(c) {
  const v = String(c || '').trim().toUpperCase();
  return !v || v === 'TWD' || v === 'NT' || v === 'NT$' ? 'NTD' : v;
}
// 金額／匯率欄：空白＝null；有填就要是數字（千分位逗號可）
export function optNum(v) {
  const t = String(v ?? '').replace(/,/g, '').trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}
