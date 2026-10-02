// 專案存在？BOM 現行版有這個專案號，或專案總表（3509(5) 寫法）正規化後對得上
import { projKey, mainNo } from './projkey.js';
export async function projectKnown(env, project) {
  const inBom = await env.DB.prepare(
    `SELECT 1 AS x FROM bom_projects WHERE UPPER(project_no) = ? AND is_current = 1 LIMIT 1`
  ).bind(project).first();
  if (inBom) return true;
  const cand = (await env.DB.prepare(`SELECT project_no FROM projects WHERE project_no LIKE ? LIMIT 200`)
    .bind(`%${mainNo(project)}%`).all()).results || [];
  return cand.some((x) => projKey(x.project_no) === project);
}
