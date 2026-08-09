# Dipo221.github.io

MingYang 的個人首頁，透過 GitHub Pages 發布於 <https://dipo221.github.io>。

## 結構

- `index.html` — 首頁
- `style.css` — 樣式
- `script.js` — 頁尾年份等小腳本
- `tools/` — 小工具，一個資料夾一個

## tools/open-now — 現在吃什麼

看淡水現在有哪些店還開著。資料是手動維護的 `tools/open-now/places.json`。

**標籤篩選**：上方的篩選列只放**至少 2 家店在用**的標籤，最多 8 個。所以剛加的冷門標籤
不會馬上出現在上面（但仍然顯示在卡片上），等第 2 家店也用了同一個標籤就會自己冒出來。
這是為了不讓篩選列長得比清單還高——門檻在 `script.js` 的 `MIN_STORES_FOR_FILTER`。

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
