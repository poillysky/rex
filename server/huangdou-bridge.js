// 黄豆加密 API 桥：供 Forward 脚本经 NAS 调用（零第三方依赖，Node 18+）
const crypto = require("crypto");
const zlib = require("zlib");

const PLATFORM_KEY = process.env.HD_PLATFORM_KEY || "7961beb44246e3012ce228d6b5ced05a";
const API_VERSION = "1.0.0";
const DEVICE_TYPE = "web";
const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";

const DEFAULT_LINES = (
  process.env.HD_LINES ||
  "https://lzlukvca.cc,https://psfxhhox.top,https://sxqirtho.top,https://qicuknlj.top,https://hddj05.com,https://hddj06.com,https://hddj07.com,https://hvthtcpa.top"
)
  .split(",")
  .map((s) => s.trim().replace(/\/+$/, ""))
  .filter(Boolean);

const ENUM_CATEGORIES = [
  ["yuandou", "黄豆原创"],
  ["mod", "魔改短剧"],
  ["caibian", "擦边短剧"],
  ["zhenren", "真人短剧"],
  ["erciyuan", "动漫"],
  ["aiman", "影院"],
  ["zongyi", "贤者"],
  ["heiliao", "黑料"],
];

class HuangdouBridge {
  constructor() {
    this.lines = DEFAULT_LINES.slice();
    this.base = this.lines[0] || "";
    this.liveBase = "";
    this.sessionId = crypto.randomUUID().replace(/-/g, "");
    this.deviceId = crypto.randomUUID().toLowerCase();
    this.token = "";
    this.userId = "";
    this.navCache = null;
  }

  key(rid) {
    const hex = String(rid).replace(/-/g, "");
    return crypto.createHmac("sha256", PLATFORM_KEY).update(Buffer.from(hex, "hex")).digest();
  }

  decode(blob, rid) {
    if (!blob || !blob.length) return {};
    if (blob.length < 32) {
      try {
        return JSON.parse(blob.toString("utf8"));
      } catch {
        return {};
      }
    }
    try {
      const iv = blob.subarray(0, 16);
      const ct = blob.subarray(16);
      const dec = crypto.createDecipheriv("aes-256-cbc", this.key(rid), iv);
      let plain = Buffer.concat([dec.update(ct), dec.final()]);
      if (plain[0] === 0x1f && plain[1] === 0x8b) plain = zlib.gunzipSync(plain);
      return JSON.parse(plain.toString("utf8"));
    } catch {
      try {
        return JSON.parse(blob.toString("utf8"));
      } catch {
        return {};
      }
    }
  }

  tokenValue() {
    if (this.token && this.userId) return `${this.token}_${this.userId}`;
    return this.token || "";
  }

  async postOnce(host, path, data) {
    path = "/" + String(path || "").replace(/^\/+/, "");
    const rid = crypto.randomUUID().toLowerCase();
    const key = this.key(rid);
    const iv = crypto.randomBytes(16);
    const raw = Buffer.from(
      JSON.stringify({
        token: this.tokenValue(),
        deviceId: this.deviceId,
        data: data || {},
      }),
      "utf8"
    );
    const gz = zlib.gzipSync(raw);
    const enc = crypto.createCipheriv("aes-256-cbc", key, iv);
    const body = Buffer.concat([iv, enc.update(gz), enc.final()]);
    const ts = Math.floor(Date.now() / 1000);
    const urlClean = host.replace(/^https?:\/\//, "").replace(/\/+$/, "") + "/api" + path;
    const signSrc = `Dart|${this.sessionId}|${rid}|${ts}|${urlClean}`;
    const sign = crypto.createHash("md5").update(signSrc).digest("hex") + "-" + ts;
    const url = host.replace(/\/+$/, "") + "/api" + path;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        Accept: "*/*",
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept-Language": "zh-CN,zh;q=0.9",
        Origin: host,
        Referer: host + "/home",
        version: API_VERSION,
        deviceType: DEVICE_TYPE,
        time: String(ts),
        sign,
        requestId: rid,
        sessionId: this.sessionId,
        deviceBrand: "",
        deviceModel: "",
        systemName: "",
        systemVersion: "",
      },
      body,
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const blob = Buffer.from(await res.arrayBuffer());
    return this.decode(blob, rid);
  }

  async api(path, data) {
    const hosts = [];
    if (this.liveBase) hosts.push(this.liveBase);
    for (const h of this.lines) if (!hosts.includes(h)) hosts.push(h);
    let last;
    for (const host of hosts) {
      try {
        const out = await this.postOnce(host, path, data);
        if (!out || (typeof out === "object" && !Object.keys(out).length)) continue;
        if (out.status === "n" && String(out.errorCode || out.error || "") === "2002") {
          this.token = "";
          this.userId = "";
          continue;
        }
        this.liveBase = host;
        this.base = host;
        return out;
      } catch (e) {
        last = e;
      }
    }
    throw last || new Error("黄豆请求失败: " + path);
  }

  async ensureLogin() {
    if (this.token && this.userId) return;
    const result = await this.api("/login/device", {
      line_code: "china_1",
      channel_code: "",
      share_code: "",
      clipboard_text: "",
      device_info: {
        browserName: "BrowserName.safari",
        language: "zh-CN",
        userAgent: UA,
        platform: "iPhone",
      },
    });
    const data = result && result.data;
    if (data && data.token) {
      this.token = String(data.token || "");
      this.userId = String(data.user_id || "");
    }
  }

  async navList() {
    if (this.navCache) return this.navCache;
    const result = await this.api("/drama/navList", {});
    const data = (result && result.data) || result || {};
    const lst = (data && data.list) || result.list || [];
    this.navCache = Array.isArray(lst) ? lst.filter((x) => x && typeof x === "object") : [];
    return this.navCache;
  }

  resolveCode(enumValue) {
    const v = String(enumValue || "").trim();
    if (!v || v === "hot" || v === "new" || v === "all") return v;
    const nameMap = Object.fromEntries(ENUM_CATEGORIES);
    const nav = this.navCache || [];
    for (const it of nav) if (String(it.code || "") === v) return v;
    const cn = nameMap[v] || "";
    if (cn) {
      for (const it of nav) {
        const apiName = String(it.name || "");
        if (apiName && (cn.includes(apiName) || apiName.includes(cn))) return String(it.code || v);
      }
    }
    return v;
  }

  listOf(data) {
    if (Array.isArray(data)) return data.filter((x) => x && typeof x === "object");
    if (!data || typeof data !== "object") return [];
    for (const key of ["list", "items", "data", "records"]) {
      const val = data[key];
      if (Array.isArray(val)) return val.filter((x) => x && typeof x === "object");
      if (val && typeof val === "object") {
        const nested = this.listOf(val);
        if (nested.length) return nested;
      }
    }
    return [];
  }

  toItem(raw) {
    let rid = String(raw.id || raw.drama_id || "").trim().replace(/^rp_/, "");
    if (!rid) return null;
    const title = String(raw.name || raw.title || raw.t || rid).trim();
    let total = Number(raw.episode_count || raw.free_episodes || raw.total || 0) || 0;
    const cover = String(raw.img_y || raw.img_x || raw.img || raw.cover || raw.pic || "").trim();
    const tags = [];
    if (raw.category || raw.type) tags.push(String(raw.category || raw.type));
    return {
      id: rid,
      title,
      total,
      cover,
      tags,
      finished: String(raw.update_label || "").includes("全") || !!raw.is_finished,
    };
  }

  freeHls(dramaId, seq) {
    const base = (this.liveBase || this.base).replace(/\/+$/, "");
    const id = String(dramaId || "").replace(/^rp_/, "");
    return `${base}/api/drama/hls/${id}/${Number(seq) || 1}/play.m3u8?line=free`;
  }

  async catalog(category, page) {
    await this.ensureLogin();
    try {
      await this.navList();
    } catch {}
    page = Math.max(1, Number(page) || 1);
    const cat = String(category || "hot").trim();
    const order = cat === "new" ? "new" : "hot";

    if (cat && !["hot", "new", "all", ""].includes(cat)) {
      try {
        const code = this.resolveCode(cat);
        const filt = await this.api("/drama/navFilter", { code: String(code) });
        const fdata = (filt && filt.data) || filt || {};
        const tabs = this.listOf(fdata);
        const picked = tabs[0];
        let items = [];
        if (picked && picked.tab) {
          const block = await this.api("/drama/navBlock", {
            code: String(code),
            tab: String(picked.tab),
            page: String(page),
          });
          const blocks = this.listOf((block && block.data) || block);
          for (const b of blocks) {
            const nested = b.items || b.dramas;
            if (Array.isArray(nested)) items.push(...nested.filter((x) => x && typeof x === "object"));
            else if (b.id || b.drama_id) items.push(b);
          }
        } else if (picked && picked.filter && typeof picked.filter === "object") {
          const flt = picked.filter;
          const req = { page: String(page), page_size: "24", order: `${order}:top` };
          if (flt.cat_id) req.cat_id = flt.cat_id;
          if (flt.tag_id) req.tag_id = flt.tag_id;
          if (flt.source) req.source = flt.source;
          const data = await this.api("/drama/list", req);
          items = this.listOf((data && data.data) || data);
        }
        const shows = items.map((r) => this.toItem(r)).filter(Boolean);
        if (shows.length) return shows.slice(0, 24);
      } catch {}
    }

    const data = await this.api("/drama/list", {
      page: String(page),
      page_size: "24",
      order,
    });
    return this.listOf((data && data.data) || data)
      .map((r) => this.toItem(r))
      .filter(Boolean);
  }

  async search(keyword, page) {
    await this.ensureLogin();
    const data = await this.api("/drama/list", {
      page: String(Math.max(1, Number(page) || 1)),
      page_size: "30",
      keywords: String(keyword || "").trim(),
    });
    return this.listOf((data && data.data) || data)
      .map((r) => this.toItem(r))
      .filter(Boolean);
  }

  async detail(id) {
    await this.ensureLogin();
    const rid = String(id || "").replace(/^rp_/, "");
    const obj = await this.api("/drama/detail", { id: rid });
    const data = (obj && obj.data) || obj || {};
    return data && typeof data === "object" ? data : {};
  }

  async episodes(id) {
    const detail = await this.detail(id);
    const raw = Array.isArray(detail.episodes) ? detail.episodes : [];
    const out = [];
    raw.forEach((ep, i) => {
      if (!ep || typeof ep !== "object") return;
      let n = Number(ep.seq || ep.episode || ep.ep || i + 1) || i + 1;
      let title = String(ep.name || ep.title || `第${n}集`);
      if (String(ep.type || "free") !== "free") title += " [VIP]";
      out.push({ n, title, url: this.freeHls(id, n) });
    });
    out.sort((a, b) => a.n - b.n);
    if (!out.length) {
      const total = Number(detail.episode_count || detail.free_episodes || 0) || 0;
      for (let n = 1; n <= total; n++) out.push({ n, title: `第${n}集`, url: this.freeHls(id, n) });
    }
    return { detail, episodes: out };
  }

  async play(id, ep) {
    await this.ensureLogin();
    const rid = String(id || "").replace(/^rp_/, "");
    const seq = Math.max(1, Number(ep) || 1);
    try {
      const obj = await this.api("/drama/play", { id: rid, seq: String(seq) });
      const data = (obj && obj.data) || {};
      const url = String((data && (data.m3u8 || data.url)) || "").trim();
      if (url) return { url, referer: (this.liveBase || this.base) + "/" };
    } catch {}
    return { url: this.freeHls(rid, seq), referer: (this.liveBase || this.base) + "/" };
  }
}

const bridge = new HuangdouBridge();

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function handleHuangdou(req, res, u) {
  const path = u.pathname.replace(/^\/hd/, "") || "/";
  try {
    if (path === "/health") return json(res, 200, { ok: true, base: bridge.liveBase || bridge.base });
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
      const pack = await bridge.episodes(id);
      const d = pack.detail || {};
      const cover = String(d.img_y || d.img_x || d.cover || d.pic || d.img || "").trim();
      return json(res, 200, {
        ok: true,
        id,
        title: String(d.name || d.title || id),
        cover,
        description: String(d.intro || d.description || d.desc || ""),
        episodes: pack.episodes,
      });
    }
    if (path === "/play") {
      const id = u.searchParams.get("id") || "";
      const ep = u.searchParams.get("ep") || "1";
      if (!id) return json(res, 400, { ok: false, error: "缺少 id" });
      const play = await bridge.play(id, ep);
      return json(res, 200, { ok: true, id, ep: Number(ep) || 1, ...play });
    }
    return json(res, 404, { ok: false, error: "not found" });
  } catch (e) {
    return json(res, 502, { ok: false, error: String((e && e.message) || e) });
  }
}

module.exports = { handleHuangdou, ENUM_CATEGORIES };
