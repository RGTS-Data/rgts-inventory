// 專案是否已出貨：讀專案總表 projects（唯讀）。projects 寫 3509(5)，BOM 寫 3509-5 → 用 projKey 比對。
// 已出貨＝該專案任一列狀態是 shipped 或 invoiced。回 null＝未出貨。
import { projKey, mainNo } from './projkey.js';

export async function shippedInfo(env, key) {
  const main = mainNo(key);
  if (!main) return null;
  const rows = (await env.DB.prepare(
    `SELECT project_no, status, ship_date FROM projects WHERE project_no LIKE ?`
  ).bind(main + '%').all()).results || [];
  const mine = rows.filter((r) => projKey(r.project_no) === key);
  // 只認 shipped／invoiced；cancelled（取消單）不算出貨
  const hit = mine.find((r) => r.status === 'shipped' || r.status === 'invoiced');
  return hit ? { status: hit.status, ship_date: hit.ship_date || null } : null;
}
