// GET /api/docs/get?doc_no=  單據表頭＋明細（列印頁 /print.html 也用這支）
import { requireAuth } from '../_lib/auth.js';
import { ok, err } from '../_lib/json.js';

export async function onRequestGet({ request, env }) {
  const { failed } = requireAuth(request, env);
  if (failed) return failed;
  const no = new URL(request.url).searchParams.get('doc_no') || '';
  const d = await env.DB.prepare(`SELECT * FROM inv_docs WHERE doc_no = ?`).bind(no).first();
  if (!d) return err('找不到單據', 404);
  // location＝該料號在該倉「目前」的儲位（列印領料單／備料時好找料；不是建單當下的快照）
  const lines = (await env.DB.prepare(
    `SELECT l.*, s.location FROM inv_doc_lines l LEFT JOIN inv_stock s ON s.part_no = l.part_no AND s.wh_code = l.wh_code
     WHERE l.doc_id = ? ORDER BY l.seq`
  ).bind(d.id).all()).results || [];
  return ok({ doc: d, lines });
}
