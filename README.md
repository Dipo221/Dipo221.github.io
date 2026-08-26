# Dipo221.github.io

MingYang 的個人首頁，透過 GitHub Pages 發布於 <https://dipo221.github.io>。

## 結構

- `index.html` — 首頁
- `style.css` — 樣式
- `script.js` — 頁尾年份等小腳本
- `tools/` — 小工具，一個資料夾一個

## tools/open-now — 現在吃什麼

看淡水現在有哪些店還開著。資料是手動維護的 `tools/open-now/places.json`。

**標籤篩選**：規則只有一條——**某個標籤只要有 2 家店在用，就一定會出現在篩選列上**。
標籤多到放不下時，先顯示店家數最多的 8 個，其餘收在「＋N 更多」後面，不會被丟掉。
只有 1 家店的標籤不佔篩選列位置（篩了等於沒篩），但仍然顯示在卡片上。

兩個數字都在 `script.js` 開頭：`MIN_STORES_FOR_FILTER`（要幾家才進列）、
`MAX_FILTERS`（先露出幾個）。

鈕上的數字是**現在有開**的家數，不是總數，所以半夜可以直接看出哪一類還有得吃。

**編輯**：可以新增／刪除／修改店家，存檔會直接 commit 回這個 repo
（GitHub Pages 大約 30 秒後更新）。一般訪客看不到編輯介面。

兩種進入方式：

1. **連點畫面上的時鐘五下**（要連續，中間停超過 3 秒會歸零）
2. 網址加 `#edit` — <https://dipo221.github.io/tools/open-now/#edit>

解鎖只在該分頁有效，關掉就回到一般瀏覽模式。存過 token 的裝置也一樣要解鎖——
token 只負責存檔，不決定要不要顯示編輯介面，這樣平常滑手機找店才不會誤觸刪除。

第一次要在「設定」裡填兩樣東西，都只存在該台裝置的瀏覽器，不會進 repo：

| | 用途 | 去哪拿 |
|---|---|---|
| GitHub token | 存檔 | [建立 fine-grained token](https://github.com/settings/personal-access-tokens/new)，只勾這個 repo 的 **Contents: Read and write** |
| Google Maps 金鑰 | 搜尋店家自動帶入營業時間（選填） | [Google Cloud](https://console.cloud.google.com/google/maps-apis/credentials)，啟用 **Places API (New)**，並用 HTTP referrer 鎖 `dipo221.github.io/*` |

**測試**：打開 `tools/open-now/test.html` 就會跑，不需要安裝任何東西。
改到營業時間的判斷邏輯（`hours.js`）或 base64（`codec.js`）之後記得看一下是不是全綠。

## tools/cat-room — 房間裡的貓

一隻叫 Disi 的像素貓住在一個房間裡，牠自己過生活，你可以進去看牠在做什麼。
研究做累了可以開著。

**核心規則：什麼都不衰減。** 沒有飢餓值、沒有清潔度、沒有心情，bond 只增不減。
離開不會被懲罰——久沒來，回來時牠會叼一個東西走過來。這條是整個東西的地基，
不是還沒做完的功能，有測試擋著 `bondDelta` 不會是負的。所以**不要加任何會因為
沒玩而變差的東西**。

**時間**：房間的光和貓的作息跟著**台北時間**走，不是看的人的所在地。
牠下午睡死、黃昏開始不安分，是真貓的晨昏性作息。

**分層**：只有一隻貓，不是每個訪客一隻分身。`world`（在做什麼、住了幾天）
大家看到的一樣；`shared`（今天被摸幾次）記給所有人、只顯示給我；
`private`（bond、禮物、離開多久的訊息）留在各自的瀏覽器。

**測試**：打開 `tools/cat-room/test.html` 就會跑，目前 183 條。
邏輯都在 `world.js` / `cat.js` / `save.js` / `sprites.js`，這四支不碰 DOM
所以測得到；`script.js` 只負責接到頁面上。

**改美術**：貓不是用繪圖軟體畫的，是資料算出來的。

| | |
|---|---|
| `art/disi.py` | 像素資料，一格一個字元的地圖 + 七色調色盤。**改圖只改這支** |
| `art/pixel.py` | 算成 PNG，另外吐校對圖、GIF、跑 lint |

```
cd tools/cat-room/art && python pixel.py     （要 Pillow）
```

會產出 `disi-16.png`（正式素材，唯一進版控的）、`proof.png`（放大 20 倍加格線
座標，抓單格錯誤用）、`squint.png`（縮小並排，抓剪影）、各動作的 `.gif`
（用遊戲裡真正的幀速，靜圖看不出抖動）。

改完美術有兩件事一定要做：`sprites.js` 的 manifest 和 `art/disi.py` 的 `PLAY`
是手動同步的，動一邊要動另一邊；動到 `disi-16.png` 的排數就要把 sprites.js 裡
`?v=` 的號碼加一，否則舊快取配新 manifest 會整張錯位。

**改動紀錄**在 `tools/cat-room/CHANGELOG.md`。
