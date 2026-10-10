/**
 * [已拆分] 请改用独立脚本：
 *   widget/huangguo.js  黄果AI + 黄果视频
 *   widget/huangdou.js  黄豆（需 NAS 桥接）
 *   widget/yeguo.js     野果（需 NAS 桥接）
 *
 * 本文件保留兼容：短剧库 - 黄果AI / 黄果视频
 * link："<source>|<id>"；播放走 loadResource 动态取流。
 */
WidgetMetadata = {
  id: "forward.duanju.library",
  title: "短剧库",
  icon: "https://assets.vvebo.vip/scripts/icon.png",
  version: "1.2.0",
  requiredVersion: "0.0.1",
  description: "短剧库：黄果AI、黄果视频（分类浏览、在线播放）",
  author: "Forward",
  site: "https://github.com/InchStudio/ForwardWidgets",
  detailCacheDuration: 300,
  globalParams: [
    { name: "coverProxy", title: "封面代理地址（可选，如 http://192.168.1.10:8787）", type: "input", value: "" },
    { name: "coverToken", title: "封面代理口令（可选）", type: "input", value: "" },
  ],
  modules: [
    {
      id: "loadResource",
      title: "加载资源",
      functionName: "loadResource",
      type: "stream",
      cacheDuration: 0,
      params: [],
    },
    {
      id: "huangguoList",
      title: "黄果AI",
      functionName: "huangguoList",
      cacheDuration: 1800,
      params: [
        {
          name: "category",
          title: "栏目",
          type: "enumeration",
          value: "recommend",
          enumOptions: [
            { title: "精选推荐", value: "recommend" },
            { title: "最近上新", value: "newest" },
            { title: "AI成人短剧", value: "ai-duanju" },
            { title: "AI成人漫剧", value: "ai-manju" },
            { title: "AI换脸", value: "ai-huanlian" },
            { title: "AI魔改", value: "ai-mogai" },
          ],
        },
        { name: "page", title: "页码", type: "page" },
      ],
    },
    {
      id: "huangguovideoList",
      title: "黄果视频",
      functionName: "huangguovideoList",
      cacheDuration: 1800,
      params: [
        {
          name: "category",
          title: "分类",
          type: "enumeration",
          value: "all",
          enumOptions: [
            { title: "全部视频", value: "all" },
            { title: "连续剧", value: "3" },
            { title: "短片", value: "2" },
            { title: "MV/音乐剧", value: "1" },
            { title: "片段", value: "4" },
          ],
        },
        { name: "page", title: "页码", type: "page" },
      ],
    },
  ],
};

// ───────────────────────── 通用工具 ─────────────────────────
var UA_MOBILE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
var HGAI_BASE = "https://huangguoai.com";

function decodeEntities(s) {
  return String(s == null ? "" : s)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function stripTags(s) {
  return decodeEntities(String(s || "").replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

// 沙盒里不一定有 setTimeout，重试之间不做等待
function sleep(ms) {
  return Promise.resolve();
}

async function httpText(url, referer, tries) {
  var lastErr;
  var n = tries || 3;
  for (var i = 0; i < n; i++) {
    try {
      var res = await Widget.http.get(url, {
        headers: {
          "User-Agent": UA_MOBILE,
          Referer: referer || url,
          "Accept-Language": "zh-CN,zh;q=0.9",
        },
        decodable: false,
      });
      var body = res && res.data;
      if (typeof body !== "string") body = body == null ? "" : JSON.stringify(body);
      if (body.length > 0) return body;
      lastErr = new Error("空响应");
    } catch (e) {
      lastErr = e;
    }
    if (i < n - 1) await sleep(400 * (i + 1));
  }
  throw lastErr || new Error("请求失败: " + url);
}

// 不依赖 URL 类：把相对地址解析成绝对地址
function resolveUrl(rel, base) {
  rel = String(rel || "").trim();
  if (/^https?:\/\//i.test(rel)) return rel;
  var m = /^(https?:\/\/[^\/?#]+)([^?#]*)/i.exec(base);
  if (!m) return rel;
  if (rel.indexOf("//") === 0) return base.split(":")[0] + ":" + rel;
  if (rel.charAt(0) === "/") return m[1] + rel;
  var dir = m[2].replace(/[^\/]*$/, "");
  return m[1] + dir + rel;
}

// 黄果AI 的封面是 AES 加密图；配置了封面代理时，改写成代理地址由 NAS 解密后返回
function proxyCover(url, params) {
  var base = String((params && params.coverProxy) || "").trim().replace(/\/+$/, "");
  if (!base || !url) return url;
  if (url.indexOf("pic.wirqed.cn") < 0 && url.indexOf("expose.eisees.com") < 0) return url;
  var tok = String((params && params.coverToken) || "").trim();
  return base + "/cover?u=" + encodeURIComponent(url) + (tok ? "&k=" + encodeURIComponent(tok) : "");
}

function makeLink() {
  return Array.prototype.slice.call(arguments).join("|");
}

function pad2(n) {
  n = Number(n);
  return n < 10 ? "0" + n : String(n);
}

// ───────────────────────── 黄果AI ─────────────────────────
function absUrl(u) {
  u = decodeEntities(u || "").trim();
  if (!u) return "";
  if (u.indexOf("//") === 0) return "https:" + u;
  if (u.charAt(0) === "/") return HGAI_BASE + u;
  return u;
}

function parseHuangguoCards(html) {
  var parts = html.split(/<div\s+class="hg-drama-card[\s"]/).slice(1);
  var out = [];
  var seen = {};
  parts.forEach(function (b) {
    var idm = /href="\/video\/(\d+)\/"/.exec(b);
    if (!idm || seen[idm[1]]) return;
    var id = idm[1];
    seen[id] = true;
    var t = /class="hg-drama-card__title"[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/.exec(b);
    var title = t ? stripTags(t[1].replace(/<span class="sr-only">[\s\S]*?<\/span>/g, "")) : "";
    if (!title) {
      var alt = /alt="([^"]+)"/.exec(b);
      title = alt ? decodeEntities(alt[1]) : id;
    }
    var cov = /data-src="([^"]+)"/.exec(b);
    var desc = /class="hg-drama-card__desc"[^>]*>([\s\S]*?)<\/p>/.exec(b);
    var score = /class="hg-drama-card__score"[^>]*>([\s\S]*?)<\/span>/.exec(b);
    var ep = /data-ep-base="([^"]*)"/.exec(b);
    var badge = /class="hg-drama-card__badge[^"]*"[^>]*>([\s\S]*?)<\/span>/.exec(b);
    var tags = [];
    var tre = /class="hg-tag"[^>]*>([^<]*)</g;
    var tm;
    while ((tm = tre.exec(b))) {
      var tag = decodeEntities(tm[1]).trim();
      if (tag && tags.indexOf(tag) < 0) tags.push(tag);
    }
    var cover = cov ? absUrl(cov[1]) : "";
    var remark = [badge ? stripTags(badge[1]) : "", ep ? decodeEntities(ep[1]) : ""].filter(Boolean).join(" ");
    var scoreText = score ? stripTags(score[1]) : "";
    var d = desc ? stripTags(desc[1]) : "";
    var item = {
      id: "huangguoai:" + id,
      type: "url",
      mediaType: "tv",
      title: title,
      posterPath: cover,
      coverUrl: cover,
      description: ([remark, scoreText].filter(Boolean).join(" · ") + (d ? "\n" + d : "")).trim(),
      genreTitle: tags.slice(0, 3).join(" / "),
      durationText: remark,
      link: makeLink("huangguoai", id),
    };
    var r = parseFloat(scoreText);
    if (r) item.rating = r;
    out.push(item);
  });
  return out;
}

// 站点经 CDN 偶发返回“精简版”页面（卡片数明显偏少），这里取几次里卡片最多的一份。
async function fetchHuangguoCards(url, minCards) {
  var best = [];
  for (var i = 0; i < 4; i++) {
    var html;
    try {
      html = await httpText(url, HGAI_BASE + "/", 1);
    } catch (e) {
      await sleep(400);
      continue;
    }
    var cards = parseHuangguoCards(html);
    if (cards.length > best.length) best = cards;
    if (best.length >= minCards) break;
    await sleep(300);
  }
  if (!best.length) throw new Error("黄果AI页面没有可识别的内容，可能被站点验证拦截");
  return best;
}

var HGAI_PINNED = { 6221: 1, 7326: 1, 3710: 1, 6151: 1 };

function huangguoListUrl(slug, page) {
  return page > 1 ? HGAI_BASE + "/" + slug + "/" + page + "/" : HGAI_BASE + "/" + slug + "/";
}

async function huangguoList(params) {
  params = params || {};
  var page = Number(params.page || 1);
  var slug = params.category || "recommend";
  var paged = slug === "recommend" || slug === "newest";
  if (!paged && page > 1) return [];
  var cards = await fetchHuangguoCards(huangguoListUrl(slug, page), paged ? 24 : 60);
  if (page > 1) {
    cards = cards.filter(function (c) {
      return !HGAI_PINNED[c.link.split("|")[1]];
    });
  }
  cards.forEach(function (c) {
    c.posterPath = proxyCover(c.posterPath, params);
    c.coverUrl = proxyCover(c.coverUrl, params);
  });
  return cards;
}

async function huangguoSearch(keyword, page) {
  page = Number(page || 1);
  var url = HGAI_BASE + "/search/video/" + encodeURIComponent(keyword) + "/" + (page > 1 ? page + "/" : "");
  var cards = await fetchHuangguoCards(url, 1);
  return cards;
}

function readInitialData(html) {
  var m = /<script[^>]*id="videoInitialData"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) return null;
  try {
    return JSON.parse(decodeEntities(m[1]));
  } catch (e) {
    try {
      return JSON.parse(m[1]);
    } catch (e2) {
      return null;
    }
  }
}

async function fetchHuangguoPlay(id, ep) {
  var url = HGAI_BASE + "/video/" + id + "/" + (ep > 1 ? "ep-" + ep + "/" : "");
  var lastErr;
  for (var i = 0; i < 4; i++) {
    try {
      var html = await httpText(url, HGAI_BASE + "/", 1);
      var data = readInitialData(html);
      if (data) return { data: data, html: html };
      lastErr = new Error("页面缺少播放数据");
    } catch (e) {
      lastErr = e;
    }
    await sleep(400 * (i + 1));
  }
  throw lastErr;
}

function pickEpisodeUrl(data, ep) {
  var eps = data.epPlaySrcs || {};
  var u = eps[String(ep)] || (String(data.ep || "1") === String(ep) ? data.videoSrc : "") || "";
  if (!u && ep === 1) u = data.videoSrc || "";
  return absUrl(u);
}

async function huangguoDetail(id, params) {
  var res = await fetchHuangguoPlay(id, 1);
  var d = res.data;
  var html = res.html;
  var eps = [];
  var seen = {};
  var re = /href="\/video\/\d+\/ep-(\d+)\/"/g;
  var m;
  while ((m = re.exec(html))) {
    var n = Number(m[1]);
    if (!seen[n]) {
      seen[n] = true;
      eps.push(n);
    }
  }
  Object.keys(d.epPlaySrcs || {}).forEach(function (k) {
    var n = Number(k);
    if (n && !seen[n]) {
      seen[n] = true;
      eps.push(n);
    }
  });
  if (!seen[1]) eps.push(1);
  eps.sort(function (a, b) {
    return a - b;
  });
  var cover = proxyCover(absUrl(d.posterSrc || d.coverSrc || ""), params);
  var tags = (d.tags || []).filter(Boolean);
  var item = {
    id: "huangguoai:" + id,
    type: "url",
    mediaType: "tv",
    title: d.title || id,
    posterPath: cover,
    coverUrl: cover,
    backdropPath: proxyCover(absUrl(d.coverSrc || d.posterSrc || ""), params),
    description: d.description || "",
    genreTitle: tags.slice(0, 3).join(" / "),
    genreItems: tags.map(function (t) {
      return { id: t, title: t };
    }),
    releaseDate: (d.time || "").slice(0, 10),
    link: makeLink("huangguoai", id),
    episode: eps.length,
  };
  item.episodeItems = eps.map(function (n) {
    return {
      id: "huangguoai:" + id + ":" + n,
      type: "url",
      mediaType: "tv",
      title: "第" + n + "集",
      episode: n,
      posterPath: cover,
      link: makeLink("huangguoai", id, n),
    };
  });
  return item;
}

// 取最高码率的子流（master m3u8 → 最高分辨率/带宽的 variant）；失败就退回原地址，播放器自己会选。
async function bestHls(url, referer) {
  try {
    var res = await Widget.http.get(url, { headers: { "User-Agent": UA_MOBILE, Referer: referer }, decodable: false });
    var text = typeof res.data === "string" ? res.data : "";
    if (text.indexOf("#EXT-X-STREAM-INF") < 0) return { url: url, label: "HLS" };
    var lines = text.split(/\r?\n/);
    var best = null;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i].trim();
      if (l.indexOf("#EXT-X-STREAM-INF") !== 0) continue;
      var next = (lines[i + 1] || "").trim();
      if (!next || next.charAt(0) === "#") continue;
      var rs = /RESOLUTION=(\d+)x(\d+)/i.exec(l);
      var bw = /BANDWIDTH=(\d+)/i.exec(l);
      var h = rs ? Number(rs[2]) : 0;
      var score = h * 1e9 + (bw ? Number(bw[1]) : 0);
      if (!best || score > best.score) {
        best = { score: score, href: next, label: rs ? rs[1] + "x" + rs[2] : "HLS" };
      }
    }
    if (!best) return { url: url, label: "HLS" };
    return { url: resolveUrl(best.href, url), label: best.label };
  } catch (e) {
    return { url: url, label: "HLS" };
  }
}

async function huangguoResource(id, ep) {
  var res = await fetchHuangguoPlay(id, ep);
  var u = pickEpisodeUrl(res.data, ep);
  if (!u) throw new Error("黄果AI 没有返回第" + ep + "集的播放地址");
  var headers = { "User-Agent": UA_MOBILE, Referer: HGAI_BASE + "/" };
  var out = [];
  if (/\.m3u8/i.test(u)) {
    var best = await bestHls(u, HGAI_BASE + "/");
    if (best.url !== u) out.push({ name: "黄果AI 高清", description: best.label + " | HLS", url: best.url, customHeaders: headers });
    out.push({ name: "黄果AI 自适应", description: "HLS", url: u, customHeaders: headers });
  } else {
    out.push({ name: "黄果AI", description: "mp4", url: u, customHeaders: headers });
  }
  return out;
}

// ───────────────────────── 黄果视频 (huangguo.video) ─────────────────────────
// 站点在命令行环境会被 Cloudflare 拦截(403)，真实 WebKit 可正常访问；模块运行在 App 内，按浏览器同等对待。
var HGV_BASE = "https://huangguo.video";

function hgvAbs(u) {
  u = decodeEntities(u || "").trim();
  if (!u) return "";
  if (u.indexOf("//") === 0) return "https:" + u;
  if (u.charAt(0) === "/") return HGV_BASE + u;
  return u;
}

// 同时兼容列表页 video-card 与搜索页 search-content-card
function parseHgvCards(html) {
  var blocks = html.match(/<article class="(?:video-card|search-content-card)[\s\S]*?<\/article>/g) || [];
  var out = [];
  var seen = {};
  blocks.forEach(function (b) {
    var lm = /href="\/(series|video)\/([^"?#]+)"/.exec(b);
    if (!lm || seen[lm[1] + lm[2]]) return;
    var kind = lm[1];
    var id = lm[2];
    seen[kind + id] = true;
    var alt = /alt="([^"]*)"/.exec(b);
    var pt = /<p class="[^"]*(?:truncate|line-clamp)[^"]*"[^>]*>([^<]*)</.exec(b);
    var title = decodeEntities((alt && alt[1]) || (pt && pt[1]) || id).trim();
    var img = /<img[^>]*src="([^"]+)"/.exec(b);
    var cover = img ? hgvAbs(img[1]) : "";
    var pills = [];
    var pre = /<span class="[^"]*(?:bg-black|cover-pill)[^"]*"[^>]*>([^<]*)</g;
    var pm;
    while ((pm = pre.exec(b))) {
      var pv = decodeEntities(pm[1]).trim();
      if (pv && pv !== "限制级") pills.push(pv);
    }
    var remark = pills.join(" ");
    out.push({
      id: "huangguovideo:" + kind + ":" + id,
      type: "url",
      mediaType: kind === "series" ? "tv" : "movie",
      title: title,
      posterPath: cover,
      coverUrl: cover,
      description: remark,
      durationText: remark,
      link: makeLink("huangguovideo", kind, id),
    });
  });
  return out;
}

async function huangguovideoList(params) {
  params = params || {};
  var page = Number(params.page || 1);
  var cat = params.category || "all";
  var q = [];
  if (cat && cat !== "all") q.push("category=" + cat);
  if (page > 1) q.push("page=" + page);
  var url = HGV_BASE + "/videos" + (q.length ? "?" + q.join("&") : "");
  var html = await httpText(url, HGV_BASE + "/");
  return parseHgvCards(html);
}

async function huangguovideoSearch(keyword, page) {
  if (Number(page || 1) > 1) return [];
  if (String(keyword).length < 2) return [];
  var html = await httpText(HGV_BASE + "/search?q=" + encodeURIComponent(keyword), HGV_BASE + "/");
  return parseHgvCards(html);
}

function hgvHls(html) {
  var m = /data-hls="([^"]+)"/.exec(html);
  return m ? hgvAbs(m[1]) : "";
}

function parseHgvEpisodes(html) {
  var eps = [];
  var seen = {};
  var re = /<a[^>]*href="\/video\/([^"?#]+)"[^>]*>([\s\S]*?)<\/a>/g;
  var m;
  while ((m = re.exec(html))) {
    var vid = m[1];
    var text = stripTags(m[2]);
    var nm = /第\s*(\d+)\s*集/.exec(text);
    if (!nm || seen[vid]) continue;
    seen[vid] = true;
    eps.push({ vid: vid, n: Number(nm[1]) });
  }
  eps.sort(function (a, b) {
    return a.n - b.n;
  });
  // “开始观看”按钮指向第 1 集但文字里没有集号；没扫到任何集号时退回该链接作为唯一一集
  if (!eps.length) {
    var first = /<a[^>]*href="\/video\/([^"?#]+)"[^>]*>\s*开始观看/.exec(html);
    if (first) eps.push({ vid: first[1], n: 1 });
  }
  return eps;
}

var HGV_EP_CACHE = {};
async function huangguovideoEpisodes(id) {
  if (HGV_EP_CACHE[id]) return HGV_EP_CACHE[id];
  var html = await httpText(HGV_BASE + "/series/" + id, HGV_BASE + "/");
  var eps = parseHgvEpisodes(html);
  if (eps.length) HGV_EP_CACHE[id] = eps;
  return eps;
}

async function huangguovideoDetail(kind, id) {
  var html = await httpText(HGV_BASE + "/" + kind + "/" + id, HGV_BASE + "/");
  var h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
  var title = h1 ? stripTags(h1[1]) : id;
  var og = /property="og:image"[^>]*content="([^"]*)"/.exec(html);
  var dm = /<meta[^>]*(?:name|property)="(?:og:)?description"[^>]*content="([^"]*)"/.exec(html);
  var cover = og ? hgvAbs(og[1]) : "";
  var item = {
    id: "huangguovideo:" + kind + ":" + id,
    type: "url",
    mediaType: kind === "series" ? "tv" : "movie",
    title: title.replace(/\s*·.*$/, ""),
    posterPath: cover,
    coverUrl: cover,
    backdropPath: cover,
    description: dm ? decodeEntities(dm[1]) : "",
    link: makeLink("huangguovideo", kind, id),
  };
  if (kind === "video") {
    item.videoUrl = hgvHls(html);
    return item;
  }
  var eps = parseHgvEpisodes(html);
  item.episode = eps.length;
  item.episodeItems = eps.map(function (e) {
    return {
      id: "huangguovideo:video:" + e.vid,
      type: "url",
      mediaType: "tv",
      title: "第" + e.n + "集",
      episode: e.n,
      posterPath: cover,
      link: makeLink("huangguovideo", "video", e.vid, e.n),
    };
  });
  return item;
}

// 取流：播放页 data-hls 指向 master.m3u8（480p/720p/1080p，AES-128 加密，密钥由播放器按 m3u8 内 URI 自取）。
async function huangguovideoResource(vid) {
  var html = await httpText(HGV_BASE + "/video/" + vid, HGV_BASE + "/", 2);
  var master = hgvHls(html);
  if (!master) throw new Error("黄果视频没有返回播放地址");
  var headers = { "User-Agent": UA_MOBILE, Referer: HGV_BASE + "/" };
  // master 里含 480p/720p/1080p 三档，交给播放器自适应，省掉一次额外请求
  return [{ name: "黄果视频", description: "HLS 自适应 480p/720p/1080p", url: master, customHeaders: headers }];
}

// ───────────────────────── 搜索 / 详情 / 取流 入口 ─────────────────────────
async function loadDetail(link, params) {
  var p = String(link || "").split("|");
  var source = p[0];
  var id = p[1];
  if (!id) return null;
  if (source === "huangguovideo" && !p[2]) return null;
  try {
    if (source === "huangguoai") return await huangguoDetail(id, params);
    if (source === "huangguovideo") return await huangguovideoDetail(p[1], p[2]);
  } catch (e) {
    console.error("[loadDetail] 失败:", (e && e.message) || e);
    throw e;
  }
  return null;
}

// loadResource 会带上单集的 link（"source|id|集标识|序号"）。
async function loadResource(params) {
  params = params || {};
  console.log("[loadResource] params=" + JSON.stringify(params));
  try {
    var r = await loadResourceInner(params);
    console.log("[loadResource] ok, 线路数=" + r.length + " 首条=" + (r[0] && r[0].url));
    return r;
  } catch (e) {
    var msg = (e && e.message) || String(e);
    console.error("[loadResource] 失败: " + msg);
    // App 的线路卡片只显示 name，所以把原因直接放进名称里（截断避免过长）
    var keys = Object.keys(params || {}).join(",");
    return [
      { name: "失败:" + msg.slice(0, 80), description: msg, url: "https://example.invalid/e1" },
      { name: "link=" + String((params && params.link) || "空").slice(0, 60), description: "keys=" + keys, url: "https://example.invalid/e2" },
      { name: "id=" + String((params && params.id) || "空").slice(0, 60) + " ep=" + String((params && params.episode) || "空"), description: "keys=" + keys, url: "https://example.invalid/e3" },
    ];
  }
}

function knownSource(x) {
  var h = String(x || "").split("|")[0];
  return h === "huangguoai" || h === "huangguovideo";
}

async function loadResourceInner(params) {
  // link 可能是单集 link；若 App 传来的是别的字段（id / videoUrl），依次兜底
  var raw = [params.link, params.id, params.videoUrl].filter(knownSource)[0] || "";
  if (!raw) {
    throw new Error("没有收到可识别的 link。收到的参数: " + JSON.stringify(params));
  }
  var p = String(raw).split("|");
  var source = p[0];
  // App 拿到的是整部剧的 link，具体集号在 params.episode（从 1 开始）；没有就当第 1 集
  var epNo = Number(params.episode) || 1;
  if (source === "huangguoai") {
    return await huangguoResource(p[1], Number(p[2]) || epNo);
  }
  if (source === "huangguovideo") {
    // 单集/单视频 link: huangguovideo|video|<vid>[|n]；剧集 link: huangguovideo|series|<id>
    if (p[1] === "video" && p[2]) return await huangguovideoResource(p[2]);
    var evs = await huangguovideoEpisodes(p[2]);
    if (!evs.length) throw new Error("黄果视频没有解析到剧集");
    var hit = evs.filter(function (e) {
      return e.n === epNo;
    })[0] || evs[epNo - 1];
    if (!hit) throw new Error("黄果视频没有第 " + epNo + " 集");
    return await huangguovideoResource(hit.vid);
  }
  throw new Error("未知站源: " + source);
}

