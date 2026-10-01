// 專案號正規化（領料以專案為單位，Chris 2026-10-01）
// 專案總表 projects 寫 3509(5) / 2796(1-3)；BOM bom_projects 寫 3509-5 / 2796-1-3 → 統一成 BOM 寫法存進 inv_moves。
// ⚠ 只剝「1xx- 後面接 4 位數」的民國年前綴（115-3535 → 3535）；118-1 這種真的舊專案號不能剝（bom-tool §13d 同一條雷）。
export function projKey(s) {
  let k = String(s ?? '').trim().replace(/\s+/g, '');
  const m = k.match(/^1[0-2][0-9]-(\d{4}(?:\D.*)?)$/);
  if (m) k = m[1];
  k = k.replace(/\((\d+(?:-\d+)*)\)/g, '-$1'); // 3509(5) → 3509-5、2796(1-3) → 2796-1-3
  return k.replace(/-+$/, '').toUpperCase();
}
export const mainNo = (k) => (String(k).match(/^\d+/) || [''])[0];
