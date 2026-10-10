// Forward 辅助服务（零依赖，Node 18+）
//   GET /health
//   GET /cover?u=<加密封面>[&k=口令]     → 黄果AI 封面解密
//   GET /hd/*  → 黄豆加密 API 桥
//   GET /yg/*  → 野果加密 API 桥
const http = require("http");
const crypto = require("crypto");
const { handleHuangdou } = require("./huangdou-bridge");
const { handleYeguo } = require("./yeguo-bridge");

const PORT = Number(process.env.PORT || 8787);
const TOKEN = process.env.TOKEN || "";
const KEY = Buffer.from(process.env.COVER_KEY || "f5d965df75336270", "utf8");
const IV = Buffer.from(process.env.COVER_IV || "97b60394abc2fbe1", "utf8");
const ALLOW = (process.env.ALLOW_HOSTS || "pic.wirqed.cn,expose.eisees.com")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const MAX_BYTES = 8 * 1024 * 1024;

function sniff(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf.slice(0, 4).toString() === "RIFF") return "image/webp";
  if (buf.slice(0, 3).toString() === "GIF") return "image/gif";
  return "";
}

function decrypt(cipher) {
  const n = Math.floor(cipher.length / 16) * 16;
  const d = crypto.createDecipheriv("aes-128-cbc", KEY, IV);
  d.setAutoPadding(false);
  let out = Buffer.concat([d.update(cipher.subarray(0, n)), d.final()]);
  let end = out.length;
  while (end > 0 && out[end - 1] === 0) end--;
  return out.subarray(0, end);
}

const cache = new Map();
function cacheKey(u) {
  return u.split("?")[0];
}

function image(res, item) {
  res.writeHead(200, {
    "Content-Type": item.type,
    "Cache-Control": "public, max-age=86400",
    "Access-Control-Allow-Origin": "*",
    "Content-Length": item.body.length,
  });
  res.end(item.body);
}
function send(res, code, msg) {
  res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(msg);
}

async function handleCover(reqUrl, res) {
  const u = reqUrl.searchParams.get("u") || "";
  let target;
  try {
    target = new URL(u);
  } catch {
    return send(res, 400, "bad u");
  }
  if (!/^https?:$/.test(target.protocol) || !ALLOW.includes(target.hostname)) {
    return send(res, 403, "host not allowed");
  }

  const ck = cacheKey(u);
  if (cache.has(ck)) return image(res, cache.get(ck));

  const r = await fetch(target, {
    headers: { "User-Agent": UA, Referer: "https://huangguoai.com/" },
  });
  if (!r.ok) return send(res, 502, "upstream " + r.status);
  const cipher = Buffer.from(await r.arrayBuffer());
  if (!cipher.length || cipher.length > MAX_BYTES) return send(res, 502, "bad size");

  const plain = decrypt(cipher);
  const type = sniff(plain);
  if (!type) return send(res, 502, "decrypt failed (key may have changed)");
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  const item = { type, body: plain };
  cache.set(ck, item);
  image(res, item);
}

function checkToken(u) {
  return !TOKEN || u.searchParams.get("k") === TOKEN;
}

http
  .createServer(async (req, res) => {
    try {
      const u = new URL(req.url, "http://x");
      if (u.pathname === "/health") return send(res, 200, "ok");
      if (!checkToken(u) && u.pathname !== "/health") return send(res, 401, "unauthorized");
      if (u.pathname === "/cover") return await handleCover(u, res);
      if (u.pathname === "/hd" || u.pathname.startsWith("/hd/")) return await handleHuangdou(req, res, u);
      if (u.pathname === "/yg" || u.pathname.startsWith("/yg/")) return await handleYeguo(req, res, u);
      send(res, 404, "not found");
    } catch (e) {
      send(res, 500, String((e && e.message) || e));
    }
  })
  .listen(PORT, () => console.log("forward bridge listening on :" + PORT));
