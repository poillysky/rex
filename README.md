# Forward 短剧脚本（黄果 / 黄豆 / 野果）

三个**互相独立**的 Forward JS 脚本，各自导入即可用；播放与封面能力如下。

| 脚本 | 文件 | 播放 | 封面 | 是否需要 NAS 服务 |
| --- | --- | --- | --- | --- |
| **黄果** | `widget/huangguo.js` | 黄果AI + 黄果视频 | AI 需解密代理；视频直链 | **可选**（只要 AI 封面） |
| **黄豆** | `widget/huangdou.js` | HLS | 接口直链 | **必填**桥接地址 |
| **野果** | `widget/yeguo.js` | HLS | 接口直链 | **必填**桥接地址 |

旧文件 `widget/duanju.js` 仍是早期「短剧库」合并版，新装请用上面三个独立脚本。

---

## 一、导入脚本

1. 把对应 `.js` 放到 Forward 能访问的位置（本地或自建托管）。
2. 在 Forward 里分别导入：
   - `huangguo.js` → 模块名「黄果」
   - `huangdou.js` → 模块名「黄豆」
   - `yeguo.js` → 模块名「野果」
3. 点进任意一部，选集播放。

---

## 二、部署 NAS 桥接服务

目录：`server/`（Node 18+，零 npm 依赖）。

同一服务同时提供：

| 路径 | 作用 |
| --- | --- |
| `GET /health` | 健康检查，返回 `ok` |
| `GET /cover?u=...&k=口令` | 黄果 AI 封面解密 |
| `GET /hd/catalog|search|detail|play` | 黄豆加密 API 桥 |
| `GET /yg/catalog|search|detail|play` | 野果加密 API 桥 |

### Docker / NAS 拉取（推荐）

镜像：[`poillysky/rex`](https://hub.docker.com/r/poillysky/rex)（GitHub Actions 自动构建推送）。  
`docker-compose.yml` 为 **纯拉取模式**（`pull_policy: always`，无 `build`）。

1. 把 `server/docker-compose.yml` 与 `.env` 放到同一目录（可先复制 `.env.example` 为 `.env`）。
2. 在 `.env` 里填写 `TOKEN=你的口令`（不要把真实口令提交到 Git）。
3. 执行：

   ```bash
   docker compose pull
   docker compose up -d
   ```

4. 浏览器打开 `http://NAS的IP:8787/health`，看到 `ok` 即成功。

更新镜像：再执行一次 `docker compose pull && docker compose up -d`。

### 直接用 Node

```bash
cd server
TOKEN=你的口令 node server.js
```

### 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | 监听端口 |
| `TOKEN` | 空 | 访问口令；设置后请求需带 `&k=口令`，**建议设置** |
| `ALLOW_HOSTS` | `pic.wirqed.cn,expose.eisees.com` | 封面代理白名单域名 |
| `COVER_KEY` / `COVER_IV` | 内置 | 黄果封面密钥（站点换钥时覆盖） |
| `HD_LINES` | 内置多线 | 黄豆线路，逗号分隔 |
| `YG_LINES` | 内置多线 | 野果 api.php 线路 |
| `YG_SITE` | `https://analyze.buxefaex.cc` | 野果 Origin/Referer |
| `HTTP_PROXY` / `HTTPS_PROXY` | 空 | NAS 访问站源需要代理时填写（Node 22+ 可再加 `NODE_USE_ENV_PROXY=1`） |

---

## 三、在各模块里填写

### 黄果

模块设置：

- **封面代理地址**：`http://NAS的IP:8787`（不要末尾 `/`）
- **封面代理口令**：与 `TOKEN` 一致；没设就留空

不填也能播，只是黄果 AI 列表可能没有封面。黄果视频封面不受影响。

### 黄豆 / 野果

模块设置（必填）：

- **桥接地址**：`http://NAS的IP:8787`
- **桥接口令**：与 `TOKEN` 一致；没设就留空

---

## 四、出门在外

局域网 IP 只在家里能用。外网需要：

- 内网穿透 / 反代 / DDNS 暴露 `8787`，并**务必设置 `TOKEN`**
- 或 Tailscale / ZeroTier 组网后继续用内网地址

iOS 对纯 `http` 有时会限制；若只在 App 里封面/桥接失败，可给服务套一层 `https`。

---

## 常见问题

**Q：黄豆/野果提示「请先填写桥接地址」？**  
模块设置里填 `http://NAS:8787`，保存后刷新列表。

**Q：黄果 AI 封面不显示？**  
1. 浏览器打开 `http://NAS:8787/health` 是否 `ok`  
2. 口令是否与 `TOKEN` 一致  
3. 地址不要带结尾 `/`，也不要误写成 `https`（除非你配了证书）

**Q：封面突然全挂、桥接返回 decrypt failed？**  
站点可能换了密钥。黄果看服务日志；野果可用 `YG_API_KEY` / `YG_API_IV` 覆盖。

**Q：还要不要导入旧的 `duanju.js`？**  
不需要。功能已拆到 `huangguo.js`（含黄果 AI + 黄果视频）。

---

## 已知限制

- 红果未收录（需服务端签名与视频解密，不适合「导入即用」）。
- 站点改版（页面结构、加密密钥、域名）时模块可能失效，需更新脚本或桥接。
- 内容来自第三方站点，请遵守你所在地区的法律法规。
