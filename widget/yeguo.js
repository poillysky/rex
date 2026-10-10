/**
 * 野果 Forward 脚本（独立）
 * 经 NAS 桥接加密 API：填写 bridge = http://NAS:8787
 * link： yeguo|<id>  /  yeguo|<id>|<episode_id>|<集号>
 * 封面：接口直链
 */
WidgetMetadata = {
  id: "forward.yeguo",
  title: "野果",
  icon: "https://assets.vvebo.vip/scripts/icon.png",
  version: "1.0.0",
  requiredVersion: "0.0.1",
  description: "野果短剧：分类浏览、封面、在线播放（需 NAS 桥接服务）",
  author: "Forward",
  site: "https://github.com/InchStudio/ForwardWidgets",
  detailCacheDuration: 300,
  globalParams: [
    { name: "bridge", title: "桥接地址（必填，如 http://192.168.1.10:8787）", type: "input", value: "" },
    { name: "bridgeToken", title: "桥接口令（可选，与服务 TOKEN 一致）", type: "input", value: "" },
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
      id: "yeguoList",
      title: "野果",
      functionName: "yeguoList",
      cacheDuration: 1800,
      params: [
        {
          name: "category",
          title: "分类",
          type: "enumeration",
          value: "hot",
          enumOptions: [
            { title: "热门", value: "hot" },
            { title: "最新", value: "new" },
            { title: "野果原创", value: "theme:7" },
            { title: "真人短剧", value: "theme:8" },
            { title: "魔改漫剧", value: "theme:9" },
            { title: "网红改编", value: "theme:10" },
            { title: "PMV裸舞", value: "theme:11" },
          ],
        },
        { name: "page", title: "页码", type: "page" },
      ],
    },
  ],
  search: {
    title: "搜索",
    functionName: "search",
    params: [
      { name: "keyword", title: "关键词", type: "input" },
      { name: "page", title: "页码", type: "page" },
    ],
  },
};

var UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

function bridgeBase(params) {
  return String((params && params.bridge) || "").trim().replace(/\/+$/, "");
}

function withToken(url, params) {
  var tok = String((params && params.bridgeToken) || "").trim();
  if (!tok) return url;
  return url + (url.indexOf("?") >= 0 ? "&" : "?") + "k=" + encodeURIComponent(tok);
}

async function bridgeGet(path, params) {
  var base = bridgeBase(params);
  if (!base) throw new Error("请先在模块设置里填写桥接地址（NAS 上的 :8787 服务）");
  var url = withToken(base + path, params);
  var res = await Widget.http.get(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    decodable: false,
  });
  var body = res && res.data;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (e) {
      throw new Error("桥接返回非 JSON");
    }
  }
  if (!body || body.ok === false) throw new Error((body && body.error) || "桥接失败");
  return body;
}

function toVideoItem(it) {
  var id = String((it && it.id) || "").trim();
  if (!id) return null;
  var cover = String((it && it.cover) || "").trim();
  var title = String((it && it.title) || id);
  var total = Number((it && it.total) || 0) || 0;
  var tags = (it && it.tags) || [];
  var remark = (it && it.finished) ? "完结" : total ? total + "集" : "";
  return {
    id: "yeguo:" + id,
    type: "url",
    mediaType: "tv",
    title: title,
    posterPath: cover,
    coverUrl: cover,
    description: remark,
    genreTitle: Array.isArray(tags) ? tags.slice(0, 3).join(" / ") : "",
    durationText: remark,
    link: "yeguo|" + id,
  };
}

async function yeguoList(params) {
  params = params || {};
  var page = Number(params.page || 1);
  var cat = params.category || "hot";
  var data = await bridgeGet(
    "/yg/catalog?category=" + encodeURIComponent(cat) + "&page=" + page,
    params
  );
  return ((data && data.items) || []).map(toVideoItem).filter(Boolean);
}

async function search(params) {
  params = params || {};
  var kw = String(params.keyword || params.q || "").trim();
  if (!kw) return [];
  var page = Number(params.page || 1);
  var data = await bridgeGet(
    "/yg/search?q=" + encodeURIComponent(kw) + "&page=" + page,
    params
  );
  return ((data && data.items) || []).map(toVideoItem).filter(Boolean);
}

async function loadDetail(link, params) {
  var p = String(link || "").split("|");
  if (p[0] !== "yeguo" || !p[1]) return null;
  var id = p[1];
  var data = await bridgeGet("/yg/detail?id=" + encodeURIComponent(id), params || {});
  var cover = String((data && data.cover) || "").trim();
  var eps = (data && data.episodes) || [];
  var item = {
    id: "yeguo:" + id,
    type: "url",
    mediaType: "tv",
    title: (data && data.title) || id,
    posterPath: cover,
    coverUrl: cover,
    backdropPath: cover,
    description: (data && data.description) || "",
    link: "yeguo|" + id,
    episode: eps.length,
  };
  item.episodeItems = eps.map(function (e) {
    var n = Number(e.n || 0) || 1;
    var eid = String(e.episode_id || "");
    return {
      id: "yeguo:" + id + ":" + eid,
      type: "url",
      mediaType: "tv",
      title: e.title || "第" + n + "集",
      episode: n,
      posterPath: cover,
      link: "yeguo|" + id + "|" + eid + "|" + n,
    };
  });
  return item;
}

async function loadResource(params) {
  params = params || {};
  try {
    var raw = String(params.link || params.id || "");
    var parts = raw.split("|");
    if (parts[0] !== "yeguo" || !parts[1]) throw new Error("没有可识别的野果 link");
    var id = parts[1];
    var episodeId = parts.length >= 4 ? parts[2] : "";
    var ep = Number(parts.length >= 4 ? parts[3] : parts[2] || params.episode || 1) || 1;
    if (parts.length === 3 && String(parts[2]).length > 4) {
      // yeguo|id|episode_id
      episodeId = parts[2];
      ep = Number(params.episode || 1) || 1;
    }
    var q =
      "/yg/play?id=" +
      encodeURIComponent(id) +
      "&ep=" +
      ep +
      (episodeId ? "&episode_id=" + encodeURIComponent(episodeId) : "");
    var data = await bridgeGet(q, params);
    var url = String((data && data.url) || "").trim();
    if (!url) throw new Error("没有播放地址");
    var referer = String((data && data.referer) || "").trim() || url;
    return [
      {
        name: "野果",
        description: (data && data.resolution) || "HLS",
        url: url,
        customHeaders: { "User-Agent": UA, Referer: referer },
      },
    ];
  } catch (e) {
    var msg = (e && e.message) || String(e);
    return [{ name: "失败:" + msg.slice(0, 80), description: msg, url: "https://example.invalid/e1" }];
  }
}
