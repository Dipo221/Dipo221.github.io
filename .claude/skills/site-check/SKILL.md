---
name: site-check
description: 靜態網站上線前的自我檢查。當使用者說要 push、部署、上線、發佈,或問「這樣可以推了嗎」時使用。
allowed-tools: Bash, Read, Grep, Glob
---

# 上線前檢查

這個站是純靜態網頁,沒有 build step,推上去就是線上版本,所以推之前先跑過下面幾項。
逐項檢查,有問題的直接修,修不了的列出來問使用者。

## 1. 有沒有漏掉的檔案

跑 `git status --short`。如果有未追蹤的 `.html` / `.css` / `.js` / 圖片檔,
提醒使用者這些不 commit 的話線上會 404。

## 2. 引用的檔案真的存在

檢查 `index.html` 和 `tools/*/index.html` 裡所有的
`href="..."` 和 `src="..."`(排除 http 開頭的外部連結),
確認每個相對路徑在檔案系統上真的找得到。大小寫也要對 —
本機 Windows 不分大小寫,但線上主機通常會分,這是最常見的「本機好好的、線上壞掉」。

## 3. Cache busting 版本號

這個站用 `style.css?v=2` 這種方式擋快取。
如果這次的 diff 動到了 `style.css` 或 `script.js`,
但引用它的 HTML 裡 `?v=` 的數字沒跟著 +1,提出來 —
不改的話回訪的使用者會看到舊版樣式。

## 4. 沒有半成品

用 Grep 找 `TODO`、`FIXME`、`console.log`、`debugger`,
以及寫死的本機路徑(`localhost`、`C:\`、`127.0.0.1`)。

## 收尾

用表格回報:每項 ✅ 或 ⚠️,問題寫清楚在哪個檔案第幾行。
全過的話就說可以推了,不要多做別的事。
