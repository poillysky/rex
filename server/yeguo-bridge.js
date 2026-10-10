// 野果 api.php 桥：AES-128-CBC 解密（零第三方依赖，Node 18+）
const crypto = require("crypto");

const API_KEY = Buffer.from(process.env.YG_API_KEY || "2acf7e91e9864673", "utf8");
const API_IV = Buffer.from(process.env.YG_API_IV || "1c29882d3ddfcfd6", "utf8");
const DEFAULT_SITE = (process.env.YG_SITE || "https://analyze.buxefaex.cc").replace(/\/+$/, "");
const DEFAULT_LINES = (
  process.env.YG_LINES ||
  "https://www.yeguodj.com/api.php,https://yeguodj.com/api.php,https://analyze.buxefaex.cc/api.php,https://adviser.tjecfkte.cc/api.php"
)
  .split(",")
  .map((s) => s.trim().replace(/\/+$/, ""))
  .filter(Boolean);

const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const FALLBACK_THEMES = [
  ["theme:7", "野果原创"],
  ["theme:8", "真人短剧"],
  ["theme:9", "魔改漫剧"],
  ["theme:10", "网红改编"],
  ["theme:11", "PMV裸舞"],
];

function aesDecrypt(b64) {
  const ct = Buffer.from(String(b64).replace(/ /g, "+"), "base64");
  const dec = crypto.createDecipheriv("aes-128-cbc", API_KEY, API_IV);
  // Node 默认 PKCS7 去填充
  return Buffer.concat([dec.update(ct), dec.final()]).toString("utf8");
}

class YeguoBridge {
  constructor() {
    this.lines = DEFAULT_LINES.slice();
    this.site = DEFAULT_SITE;
    this.oauth = crypto.createHash("md5").update(crypto.randomBytes(16)).digest("hex");
    this.apiBase = this.lines[0] || "";
  }

  common() {
    return {
      bundleId: "com.pwa.mater",
      version: "1.3.2",
      oauth_type: "web",
      language: "zh",
      via: "pwa",
      oauth_id: this.oauth,
      trace_id: this.oauth,
      token: "",
    };
  }

  async call(route, params, method) {
    method = (method || "POST").toUpperCase();
    const values = { ...this.common(), ...(params || {}) };
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(values)) {
      if (v == null) continue;
      qs.set(k, String(v));
    }
    let last;
    for (const api of this.lines) {
      const url = api.replace(/\/+$/, "") + route;
      try {
        const headers = {
          "User-Agent": UA,
          Accept: "application/json, text/plain, */*",
          Referer: this.site + "/",
          Origin: this.site,
        };
        let res;
        if (method === "GET") {
          res = await fetch(url + "?" + qs.toString(), { headers });
        } else {
          headers["Content-Type"] = "application/x-www-form-urlencoded";
          res = await fetch(url, { method: "POST", headers, body: qs.toString() });
        }
        if (!res.ok) throw new Error("HTTP " + res.status);
        const env = await res.json();
        if (Number(env.errcode) !== 0) {
          throw new Error(`errcode=${env.errcode} ${env.msg || ""}`.trim());
        }
        if (!env.data || typeof env.data !== "string") throw new Error("无加密数据");
        const payload = JSON.parse(aesDecrypt(env.data));
        if (api !== this.apiBase) {
          this.apiBase = api;
          this.lines = [api, ...this.lines.filter((x) => x !== api)];
        }
        if (payload && typeof payload === "object" && "data" in payload) {
          const data = payload.data;
          return data && typeof data === "object" ? data : { value: data };
        }
        return payload && typeof payload === "object" ? payload : { value: payload };
      } catch (e) {
        last = e;
      }
    }
    throw last || new Error("野果请求失败");
  }

  toItem(raw) {
    const id = String(raw.video_id || raw.id || "").trim();
    if (!id) return null;
    let cover = String(raw.cover || "").trim();
    if (cover.startsWith("//")) cover = "https:" + cover;
    const tags = [];
    for (const t of raw.tags || []) {
      if (typeof t === "string" && t.trim()) tags.push(t.trim());
      else if (t && typeof t === "object") {
        const n = String(t.name || t.title || "").trim();
        if (n) tags.push(n);
      }
    }
    const total = Number(raw.episode_count || raw.episodes || raw.total_serial || 0) || 0;
    return {
      id,
      title: String(raw.title || id).trim(),
      cover,
      tags,
      total,
      finished: String(raw.serialize_status || "") === "2",
    };
  }

  async catalog(category, page) {
    page = Math.max(1, Number(page) || 1);
    const cat = String(category || "hot").trim();
    const params = { page, limit: 20 };
    if (cat.startsWith("theme:")) params.theme = cat.split(":")[1];
    else if (/^\d+$/.test(cat)) params.theme = cat;
    if (cat === "new") params.recommend = "2";
    else if (cat === "hot" || cat === "all" || !cat) params.recommend = "1";
    const data = await this.call("/api/theater/exploreList", params, "POST");
    return (data.list || []).map((r) => this.toItem(r)).filter(Boolean);
  }

  async search(keyword, page) {
    const kw = String(keyword || "").trim();
    if (!kw) return [];
    const data = await this.call(
      "/api/search/result",
      { keyword: kw, tab: "video", page: Math.max(1, Number(page) || 1), limit: 20 },
      "POST"
    );
    return (data.list || []).map((r) => this.toItem(r)).filter(Boolean);
  }

  async detail(id) {
    const rid = String(id || "").trim();
    const data = await this.call(
      "/api/playlet/detail",
      { video_id: rid, id: rid, episode_id: "0", related_limit: "0" },
      "POST"
    );
    const episodes = [];
    for (const row of data.episodes || []) {
      if (!row || typeof row !== "object") continue;
      if (row.is_adv === true || row.is_adv === 1 || row.is_adv === "1") continue;
      const eid = String(row.id || "").trim();
      const n = Number(row.sort || 0) || 0;
      if (!eid || n < 1) continue;
      episodes.push({ n, episode_id: eid, title: String(row.title || `第${n}集`) });
    }
    episodes.sort((a, b) => a.n - b.n);
    const item = this.toItem(data) || { id: rid, title: rid, cover: "", tags: [], total: episodes.length };
    return {
      id: rid,
      title: item.title,
      cover: item.cover,
      description: String(data.description || data.intro || ""),
      episodes,
    };
  }

  async play(id, ep, episodeId) {
    const rid = String(id || "").trim();
    let eid = String(episodeId || "").trim();
    const epn = Math.max(1, Number(ep) || 1);
    if (!eid) {
      const d = await this.detail(rid);
      const hit = d.episodes.find((e) => e.n === epn) || d.episodes[epn - 1];
      if (!hit) throw new Error("没有第 " + epn + " 集");
      eid = hit.episode_id;
    }
    const data = await this.call(
      "/api/playlet/play",
      { playlet_id: rid, video_id: rid, episode_id: eid },
      "POST"
    );
    let url = String(data.video_url || data.video_url_h265 || "").trim();
    if (url.startsWith("//")) url = "https:" + url;
    if (!url) throw new Error("没有播放地址");
    return { url, referer: this.site + "/", resolution: data.resolution || "" };
  }
}

const bridge = new YeguoBridge();

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function handleYeguo(req, res, u) {
  const path = u.pathname.replace(/^\/yg/, "") || "/";
  try {
    if (path === "/health") return json(res, 200, { ok: true, api: bridge.apiBase, themes: FALLBACK_THEMES });
    if (path === "/catalog") {
      const items = await bridge.catalog(u.searchParams.get("category") || "hot", u.searchParams.get("page") || 1);
      return json(res, 200, { ok: true, items });
    }
    if (path === "/search") {
      const q = u.searchParams.get("q") || "";
      if (!q) return json(res, 400, { ok: false, error: "缺少 q" });
      const items = await bridge.search(q, u.searchParams.get("page") || 1);
      return json(res, 200, { ok: true, items });
    }
    if (path === "/detail") {
      const id = u.searchParams.get("id") || "";
      if (!id) return json(res, 400, { ok: false, error: "缺少 id" });
      const data = await bridge.detail(id);
      return json(res, 200, { ok: true, ...data });
    }
    if (path === "/play") {
      const id = u.searchParams.get("id") || "";
      const ep = u.searchParams.get("ep") || "1";
      const episodeId = u.searchParams.get("episode_id") || "";
      if (!id) return json(res, 400, { ok: false, error: "缺少 id" });
      const play = await bridge.play(id, ep, episodeId);
      return json(res, 200, { ok: true, id, ep: Number(ep) || 1, ...play });
    }
    return json(res, 404, { ok: false, error: "not found" });
  } catch (e) {
    return json(res, 502, { ok: false, error: String((e && e.message) || e) });
  }
}

module.exports = { handleYeguo, FALLBACK_THEMES };
