// POST /api/reserve/release  母單保留：釋放（全部或指定料號）。不刪資料，只標 released_at。
// body: { project_no, parts?:[料號] }   沒給 parts＝整張母單全部釋放
import { requireAuth } from '../_lib/auth.js';
import { ok, err, readBody } from '../_lib/json.js';
import { nowIso, normPart } from '../_lib/util.js';
import { projKey } from '../_lib/projkey.js';

export async function onRequestPost({ request, env }) {
  const { user, failed } = requireAuth(request, env);
  if (failed) return failed;
  if (!env.DB) return err('DB binding missing', 500);
  const b = await readBody(request);
  const key = projKey(b.project_no);
  if (!key) return err('專案號必填');
  const parts = (Array.isArray(b.parts) ? b.parts : []).map(normPart).filter(Boolean).slice(0, 90);
  const ts = nowIso();
  const r = parts.length
    ? await env.DB.prepare(`UPDATE inv_reserve SET released_at = ?, released_by = ? WHERE parent_key = ? AND released_at IS NULL AND part_no IN (${parts.map(() => '?').join(',')})`)
        .bind(ts, user.email, key, ...parts).run()
    : await env.DB.prepare(`UPDATE inv_reserve SET released_at = ?, released_by = ? WHERE parent_key = ? AND released_at IS NULL`)
        .bind(ts, user.email, key).run();
  return ok({ project_no: key, released: r?.meta?.changes || 0 });
}
