// functions/api/_google-auth.js
// 共用 helper:Google Service Account JWT → access token + 私鑰匯入。
// 底線開頭 → Cloudflare Pages Functions 不會把它當 endpoint route,
// 但其他 endpoint 可以 import。
//
// 原本 getAccessToken / importPrivateKey 散落在多支 endpoint
// (bom-by-project / inventory-latest / manual-overrides / pcap-list / proc-latest),
// 內容幾乎相同,只差在 scope。抽到這裡共用,行為不變。

// 沒指定 scope 時的預設(只讀 Drive metadata / 下載檔案)
const DEFAULT_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

/**
 * 用 Service Account 私鑰簽 JWT,跟 Google OAuth 換 access token。
 *
 * @param {string} saEmail        Service Account email (JWT iss)
 * @param {string} privateKeyPem  Service Account 私鑰 (PEM,可含跳脫的 \n)
 * @param {string} [scope]        OAuth scope,空白分隔多個;預設 drive.readonly
 * @returns {Promise<string>}     access_token
 */
export async function getAccessToken(saEmail, privateKeyPem, scope = DEFAULT_SCOPE) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: saEmail,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const encHeader = b64url(new TextEncoder().encode(JSON.stringify(header)));
  const encClaim = b64url(new TextEncoder().encode(JSON.stringify(claim)));
  const signingInput = `${encHeader}.${encClaim}`;

  const key = await importPrivateKey(privateKeyPem);
  const sig = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(signingInput)
  );
  const jwt = `${signingInput}.${b64url(new Uint8Array(sig))}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  if (!tokenRes.ok) {
    const t = await tokenRes.text();
    throw new Error(`Token exchange failed: ${t.slice(0, 200)}`);
  }
  const data = await tokenRes.json();
  return data.access_token;
}

/**
 * 把 PEM 格式的 PKCS#8 私鑰匯入成可簽章的 CryptoKey。
 *
 * @param {string} pem  私鑰 PEM(可含跳脫的 \n)
 * @returns {Promise<CryptoKey>}
 */
export async function importPrivateKey(pem) {
  const clean = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  return crypto.subtle.importKey(
    "pkcs8",
    bytes.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

function b64url(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
