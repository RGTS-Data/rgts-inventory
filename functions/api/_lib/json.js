// JSON response helpers（跨 function 共用）
export const json = (data, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });

export const ok = (data = {}) => json({ ok: true, ...data });
export const err = (message, status = 400, extra = {}) =>
  json({ ok: false, error: message, ...extra }, status);

export async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
