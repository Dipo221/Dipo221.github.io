# Dipo221.github.io

MingYang 的個人首頁，透過 GitHub Pages 發布於 <https://dipo221.github.io>。

純靜態：沒有 build step、沒有框架、沒有 npm。clone 下來用瀏覽器打開 `index.html`
就是它上線的樣子，push 到 `main` 大約 30 秒後生效。

## 首頁有什麼

一頁式，由上到下：

| 區塊 | 內容 |
|---|---|
| 標頭 | 名字、一句 tagline，右上角一顆主題切換鈕（只有首頁有這顆） |
| 關於我 | 研究：TKU 人工智慧機器人碩士班／工讀：味全龍 商品部 |
| ICLab | 實驗室的 GitHub repo（`ros2_kid`、`ros2_adult`）與兩篇 Notion 筆記 |
| 小工具 | 四張卡片，分別進到 `tools/` 底下自己寫的頁面 |
| 連結 | GitHub、Email |

**ICLab 用膠囊、小工具用卡片，是刻意分的**：在這個站，卡片代表「點下去會進到
我自己寫的頁面」，膠囊代表會離開這個站。混用訪客就分不出哪個會把他踢出站外。
以後真的做出實驗室工具，那區再補一個 `<h3 class="tool-group">` 加一個 `.tool-grid`，
那時候卡片和膠囊的分工才有意義。

Notion 的連結一定要用 `notion.site` 的網址——那是按下 Publish 之後才產生的。
Notion 裡「複製連結」給的 `app.notion.com/p/…` 是工作區內部連結，
沒登入的人點開只有登入牆。

## 全站共用的東西

根目錄這三支每個頁面都載，改它們等於改全站：

| | |
|---|---|
| `style.css` | 設計 token（深色是預設，`[data-theme="light"]` 覆寫同一組名稱）、版面、共用元件 |
| `theme.js` | 明暗主題。**要放在 `<head>` 裡、排在樣式表前面、不能加 `defer`**——`data-theme` 得在第一次 paint 之前設好，晚一步重整就會閃一下深色 |
| `script.js` | 頁尾年份等小腳本 |

沒自己選過主題就跟著系統偏好跑，選過就記在 `localStorage`。工具頁也載 `theme.js`，
但沒有切換鈕，跟著首頁選好的走。localStorage 的 key 一律 `<範圍>:<功能>`，
例如 `mingyang:theme`、`open-now:github-token`。

字體在 `fonts/`，自己託管不接 Google Fonts。Space Grotesk（只含拉丁子集的
variable woff2，22 KB）當顯示字體，中文靠 CSS 的逐字元 fallback 落回系統字，
不需要任何判斷邏輯。`cubic-11.woff2` 是 cat-room 手機版專用的 8-bit 中文字，
只有那一頁的窄螢幕會載。

所有 `<link>` 和 `<script>` 都帶 `?v=N` 擋快取，**改到檔案就要遞增**，
漏了回訪的人看到舊版。

設計規則（token 名稱、元件數值、新增工具頁的流程、不要做的事）在
`.claude/skills/site-design/SKILL.md`，動到外觀之前先讀那份；
上線前的自我檢查在 `.claude/skills/site-check/SKILL.md`。

## 小工具

四個，各自一個資料夾，細節寫在各自的 README。

**🍜 現在吃什麼** — `tools/open-now/`
看淡水現在有哪些店還開著，店家資料手動維護在 `places.json`。
標籤篩選會自己挑該露出哪幾個，鈕上的數字是「現在有開」的家數。
連點時鐘五下會開出編輯介面，存檔直接 commit 回這個 repo。
→ [README](tools/open-now/README.md)

**🐈 uiia cat** — `tools/uiia-cat/`
點一下貓就轉並發出聲音，次數是全世界一起累積的。
純靜態站沒有後端，計數掛在 Abacus 這個免費共用計數服務上；
音檔裡三聲 uiia 是同一個檔案播不同區間，不切成三個檔。

**🐾 Disi** — `tools/cat-room/`
一隻像素貓住在一個 20×11 格的閣樓裡，自己過生活，點房間裡的東西跟牠互動。
光和作息跟台北時間走，窗外跟著淡水真實的天氣變。
**什麼都不衰減**——沒有飢餓值、bond 只增不減，離開不會被懲罰。
貓和房間不是畫的，是 `art/` 底下的 Python 算出來的。
→ [README](tools/cat-room/README.md)、[CHANGELOG](tools/cat-room/CHANGELOG.md)、[TODO](tools/cat-room/TODO.md)

**⚾ MLB 追蹤** — `tools/mlb/`
給 fantasy baseball 用的看板，九區分成「我的／傷兵／打擊／其他」：
關注名單、我的球員、傷兵異動與名單、強擊球、Barrel、連續場次、
球員異動、連勝連敗、新聞。每一區可以再換檢視和篩球隊。
資料由 GitHub Actions 定時抓 MLB Stats API、落地成 `data.json`，
前端只讀這份靜態檔——不在瀏覽器打 statsapi，免得有 CORS，
也不讓每個訪客都去敲一次別人的 API。關注名單存在 localStorage，
`watchlist.json` 降級成「本機還沒有名單時的預設值」。

## 開發

```
├── index.html          首頁
├── style.css           設計 token + 全站版面
├── theme.js            明暗主題（要在 paint 前跑）
├── script.js           頁尾年份等
├── fonts/              自己託管的字體 + 授權全文
├── tools/<名稱>/       一個工具一個資料夾，各帶自己的 index.html / style.css / script.js
├── scripts/mlb/        抓 MLB 資料的 Python（只在 CI 跑，不是網頁的一部分）
└── .github/workflows/  mlb.yml
```

**測試**：`tools/open-now/test.html`、`tools/cat-room/test.html`、`tools/mlb/test.html`
——瀏覽器打開就跑，手寫 runner，不用裝任何東西。改到那幾支純邏輯的檔案就看一下是不是全綠。

**MLB 的排程**（`.github/workflows/mlb.yml`）：一小時點火三次。
GitHub 的 schedule 是 best-effort，佇列忙的時候是整輪丟掉而不是延後，
單次只有約兩成會跑到，所以用三次獨立的機會換「至少中一次」。
內容沒變就不重寫檔案，所以多跑的那幾輪會安靜結束。
更新間隔實際上是一到三小時，頁首那個時間是這份資料真正的產出時刻。
排程照球季行事曆走——例行賽結束就停更，春訓開打再恢復。

**`main` 會被這個排程自己推 commit**，所以 push 之前先 `git pull --rebase`。
