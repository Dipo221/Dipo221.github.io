/*
 * 把 places.json 讀進來，算出現在誰有開，排好順序畫出來。
 * 判斷營業時間的邏輯全部在 hours.js，這支只負責畫面。
 *
 * 編輯功能（新增／刪除／存回 GitHub）在 editor.js，是選配的：
 * 這支不依賴它也能單獨運作，一般訪客載到的就是這個純瀏覽的版本。
 */

const CLOSING_SOON_MINUTES = 30; // 剩多久算「快打烊」
const REFRESH_MS = 30 * 1000; // 每半分鐘重畫一次，時間才不會停在打開頁面的那一刻

const clockEl = document.getElementById("clock");
const summaryEl = document.getElementById("summary");
const boardEl = document.getElementById("board");

const OpenNow = {
  data: null, // places.json 的完整內容（含 area、_說明，存檔時要原樣寫回去）
  entries: [], // [{ place, area, parsed, error }]
  applyData: applyData,
  render: render,
  CLOSING_SOON_MINUTES: CLOSING_SOON_MINUTES,
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

fetch("places.json?v=2")
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

/* ---------- 畫面 ---------- */

function notice(text) {
  const el = document.createElement("p");
  el.className = "notice";
  el.textContent = text;
  return el;
}

function mapUrl(entry) {
  if (entry.place.map) return entry.place.map;
  // 沒有 place_id 也能連——組一個搜尋網址就好，完全不需要 API
  const query = (entry.area ? entry.area + " " : "") + entry.place.name;
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(query);
}

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

  const tags = (entry.place.tags || []).slice();
  if (entry.place.note) tags.unshift(entry.place.note);
  if (tags.length) {
    const row = document.createElement("div");
    row.className = "card-tags";
    for (const tag of tags) {
      const chip = document.createElement("span");
      chip.className = "tag";
      chip.textContent = tag;
      row.appendChild(chip);
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

function section(title, count, cards) {
  const wrap = document.createElement("section");

  const heading = document.createElement("h2");
  heading.textContent = title;
  const n = document.createElement("span");
  n.className = "count";
  n.textContent = count;
  heading.appendChild(n);
  wrap.appendChild(heading);

  const list = document.createElement("div");
  list.className = "cards";
  for (const c of cards) list.appendChild(c);
  wrap.appendChild(list);

  return wrap;
}

function render() {
  if (!OpenNow.data) return;

  const now = Hours.taipeiNow();
  clockEl.textContent = "週" + now.weekdayLabel + " " + now.label;

  const open = [];
  const closed = [];
  const broken = [];

  OpenNow.entries.forEach((entry, index) => {
    if (entry.error) {
      broken.push({ entry: entry, status: null, index: index });
      return;
    }
    const status = Hours.statusAt(entry.parsed, now);
    (status.open ? open : closed).push({ entry: entry, status: status, index: index });
  });

  // 有開的，剩越久排越前面——半夜找吃的，先看到來得及的那幾家比較有用
  open.sort((a, b) => b.status.minutesLeft - a.status.minutesLeft);
  // 沒開的，快開的排前面——早上想吃東西時，最想知道誰先開
  closed.sort((a, b) => {
    if (a.status.minutesLeft == null) return 1;
    if (b.status.minutesLeft == null) return -1;
    return a.status.minutesLeft - b.status.minutesLeft;
  });

  summaryEl.textContent =
    OpenNow.entries.length + " 家裡，現在有 " + open.length + " 家開著";

  boardEl.innerHTML = "";

  if (open.length) {
    boardEl.appendChild(
      section("現在有開", open.length, open.map((x) => card(x.entry, x.status, x.index)))
    );
  } else {
    boardEl.appendChild(notice("現在一家都沒開 😴"));
  }

  if (closed.length) {
    boardEl.appendChild(
      section("已打烊", closed.length, closed.map((x) => card(x.entry, x.status, x.index)))
    );
  }

  // 解析失敗的獨立一區，才不會有店悄悄從清單上消失卻沒人發現
  if (broken.length) {
    boardEl.appendChild(
      section("資料有問題", broken.length, broken.map((x) => card(x.entry, null, x.index)))
    );
  }
}
