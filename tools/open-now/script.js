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
 * 標籤是自由填的，很容易長出一堆只對應一家店的標籤（實測 30 家店長出 13 種）。
 * 只有一家店的標籤篩了等於沒篩，所以不佔篩選列的位置，但仍然顯示在卡片上。
 *
 * 規則就這一條：滿這個家數就一定在列上。篩選列是單排橫向捲動的，
 * 放幾個都只佔一排，所以不需要再有「先露出幾個、其餘收起來」那層邏輯。
 */
const MIN_STORES_FOR_FILTER = 2;

const clockEl = document.getElementById("clock");
const summaryEl = document.getElementById("summary");
const boardEl = document.getElementById("board");
const filtersEl = document.getElementById("filters");
const diceEl = document.getElementById("dice");

// 會動的東西一律尊重這個設定，暈眩體質的人不該被強迫看跑馬燈
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let activeTag = null; // null 代表「全部」
let showClosed = false; // 「已打烊」是否展開
let closedTouched = false; // 使用者有沒有自己動過那個開關
let winnerIndex = null; // 隨機抽中的店在 entries 裡的索引
let isRolling = false; // 輪轉動畫進行中，這時候不要重畫

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

  // 每半分鐘會重畫一次。不記住捲動位置的話，畫面會自己彈回最左邊，
  // 手指還按在上面滑到一半就被拉回去。
  const scrollLeft = filtersEl.scrollLeft;

  filtersEl.innerHTML = "";
  if (!eligible.length) {
    updateOverflowHint();
    return; // 店太少還沒長出值得篩的標籤，就不要佔版面
  }

  const openByTag = countOpenByTag(items);
  const openTotal = items.filter((x) => x.status && x.status.open).length;

  const select = (tag) => {
    activeTag = tag;
    closedTouched = false; // 換了條件就重新套用預設的收合行為
    winnerIndex = null; // 換了範圍，上一次抽的結果就不算數了
    render();
  };

  filtersEl.appendChild(chip("全部", openTotal, activeTag === null, () => select(null)));

  for (const tag of eligible) {
    const isActive = activeTag === tag;
    filtersEl.appendChild(
      chip(tag, openByTag.get(tag) || 0, isActive, () => select(isActive ? null : tag))
    );
  }

  filtersEl.scrollLeft = scrollLeft;
  updateOverflowHint();
}

/*
 * 右邊還有東西沒露出來時，在邊緣加一層漸層當提示。
 * 橫向捲動最大的問題是看不出來還能捲，尤其手機上捲軸是隱藏的；
 * 捲到底就把漸層拿掉，免得一直暗示「還有」其實沒有了。
 */
function updateOverflowHint() {
  const remaining = filtersEl.scrollWidth - filtersEl.clientWidth - filtersEl.scrollLeft;
  filtersEl.classList.toggle("has-more-right", remaining > 4);
}

filtersEl.addEventListener("scroll", updateOverflowHint, { passive: true });
window.addEventListener("resize", updateOverflowHint);

/* ---------- 卡片 ---------- */

function card(entry, status, index) {
  const wrap = document.createElement("div");
  wrap.className = "card-wrap";
  wrap.dataset.index = index; // 輪轉動畫要靠這個把畫面上的卡片對回資料
  if (index === winnerIndex) wrap.classList.add("is-winner");

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

  /*
   * 抽中的店掛個記號，不然捲過去之後認不出是哪一家。
   *
   * 快打烊的店刻意不排除（剩二十分鐘也可能來得及），但這時整張卡片會轉成橘色。
   * 記號本身不重複「還剩幾分」——徽章已經寫了「快打烊」、下一行也已經寫了
   * 確切分鐘數，再講一次就是同一件事說三遍。這裡只補上該採取的行動。
   */
  if (index === winnerIndex && !entry.error) {
    const mark = document.createElement("div");
    mark.className = "winner-mark" + (soon ? " is-soon" : "");
    mark.textContent = soon ? "🎲 就吃這家 — 動作要快" : "🎲 就吃這家";
    link.appendChild(mark);
  }

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
  if (isRolling) return; // 輪轉到一半被重畫的話，高亮會整個消失

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

  // 抽中的店如果打烊了（或被篩掉了）就把記號拿掉，
  // 不然畫面會一直指著一家已經關門的店
  if (winnerIndex !== null && !open.some((x) => x.index === winnerIndex)) {
    winnerIndex = null;
  }

  // 一家都沒開就沒什麼好抽的
  diceEl.hidden = open.length === 0;

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
    const openSection = section(
      "現在有開",
      open.length,
      open.map((x) => card(x.entry, x.status, x.index))
    );
    openSection.classList.add("open-section"); // 隨機抽獎只從這一區裡挑
    boardEl.appendChild(openSection);
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

/* ---------- 隨機選一家 ---------- */

/*
 * 從「現在有開」那一區裡隨機挑一家。範圍會跟著目前選的標籤走——
 * 點了「宵夜」就只從有開的宵夜店裡抽。
 *
 * 動畫是讓高亮在現有卡片上一張張跑過去再慢慢停下，而不是另外跳一個結果視窗：
 * 這樣看得到是從哪幾家裡抽的，中選的那家也還在它原本的位置上，
 * 旁邊幾點打烊、有哪些標籤都一併看得到。
 *
 * 快打烊的店不排除（那是刻意的，剩 20 分鐘也可能來得及），
 * 但抽中時會在卡片上寫清楚還剩多久。
 */

/*
 * 步數是固定的，不是「跑幾圈」。跑圈數的話 20 家店就要跳 40 幾次、
 * 拖到四五秒；固定步數讓動畫長度跟店家多寡無關，都是 1.6 秒左右。
 * 反正輪轉不需要真的走訪每一家，看起來像在掃描就夠了。
 */
const ROLL_STEPS = 16;
const ROLL_FAST_MS = 55; // 起步多快
const ROLL_SLOW_MS = 210; // 最後一步多慢

function openCardWraps() {
  const section = boardEl.querySelector(".open-section");
  return section ? [...section.querySelectorAll(".card-wrap")] : [];
}

function settleOn(wrap) {
  winnerIndex = Number(wrap.dataset.index);
  render(); // 重畫一次讓「就吃這家」的記號正式掛上去

  const target = boardEl.querySelector(".card-wrap.is-winner");
  if (target) target.scrollIntoView({ block: "center", behavior: "smooth" });
}

function rollRandom() {
  if (isRolling) return;

  const wraps = openCardWraps();
  if (!wraps.length) return;

  const total = wraps.length;
  const winner = Math.floor(Math.random() * total);

  // 只有一家的時候沒什麼好抽的，跑動畫只是浪費時間
  if (total === 1 || reduceMotion) {
    settleOn(wraps[winner]);
    return;
  }

  isRolling = true;
  diceEl.disabled = true;
  winnerIndex = null;
  for (const w of wraps) w.classList.remove("is-winner");

  /*
   * 先把中選的那家捲到畫面中央再開始跑。清單可能有二十幾家、大半在螢幕外，
   * 不先捲的話高亮會在看不見的地方跑完，只剩最後結果突然冒出來。
   * 先定位的話，看得到的正好是減速停下的那幾步——最有戲的一段。
   */
  wraps[winner].scrollIntoView({ block: "center", behavior: "auto" });

  /*
   * 序列是往回推的：從「終點往前數 ROLL_STEPS 格」開始跑，
   * 最後一步自然落在中選的那家，不必跑完再硬跳過去（那看起來像卡住）。
   */
  const start = (((winner - ROLL_STEPS + 1) % total) + total) % total;
  const gapAt = (k) =>
    ROLL_FAST_MS + (ROLL_SLOW_MS - ROLL_FAST_MS) * Math.pow(k / ROLL_STEPS, 2.2);

  let step = 0;
  const tick = () => {
    for (const w of wraps) w.classList.remove("is-rolling");
    wraps[(start + step) % total].classList.add("is-rolling");
    step += 1;

    if (step < ROLL_STEPS) {
      setTimeout(tick, gapAt(step));
      return;
    }

    for (const w of wraps) w.classList.remove("is-rolling");
    isRolling = false;
    diceEl.disabled = false;
    settleOn(wraps[winner]);
  };

  tick();
}

diceEl.addEventListener("click", rollRandom);
