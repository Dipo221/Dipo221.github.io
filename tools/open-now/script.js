/*
 * 把 places.json 讀進來，算出現在誰有開，排好順序畫出來。
 * 判斷營業時間的邏輯全部在 hours.js，這支只負責畫面。
 *
 * 編輯功能（新增／刪除／存回 GitHub）在 editor.js，是選配的：
 * 這支不依賴它也能單獨運作，一般訪客載到的就是這個純瀏覽的版本。
 */

const CLOSING_SOON_MINUTES = 30; // 剩多久算「快打烊」
const REFRESH_MS = 30 * 1000; // 每半分鐘重畫一次，時間才不會停在打開頁面的那一刻

/*
 * 標籤是自由填的，很容易長出一堆只對應一家店的標籤（實測 29 家店長出 13 種，
 * 其中 3 種只有一家）。只有一家店的標籤篩了等於沒篩，所以不佔篩選列的位置，
 * 但仍然顯示在卡片上。
 *
 * MAX_FILTERS 只決定「預設先露出幾個」，不是資格門檻——超出的收在「更多」
 * 後面，不會被丟掉。曾經是硬上限，結果同為 2 家店的標籤要靠名稱排序決勝，
 * 變成加兩家火鍋按鈕就出現、加兩家泰式就不會，完全沒辦法預期。
 * 現在的規則單純：滿 MIN_STORES_FOR_FILTER 家就一定在列上。
 */
const MIN_STORES_FOR_FILTER = 2;
const MAX_FILTERS = 8;

const clockEl = document.getElementById("clock");
const summaryEl = document.getElementById("summary");
const boardEl = document.getElementById("board");
const filtersEl = document.getElementById("filters");

let activeTag = null; // null 代表「全部」
let showAllTags = false; // 篩選列是否展開到全部標籤
let showClosed = false; // 「已打烊」是否展開
let closedTouched = false; // 使用者有沒有自己動過那個開關

const OpenNow = {
  data: null, // places.json 的完整內容（含 area、_說明，存檔時要原樣寫回去）
  entries: [], // [{ place, area, parsed, error }]
  applyData: applyData,
  render: render,
};
window.OpenNow = OpenNow;

/* ---------- 載入 ---------- */

function applyData(data) {
  OpenNow.data = data;
  const area = data.area || "";

  OpenNow.entries = (data.places || []).map((place) => {
    const parsed = Hours.parse(place.hours);
    return {
      place: place,
      area: area,
      parsed: parsed.ok ? parsed : null,
      error: parsed.ok ? null : parsed.error,
    };
  });

  render();
}

/*
 * cache: "no-cache" 是「每次都跟伺服器確認一下」，不是「不要快取」——
 * 沒變的話伺服器回 304，不會重下載。用預設值的話 GitHub Pages 給的
 * max-age 會讓剛加完的店隔幾分鐘才看得到，而「加完馬上打開確認」
 * 正是最常做的事。
 */
fetch("places.json", { cache: "no-cache" })
  .then((res) => {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  })
  .then((data) => {
    // 編輯模式下 editor.js 會再去 GitHub 抓一份「權威版」蓋掉這份——
    // GitHub Pages 建置有延遲，剛存完的內容這裡可能還是舊的
    applyData(data);
    setInterval(render, REFRESH_MS);
  })
  .catch((err) => {
    summaryEl.textContent = "資料載入失敗";
    boardEl.innerHTML = "";
    boardEl.appendChild(notice("讀不到 places.json（" + err.message + "）"));
  });

/* ---------- 小工具 ---------- */

function notice(text) {
  const el = document.createElement("p");
  el.className = "notice";
  el.textContent = text;
  return el;
}

function tagsOf(entry) {
  return entry.place.tags || [];
}

function mapUrl(entry) {
  if (entry.place.map) return entry.place.map;
  // 沒有 place_id 也能連——組一個搜尋網址就好，完全不需要 API
  const query = (entry.area ? entry.area + " " : "") + entry.place.name;
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(query);
}

/* ---------- 篩選列 ---------- */

/*
 * 挑出有資格進篩選列的標籤（多到放不下時由呼叫端決定先露出幾個）。
 * 排序看的是「總共幾家店」而不是「現在幾家開著」——後者每半分鐘會變，
 * 按鈕位置跟著跳動的話很難按。數字顯示的才是現在有開的家數。
 */
function pickFilterTags(items) {
  const totals = new Map();

  for (const item of items) {
    for (const tag of tagsOf(item.entry)) {
      totals.set(tag, (totals.get(tag) || 0) + 1);
    }
  }

  return [...totals.entries()]
    .filter(([, count]) => count >= MIN_STORES_FOR_FILTER)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hant"))
    .map(([tag]) => tag);
}

function countOpenByTag(items) {
  const open = new Map();

  for (const item of items) {
    if (!item.status || !item.status.open) continue;
    for (const tag of tagsOf(item.entry)) {
      open.set(tag, (open.get(tag) || 0) + 1);
    }
  }

  return open;
}

function chip(label, count, isActive, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "chip";
  if (isActive) button.classList.add("is-active");
  if (count === 0) button.classList.add("is-empty"); // 這個時間點沒得吃，變灰但還是能點
  button.setAttribute("aria-pressed", String(isActive));

  button.appendChild(document.createTextNode(label));

  const badge = document.createElement("span");
  badge.className = "chip-count";
  badge.textContent = count;
  button.appendChild(badge);

  button.addEventListener("click", onClick);
  return button;
}

function renderFilters(items) {
  const eligible = pickFilterTags(items);

  // 資料改過之後選中的標籤可能已經不夠格了，讓它退回「全部」
  if (activeTag && !eligible.includes(activeTag)) activeTag = null;

  filtersEl.innerHTML = "";
  if (!eligible.length) return; // 店太少還沒長出值得篩的標籤，就不要佔版面

  const openByTag = countOpenByTag(items);
  const openTotal = items.filter((x) => x.status && x.status.open).length;

  const select = (tag) => {
    activeTag = tag;
    closedTouched = false; // 換了條件就重新套用預設的收合行為
    render();
  };

  let visible = showAllTags ? eligible : eligible.slice(0, MAX_FILTERS);

  // 選中的標籤一定要看得到。收合時把它藏起來的話，畫面會變成
  // 「明明在篩選，卻看不出在篩什麼」，而且沒辦法再點一次取消。
  if (activeTag && !visible.includes(activeTag)) visible = visible.concat(activeTag);

  filtersEl.appendChild(chip("全部", openTotal, activeTag === null, () => select(null)));

  for (const tag of visible) {
    const isActive = activeTag === tag;
    filtersEl.appendChild(
      chip(tag, openByTag.get(tag) || 0, isActive, () => select(isActive ? null : tag))
    );
  }

  const hidden = eligible.length - visible.length;
  if (hidden > 0 || showAllTags) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "chip is-more";
    more.textContent = showAllTags ? "收合" : "＋" + hidden + " 更多";
    more.addEventListener("click", () => {
      showAllTags = !showAllTags;
      render();
    });
    filtersEl.appendChild(more);
  }
}

/* ---------- 卡片 ---------- */

function card(entry, status, index) {
  const wrap = document.createElement("div");
  wrap.className = "card-wrap";

  const link = document.createElement("a");
  link.className = "card";
  link.href = mapUrl(entry);
  link.target = "_blank";
  link.rel = "noopener";

  const soon = status && status.open && status.minutesLeft <= CLOSING_SOON_MINUTES;
  if (entry.error) link.classList.add("is-broken");
  else if (!status.open) link.classList.add("is-closed");
  else if (soon) link.classList.add("is-soon");

  const head = document.createElement("div");
  head.className = "card-head";

  const name = document.createElement("span");
  name.className = "card-name";
  name.textContent = entry.place.name;
  head.appendChild(name);

  const badge = document.createElement("span");
  badge.className = "badge";
  if (entry.error) {
    badge.textContent = "資料有誤";
  } else if (status.open) {
    badge.textContent = soon ? "快打烊" : "營業中";
  } else {
    badge.textContent = "已打烊";
  }
  head.appendChild(badge);
  link.appendChild(head);

  const meta = document.createElement("div");
  meta.className = "card-meta";

  if (entry.error) {
    meta.textContent = entry.error + "　→　" + entry.place.hours;
  } else if (status.open) {
    // 24 小時營業的話「還有 xx 小時打烊」沒有意義，直接講整天開
    meta.textContent =
      status.minutesLeft >= Hours.MINUTES_PER_DAY
        ? "24 小時營業"
        : "還有 " + Hours.humanizeMinutes(status.minutesLeft) + "打烊";
  } else if (status.minutesLeft == null) {
    meta.textContent = "這兩天都沒有營業";
  } else {
    meta.textContent = "還有 " + Hours.humanizeMinutes(status.minutesLeft) + "開門";
  }
  link.appendChild(meta);

  // 備註跟標籤分開放。以前備註也做成 chip，但標籤現在是可以篩選的分類，
  // 長得一樣會讓人以為備註也點得動。
  if (entry.place.note) {
    const note = document.createElement("div");
    note.className = "card-note";
    note.textContent = entry.place.note;
    link.appendChild(note);
  }

  const tags = tagsOf(entry);
  if (tags.length) {
    const row = document.createElement("div");
    row.className = "card-tags";
    for (const tag of tags) {
      const item = document.createElement("span");
      item.className = "tag";
      if (tag === activeTag) item.classList.add("is-active"); // 標出是哪個標籤讓它被篩進來的
      item.textContent = tag;
      row.appendChild(item);
    }
    link.appendChild(row);
  }

  wrap.appendChild(link);

  // 編輯模式才會有東西掛上來；沒載 editor.js 的話這裡什麼都不會發生
  if (window.OpenNowEditor) {
    window.OpenNowEditor.decorateCard(wrap, entry, index);
  }

  return wrap;
}

/* ---------- 區塊 ---------- */

function sectionHeading(title, count) {
  const heading = document.createElement("h2");
  heading.textContent = title;
  const badge = document.createElement("span");
  badge.className = "count";
  badge.textContent = count;
  heading.appendChild(badge);
  return heading;
}

function section(title, count, cards) {
  const wrap = document.createElement("section");
  wrap.appendChild(sectionHeading(title, count));

  const list = document.createElement("div");
  list.className = "cards";
  for (const c of cards) list.appendChild(c);
  wrap.appendChild(list);

  return wrap;
}

/*
 * 可收合的區塊。凌晨時段十幾家店裡通常只有一兩家開著，
 * 「已打烊」會佔掉整頁八成——滑很久其實都在滑沒得吃的店。
 */
function collapsibleSection(title, count, buildCards, expanded, onToggle) {
  const wrap = document.createElement("section");

  const heading = document.createElement("h2");
  heading.className = "is-collapsible";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "section-toggle";
  toggle.setAttribute("aria-expanded", String(expanded));

  const arrow = document.createElement("span");
  arrow.className = "arrow";
  arrow.textContent = expanded ? "▾" : "▸";
  toggle.appendChild(arrow);
  toggle.appendChild(document.createTextNode(title));

  const badge = document.createElement("span");
  badge.className = "count";
  badge.textContent = count;
  toggle.appendChild(badge);

  toggle.addEventListener("click", onToggle);
  heading.appendChild(toggle);
  wrap.appendChild(heading);

  if (expanded) {
    const list = document.createElement("div");
    list.className = "cards";
    for (const c of buildCards()) list.appendChild(c);
    wrap.appendChild(list);
  }

  return wrap;
}

/* ---------- 主流程 ---------- */

function render() {
  if (!OpenNow.data) return;

  const now = Hours.taipeiNow();
  clockEl.textContent = "週" + now.weekdayLabel + " " + now.label;

  // 先算全部店家的狀態。篩選列的數字要看的是「所有店裡現在幾家開著」，
  // 不能只算篩選後的，否則選了標籤數字就全變成 0 或自己。
  const all = OpenNow.entries.map((entry, index) => ({
    entry: entry,
    status: entry.error ? null : Hours.statusAt(entry.parsed, now),
    index: index,
  }));

  renderFilters(all);

  const visible = activeTag
    ? all.filter((item) => tagsOf(item.entry).includes(activeTag))
    : all;

  const open = [];
  const closed = [];
  const broken = [];

  for (const item of visible) {
    if (item.entry.error) broken.push(item);
    else if (item.status.open) open.push(item);
    else closed.push(item);
  }

  // 有開的，剩越久排越前面——半夜找吃的，先看到來得及的那幾家比較有用
  open.sort((a, b) => b.status.minutesLeft - a.status.minutesLeft);
  // 沒開的，快開的排前面——早上想吃東西時，最想知道誰先開
  closed.sort((a, b) => {
    if (a.status.minutesLeft == null) return 1;
    if (b.status.minutesLeft == null) return -1;
    return a.status.minutesLeft - b.status.minutesLeft;
  });

  summaryEl.textContent = activeTag
    ? visible.length + " 家「" + activeTag + "」，現在有 " + open.length + " 家開著"
    : OpenNow.entries.length + " 家裡，現在有 " + open.length + " 家開著";

  boardEl.innerHTML = "";

  if (open.length) {
    boardEl.appendChild(
      section("現在有開", open.length, open.map((x) => card(x.entry, x.status, x.index)))
    );
  } else {
    boardEl.appendChild(
      notice(activeTag ? "現在沒有「" + activeTag + "」開著 😴" : "現在一家都沒開 😴")
    );
  }

  if (closed.length) {
    // 一家都沒開的時候預設展開——不然畫面整個空掉，連「幾點會開」都看不到。
    // 使用者自己動過開關之後就尊重他的選擇。
    const expanded = closedTouched ? showClosed : open.length === 0;

    boardEl.appendChild(
      collapsibleSection(
        "已打烊",
        closed.length,
        () => closed.map((x) => card(x.entry, x.status, x.index)),
        expanded,
        () => {
          showClosed = !expanded;
          closedTouched = true;
          render();
        }
      )
    );
  }

  // 解析失敗的獨立一區，才不會有店悄悄從清單上消失卻沒人發現
  if (broken.length) {
    boardEl.appendChild(
      section("資料有問題", broken.length, broken.map((x) => card(x.entry, null, x.index)))
    );
  }
}
