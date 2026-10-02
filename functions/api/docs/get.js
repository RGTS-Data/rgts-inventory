// GET /api/docs/get?doc_no=  單據表頭＋明細
import { requireAuth } from '../_lib/auth.js';
import { ok, err } from '../_lib/json.js';

export async function onRequestGet({ request, env }) {
  const { failed } = requireAuth(request, env);
  if (failed) return failed;
  const no = new URL(request.url).searchParams.get('doc_no') || '';
  const d = await env.DB.prepare(`SELECT * FROM inv_docs WHERE doc_no = ?`).bind(no).first();
  if (!d) return err('找不到單據', 404);
  const lines = (await env.DB.prepare(`SELECT * FROM inv_doc_lines WHERE doc_id = ? ORDER BY seq`).bind(d.id).all()).results || [];
  return ok({ doc: d, lines });
}
