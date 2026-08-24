---
name: site-design
description: 這個站的設計規則與既有設計系統。當使用者要新增小工具頁、改版面／配色／字體、調整任何看得到的外觀，或問「這樣好看嗎」「幫我美化」時使用。純邏輯、資料處理、不影響外觀的修改不需要。
allowed-tools: Read, Edit, Write, Grep, Glob, Bash
---

# 這個站的設計規則

`dipo221.github.io`。純靜態、無 build step、GitHub Pages。
規模小，所以規則要短；但既有的東西已經成系統，**動手前先讀，不要重新發明**。

---

## 1. 先讀，再動手

寫任何一行之前先看這三個地方，並把看到的講出來：

- `style.css` 的 `:root` 和 `[data-theme="light"]` — 現有的 token 名稱與值
- 要改的那頁的 `index.html` — 載入順序、版本號
- 同性質的既有元件 — 例如要做卡片，先看 `tools/open-now/style.css` 的 `.card`

**關鍵事實：`:root` 是全站共用的。**
`tools/open-now/style.css` 只補了狀態色，`tools/uiia-cat/style.css` 連 `:root` 都沒有。
改根目錄的 token 等於改全站 —— 這是刻意的好設計，順著它做。

## 2. 已經有的系統（照用，不要另開一套）

**顏色** — 全部定義在根目錄 `style.css`，深色是預設，`[data-theme="light"]` 覆寫同一組名稱：

```
--bg  --bg-elevated  --text  --muted  --accent  --border
--accent-ink    accent 當底色時，壓在上面的字用這個
--accent-soft   accent 的淡化版，做高亮背景
```

`tools/open-now` 另外補 `--open` / `--soon` / `--broken`（各有 `-bg` 淡背景版），兩個主題各一組。

**字階與尺寸**：`--fs-hero` `--fs-h2` `--fs-lead` `--fs-sm` `--fs-xs`、`--radius`(8px)、`--radius-pill`(999px)、`--speed`(0.15s)

**元件手感**（新元件沿用這些數值，不要自己挑）：

| | 數值 |
|---|---|
| 卡片 | `padding: 14~16px` · `radius: 8px` · 左側 3px 色條 · hover `translateX(2px)` |
| 圓角鈕 / chip | `padding: 6~7px 12~15px` · `radius: 999px` · `0.85~0.9375rem` |
| 過場 | `0.15s`，全站統一 |

**技術慣例**：無 build step、全域 script（IIFE + `window.X` 暴露）、無 ES module。
localStorage key 一律 `<範圍>:<功能>`，例如 `open-now:github-token`、`mingyang:theme`。
測試是 `test.html`，打開就跑，手寫 runner。

**兩個已知的坑**：
- `.container`（class）權重比 `main`（element）高，單寫 `main { padding }` 會被蓋掉。要用 `main.container`。
- 所有 `<link>` 和 `<script>` 都帶 `?v=N` 擋快取。**改到檔案就要遞增**，漏了回訪者看到舊版。

## 3. 動手前

**先講清楚要改哪些檔案，再改。** 刪檔一定要先問。

判斷這次是哪一種，選最小的那個：

- **延伸** — 加新東西，要跟既有的長得分不出來。沿用現有 token 與元件，不新增視覺語彙。
- **改版・保留** — 重做視覺，但保留結構、路由、內容意圖。**預設是這一種。**
- **改版・翻掉** — 只有使用者明說才做。

## 4. 不要做的事

不是品味潔癖，是**辨識度**：AI 預設 = 訓練資料的平均 = 每個站長一樣 = 你的站沒有臉。
所以每條的例外都是同一句：**「這個站本來就這樣」**。

| 別做 | 例外 |
|---|---|
| 紫→粉→藍漸層 | 無 |
| emoji 當 icon 填空 | ✅ 這個站本來就用（🐈 🍜 🎲），維持既有密度就好，不要加更多 |
| 圓角卡 + 左側色條 | ✅ `open-now` 的 `.card` 本來就是，這是既有語彙不是套模板 |
| 標題用斜體 / 標題中夾一個斜體字強調 | 無。用字重、accent 色、底線代替 |
| 手繪 SVG 人臉、CSS 剪影充當真圖 | 無。用真圖或誠實的 placeholder |
| 捏造數字、假評價、假 logo 牆 | 無。沒有資料就放 placeholder，不要編 |
| `01 · 章節` 這種編號 eyebrow | 只有內容真的有序才用 |
| 標題左、內文右的兩欄 hanging header | 無。要用標籤就直接疊在標題上方 |

**現況已知落差**：內文和標題都用 `-apple-system, "Segoe UI"` 系統字。
系統字當顯示字體會讀起來像 demo page。要處理的話：標題換一套有個性的顯示字（繁中可選的不多但存在），內文維持系統字保可讀性與載入速度。

**版面看起來空的時候，是排版問題，不是內容問題。**
不要塞東西進去填。用構圖、留白、字階節奏解決。

**placeholder 勝過畫得爛的假貨** —— placeholder 說的是「這裡需要真材料」，假貨說的是「我偷懶了」。

## 5. 互動與動態

互動元件要把用得到的狀態都寫掉：`default` / `hover` / `:focus-visible` / `:active` / `disabled`，
有非同步的再加 `loading` / `error` / `success`。

- 只動 `transform` 和 `opacity`，不要動會觸發 layout 的屬性
- 過場一律 `var(--speed)`，不要用瀏覽器預設的 `ease`
- `:focus-visible` 要有看得見的框，對比 ≥3:1，**絕對不要對它加動畫**（要立刻出現）
- 一定要處理 `prefers-reduced-motion: reduce`
- **加動畫之前先想能不能砍。** 移掉它使用者會少知道什麼嗎？不會就移掉

## 6. 交付前檢查

全部可驗證，不是感覺題。用 `preview_start` 起 server 實際看：

- [ ] **兩個主題都看過** —— 深色好看不代表淺色可讀
- [ ] 所有顏色字體都走具名 token。**臨時需要的值先加進 token 區塊再引用，不要就地寫死 hex**
- [ ] 對比：內文 ≥4.5:1，大字與 UI 元件 ≥3:1
- [ ] 寬度 **320 / 375 / 768** 都看過：不能有橫向捲動、按鈕文字不能斷成兩行
- [ ] 內文 ≥16px，可點擊區域 ≥44px
- [ ] 改到的檔案 `?v=` 都遞增了
- [ ] 沒有覆蓋掉既有的全域樣式（只能往下加）
- [ ] console 沒有錯誤
- [ ] 改過 `hours.js` / `codec.js` 的話，`tools/open-now/test.html` 全綠

## 7. 新增一個小工具頁

最常做的事，流程固定：

1. `tools/<名稱>/` 開資料夾
2. `index.html` 的 `<head>` 照抄既有工具：
   ```html
   <script src="../../theme.js?v=1"></script>
   <link rel="stylesheet" href="../../style.css?v=N" />
   <link rel="stylesheet" href="style.css?v=1" />
   ```
   theme.js 要排在樣式表前面且不能加 `defer`，否則重整會閃一下深色
3. 結構：`<header class="hero">` → `<main class="container">` → `<footer>` 放 `← 回首頁`
4. 自己的 `style.css` **只補這個工具特有的東西**，基礎色吃根目錄的
5. 首頁 `index.html` 的 `.tool-grid` 裡加一張卡：
   ```html
   <a class="tool-card" href="tools/<名稱>/">
     <span class="tool-icon" aria-hidden="true">🔧</span>
     <span>
       <span class="tool-name">名稱</span>
       <span class="tool-desc">一句話說明它在幹嘛</span>
     </span>
   </a>
   ```
6. 更新所有動到的檔案的 `?v=`
7. 兩個主題各看一次

**工具超過 4 個就提醒使用者分組** —— `.tool-group` 的樣式已經寫好了，
在 `.tool-grid` 前面插 `<h3 class="tool-group">趣味</h3>`，每組各包一個 `.tool-grid` 就分開了。
規劃中的分組是「趣味」和「實驗室」。
