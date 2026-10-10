/**
 * 黄豆 Forward 脚本（独立）
 * 经 NAS 桥接加密 API：填写 bridge = http://NAS:8787
 * link： huangdou|<id>  /  huangdou|<id>|<集号>
 * 封面：接口直链，一般无需解密代理
 */
WidgetMetadata = {
  id: "forward.huangdou",
  title: "黄豆",
  icon: "https://assets.vvebo.vip/scripts/icon.png",
  version: "1.0.0",
  requiredVersion: "0.0.1",
  description: "黄豆短剧：分类浏览、封面、在线播放（需 NAS 桥接服务）",
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
      id: "huangdouList",
      title: "黄豆",
      functionName: "huangdouList",
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
            { title: "黄豆原创", value: "yuandou" },
            { title: "魔改短剧", value: "mod" },
            { title: "擦边短剧", value: "caibian" },
            { title: "真人短剧", value: "zhenren" },
            { title: "动漫", value: "erciyuan" },
            { title: "影院", value: "aiman" },
            { title: "贤者", value: "zongyi" },
            { title: "黑料", value: "heiliao" },
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
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";

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
  return {
    id: "huangdou:" + id,
    type: "url",
    mediaType: "tv",
    title: title,
    posterPath: cover,
    coverUrl: cover,
    description: total ? "共" + total + "集" : "",
    genreTitle: Array.isArray(tags) ? tags.slice(0, 3).join(" / ") : "",
    durationText: total ? total + "集" : "",
    link: "huangdou|" + id,
  };
}

async function huangdouList(params) {
  params = params || {};
  var page = Number(params.page || 1);
  var cat = params.category || "hot";
  var data = await bridgeGet(
    "/hd/catalog?category=" + encodeURIComponent(cat) + "&page=" + page,
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
    "/hd/search?q=" + encodeURIComponent(kw) + "&page=" + page,
    params
  );
  return ((data && data.items) || []).map(toVideoItem).filter(Boolean);
}

async function loadDetail(link, params) {
  var p = String(link || "").split("|");
  if (p[0] !== "huangdou" || !p[1]) return null;
  var id = p[1];
  var data = await bridgeGet("/hd/detail?id=" + encodeURIComponent(id), params || {});
  var cover = String((data && data.cover) || "").trim();
  var eps = (data && data.episodes) || [];
  var item = {
    id: "huangdou:" + id,
    type: "url",
    mediaType: "tv",
    title: (data && data.title) || id,
    posterPath: cover,
    coverUrl: cover,
    backdropPath: cover,
    description: (data && data.description) || "",
    link: "huangdou|" + id,
    episode: eps.length,
  };
  item.episodeItems = eps.map(function (e) {
    var n = Number(e.n || e.episode || 0) || 1;
    return {
      id: "huangdou:" + id + ":" + n,
      type: "url",
      mediaType: "tv",
      title: e.title || "第" + n + "集",
      episode: n,
      posterPath: cover,
      link: "huangdou|" + id + "|" + n,
    };
  });
  return item;
}

async function loadResource(params) {
  params = params || {};
  try {
    var raw = String(params.link || params.id || "");
    var parts = raw.split("|");
    if (parts[0] !== "huangdou" || !parts[1]) {
      throw new Error("没有可识别的黄豆 link");
    }
    var id = parts[1];
    var ep = Number(parts[2] || params.episode || 1) || 1;
    var data = await bridgeGet(
      "/hd/play?id=" + encodeURIComponent(id) + "&ep=" + ep,
      params
    );
    var url = String((data && data.url) || "").trim();
    if (!url) throw new Error("没有播放地址");
    var referer = String((data && data.referer) || "").trim() || url;
    return [
      {
        name: "黄豆",
        description: "HLS",
        url: url,
        customHeaders: { "User-Agent": UA, Referer: referer },
      },
    ];
  } catch (e) {
    var msg = (e && e.message) || String(e);
    return [{ name: "失败:" + msg.slice(0, 80), description: msg, url: "https://example.invalid/e1" }];
  }
}
