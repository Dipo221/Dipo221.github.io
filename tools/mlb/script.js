/*
 * MLB 追蹤。
 *
 * data.json 與 players.json 是 GitHub Actions 每小時產生的，這裡只負責讀出來畫。
 * 前端刻意不直接打 statsapi：會有 CORS 問題、每個訪客都打一次也不禮貌，
 * 而且資料先落地成靜態檔，離線或 API 掛掉時這頁還是看得到東西。
 *
 * 關注名單與我的球員存在 localStorage，不存在 repo 裡——
 * 這是純靜態站，網頁上按的星號沒有後端可以寫。watchlist.json 因此降級成
 * 「本機還沒有名單時的預設值」，另外給一顆匯出鈕讓使用者自己同步回檔案。
 */
const MLB = (function () {
  "use strict";

  const TAB_KEY = "mlb:tab";
  const VIEW_KEY = "mlb:views";
  const WATCH_KEY = "mlb:watch";
  const ROSTER_KEY = "mlb:roster";

  const SAVANT = "https://baseballsavant.mlb.com/savant-player/";

  /*
   * 組合用重音記號（U+0300–U+036F）。用 RegExp 建構式從純 ASCII 字串組出來，
   * 是因為直接寫成字面量的話那個範圍在編輯器裡是兩個隱形字元，很容易被誤刪或誤改。
   */
  const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

  /*
   * 分頁定義。這是唯一的真相來源——選單、檢視下拉、筆數全部從這裡讀，
   * 不要再開第二份清單。每個 id 在 SECTIONS 裡一定要有對應的 render 與 count，
   * test.html 有一條測試在盯這件事。
   *
   * views 的第一個是預設值。空陣列表示這一區沒有檢視可選，下拉會停用。
   */
  const TABS = [
    { id: "watch", label: "關注名單", group: "我的", team: false, views: [
      { id: "all", label: "全部" },
      { id: "bat", label: "打者" },
      { id: "pit", label: "投手" },
    ] },
    { id: "roster", label: "我的球員", group: "我的", team: false, views: [] },

    { id: "moves", label: "傷兵異動", group: "傷兵", team: true, views: [
      { id: "all", label: "全部" },
      { id: "back", label: "已歸隊" },
      { id: "soon", label: "即將歸隊" },
      { id: "new", label: "剛進 IL" },
    ] },
    { id: "board", label: "傷兵名單", group: "傷兵", team: true, views: [
      { id: "soon", label: "最快歸隊" },
      { id: "new", label: "剛進 IL" },
      { id: "long", label: "傷最久" },
    ] },

    { id: "hardhit", label: "強擊球", group: "打擊", team: true, views: [
      { id: "d14", label: "近 14 天" },
      { id: "d7", label: "近 7 天" },
      { id: "d3", label: "近 3 天" },
    ] },
    { id: "barrels", label: "Barrel", group: "打擊", team: true, views: [
      { id: "d14", label: "近 14 天" },
      { id: "d7", label: "近 7 天" },
      { id: "d3", label: "近 3 天" },
    ] },

    { id: "callups", label: "球員異動", group: "其他", team: true, views: [
      { id: "all", label: "全部" },
      { id: "debut", label: "初登板" },
      { id: "se", label: "加進 40 人名單" },
      { id: "cu", label: "叫上大聯盟" },
    ] },
    { id: "streaks", label: "連勝連敗", group: "其他", team: true, views: [] },
    { id: "news", label: "新聞", group: "其他", team: false, views: [
      { id: "all", label: "全部" },
      { id: "injury", label: "傷兵" },
      { id: "move", label: "簽約異動" },
      { id: "analysis", label: "分析預測" },
      { id: "other", label: "其他" },
    ] },
  ];

  // 打者的固定守備格。投手不在這裡，因為數量由使用者自己加減。
  const HITTER_SLOTS = ["C", "1B", "2B", "3B", "SS", "OF", "OF", "OF", "UTL", "UTL"];
  const MAX_PITCHERS = 12;

  // 兩用球員（TWP，例如大谷）兩邊都算得上，篩投手和篩打者都要看得到他
  const PITCHER_POS = { P: 1, SP: 1, RP: 1, LHP: 1, RHP: 1, TWP: 1 };
  const HITTER_POS_EXCLUDE = { P: 1, SP: 1, RP: 1, LHP: 1, RHP: 1 };

  let data = null;
  let teamsById = {};
  let playersById = {};
  let playersList = [];
  let watchlist = [];
  let roster = null;
  let statusIndex = null;
  let hasNewsCat = true;
  let hasPlayerIndex = true;

  let activeTab = "moves";
  let activeTeam = "";
  let views = {};
  let picker = null;       // 我的球員：目前打開搜尋面板的那一格
  let pendingFocus = null; // render 完要把焦點送去哪（這一輪才生出來的節點）
  let refocus = null;      // render 完要把焦點找回哪（重畫前就消失的節點，用選擇器找替身）

  const summaryEl = document.getElementById("summary");
  const stampEl = document.getElementById("stamp");
  const navItemsEl = document.getElementById("nav-items");
  const menuBtn = document.getElementById("menu-btn");
  const menuLabel = document.getElementById("menu-label");
  const drawer = document.getElementById("nav-drawer");
  const scrim = document.getElementById("nav-scrim");
  const drawerClose = document.getElementById("drawer-close");
  const boardEl = document.getElementById("board");
  const teamSelect = document.getElementById("team-select");
  const viewSelect = document.getElementById("view-select");

  /* ---------- 小工具 ---------- */

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function notice(text) {
    return el("div", "notice", text);
  }

  /*
   * 我的球員那幾顆按鈕（＋、－、✕、選人）按下去都會整區重畫，按鈕本身跟著被丟掉，
   * 焦點就會掉回 <body>——用鍵盤的人每按一次就要從頭 Tab 一遍。
   *
   * 這裡登記「重畫完把焦點找回哪裡」。給的是一串選擇器，依序試到找得到、
   * 而且沒有被停用的為止：按了＋之後＋可能剛好到上限變成停用，這時候要退到－。
   */
  function focusLater(selectors) {
    refocus = selectors;
  }

  function slotSel(kind, index) {
    return '[data-slot="' + kind + "-" + index + '"]';
  }

  function svg(className, paths, filled) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    node.setAttribute("viewBox", "0 0 20 20");
    node.setAttribute("aria-hidden", "true");
    node.setAttribute("focusable", "false");
    if (className) node.setAttribute("class", className);
    paths.forEach(function (d) {
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", d);
      if (filled) p.setAttribute("fill", "currentColor");
      node.appendChild(p);
    });
    return node;
  }

  /*
   * 名字正規化：去重音、去標點、統一小寫。
   * 「Ronald Acuña Jr.」和「ronald acuna jr」要能對得起來。
   */
  function normalizeName(name) {
    return String(name || "")
      .normalize("NFD")
      .replace(COMBINING_MARKS, "")
      .toLowerCase()
      .replace(/[.,'‘’`]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  /* 'YYYY-MM-DD' -> '8/31'。故意不建 Date 物件：
     new Date('2026-08-31') 會被當成 UTC 午夜，在台灣時區顯示會變成 8/31 的前一天。 */
  function shortDate(iso) {
    if (!iso) return "";
    const parts = String(iso).split("-");
    if (parts.length !== 3) return String(iso);
    return Number(parts[1]) + "/" + Number(parts[2]);
  }

  /*
   * 從今天到某個日期還有幾天。
   *
   * 刻意在前端現算，不用 data.json 裡的 daysUntil——那個數字是產檔當下算的，
   * JSON 可能是幾小時前的，跨過半夜就會整整差一天。
   * 兩邊都轉成 Date.UTC 的當日零點再相減，這樣純粹是日曆天差，不受時區與日光節約影響。
   */
  function daysUntil(iso) {
    if (!iso) return null;
    const p = String(iso).split("-");
    if (p.length !== 3) return null;
    const target = Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    const now = new Date();
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    if (isNaN(target)) return null;
    return Math.round((target - today) / 86400000);
  }

  /*
   * 最快可回歸的說法。這是規則算出來的最早有資格被啟動的日期，
   * 不是預估回歸日，所以字面一定要寫「最快」。
   */
  function returnLabel(earliest, days) {
    if (!earliest) return "";
    const n = days === undefined ? daysUntil(earliest) : days;
    if (n === null || n === undefined) return "最快 " + shortDate(earliest) + " 可回歸";
    if (n <= 0) return "已可回歸";
    if (n === 1) return "最快明天可回歸";
    return "最快 " + shortDate(earliest) + " 可回歸（還有 " + n + " 天）";
  }

  /*
   * 名單種類。資料裡實際出現過 injured / paternity / bereavement，
   * 沒對到就講「名單」——寧可講得籠統，也不要把英文原字丟到中文介面上。
   */
  const LIST_LABELS = {
    injured: "傷兵",
    paternity: "陪產",
    bereavement: "喪假",
    restricted: "受限",
  };

  function listLabel(kind) {
    return LIST_LABELS[kind] || "";
  }

  /*
   * 登錄異動的兩種。抓取腳本只收這兩個 typeCode，差別是 40 人名單：
   *
   *   SE  本來不在 40 人名單上（簽的是小聯盟約），球隊把他的合約選上來、
   *       加進 40 人名單。40 是硬上限，所以要挪走一個人才塞得下——
   *       球隊願意付這個代價，訊號比 CU 強得多。
   *   CU  本來就在 40 人名單上，只是被下放，現在從小聯盟叫回現役名單。
   *       例行升降，牛棚接駁車多半是這種。
   *
   * MLB 原文是 "Selected the contract of"，直譯成「選上合約」字面沒錯但
   * 看不出在講什麼，所以照它實際發生的事命名。
   * typeDesc 是英文原字（Selected／Recalled），不能直接丟到中文介面上。
   */
  const MOVE_LABELS = { SE: "加進 40 人名單", CU: "叫上大聯盟" };

  function moveLabel(type) {
    return MOVE_LABELS[type] || "登錄異動";
  }

  /*
   * 異動的一句話說明。
   * 原始 description 是英文整句（"Minnesota Twins placed CF Byron Buxton on the
   * 10-day injured list retroactive to August 27, 2026."），裡面把球隊、守備位置、
   * 球員名又寫一遍，貼在已經有名字的卡片上整句都是重複的，所以改用結構化欄位自己組。
   */
  function moveSummary(m) {
    const kind = listLabel(m.listKind);
    if (m.action === "activated") return "從" + kind + "名單啟動";
    if (m.action === "transferred") return "轉入 " + (m.days || 60) + " 天 IL";
    if (m.days) return "進 " + m.days + " 天 IL";
    return "進" + kind + "名單";
  }

  function teamName(teamId) {
    const t = teamsById[teamId];
    return t ? t.abbr : "";
  }

  function teamFull(teamId) {
    const t = teamsById[teamId];
    return t ? t.name : "";
  }

  function matchesTeam(teamId) {
    return !activeTeam || String(teamId) === activeTeam;
  }

  function savantUrl(playerId) {
    return SAVANT + String(playerId);
  }

  function posOf(playerId) {
    const p = playersById[String(playerId)];
    return p ? p.pos : "";
  }

  function isPitcher(pos) {
    return !!PITCHER_POS[pos];
  }

  function isHitter(pos) {
    return !!pos && !HITTER_POS_EXCLUDE[pos];
  }

  /* ---------- localStorage ---------- */

  function readStore(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      const parsed = JSON.parse(raw);
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (err) {
      // 存進去的東西壞掉了就當作沒有，不要讓整頁跟著掛
      return fallback;
    }
  }

  function writeStore(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      /* 無痕模式或空間滿了寫不進去，這一輪的操作還是有效，只是重整後會不見 */
    }
  }

  /* ---------- 關注名單 ---------- */

  function watchIndex() {
    const byId = {};
    const byName = {};
    watchlist.forEach(function (entry) {
      if (entry.id) byId[String(entry.id)] = entry;
      if (entry.name) byName[normalizeName(entry.name)] = entry;
    });
    return { byId: byId, byName: byName };
  }

  /*
   * watchlist.json 允許只寫名字（見那個檔的說明），所以比對要同時支援 id 與名字。
   * 從畫面上按星號加進來的一定帶 id，名字比對只是為了讓手寫的預設名單也能對到人。
   */
  function isWatched(playerId, name) {
    const idx = watchIndex();
    if (playerId && idx.byId[String(playerId)]) return true;
    if (name && idx.byName[normalizeName(name)]) return true;
    return false;
  }

  function watchEntry(playerId, name) {
    const idx = watchIndex();
    return (
      (playerId && idx.byId[String(playerId)]) ||
      (name && idx.byName[normalizeName(name)]) ||
      null
    );
  }

  function toggleWatch(player) {
    const on = isWatched(player.id, player.name);
    if (on) {
      const key = normalizeName(player.name);
      watchlist = watchlist.filter(function (e) {
        if (player.id && String(e.id) === String(player.id)) return false;
        if (!e.id && key && normalizeName(e.name) === key) return false;
        return true;
      });
    } else {
      watchlist = watchlist.concat([{ id: player.id, name: player.name }]);
    }
    writeStore(WATCH_KEY, watchlist);
  }

  /* ---------- 我的球員 ---------- */

  function emptyRoster() {
    return {
      v: 1,
      hitters: HITTER_SLOTS.map(function () {
        return null;
      }),
      pitchers: [],
    };
  }

  /*
   * 存進去的東西可能是舊版、被手改壞的、或根本不是這個功能的資料。
   * 一律修成正確的形狀再用，不要相信 localStorage。
   */
  function normalizeRoster(raw) {
    const base = emptyRoster();
    if (!raw || typeof raw !== "object") return base;

    const hitters = Array.isArray(raw.hitters) ? raw.hitters : [];
    base.hitters = HITTER_SLOTS.map(function (_, i) {
      const p = hitters[i];
      return p && p.id ? { id: p.id, name: p.name || "" } : null;
    });

    const pitchers = Array.isArray(raw.pitchers) ? raw.pitchers : [];
    base.pitchers = pitchers.slice(0, MAX_PITCHERS).map(function (p) {
      return p && p.id ? { id: p.id, name: p.name || "" } : null;
    });
    return base;
  }

  function saveRoster() {
    writeStore(ROSTER_KEY, roster);
  }

  function setSlot(kind, index, player) {
    const list = roster[kind];
    if (!list || index < 0 || index >= list.length) return;
    list[index] = player ? { id: player.id, name: player.name } : null;
    saveRoster();
  }

  function rosterCount() {
    let n = 0;
    roster.hitters.concat(roster.pitchers).forEach(function (p) {
      if (p) n += 1;
    });
    return n;
  }

  /* ---------- 球員在各區的即時狀態 ---------- */

  /*
   * 掃一次所有區塊，做出「球員 -> 他最近發生了什麼」的索引。
   * 關注名單和我的球員都是查這份索引，不要各自再掃一遍。
   *
   * 同一個人可能同時在傷兵名單和強擊球排行上，所以是累加 lines 不是覆蓋。
   */
  function buildStatus() {
    const byId = {};
    const byName = {};

    function slot(playerId, name, teamId) {
      if (!playerId && !name) return null;
      const key = playerId ? String(playerId) : "n:" + normalizeName(name);
      let rec = byId[key];
      if (!rec) {
        rec = { id: playerId, name: name, teamId: teamId, lines: [], tone: "" };
        byId[key] = rec;
      }
      if (name) rec.name = name;
      if (teamId) rec.teamId = teamId;
      if (name) byName[normalizeName(name)] = rec;
      return rec;
    }

    (data.ilBoard || []).forEach(function (p) {
      const s = slot(p.playerId, p.name, p.teamId);
      if (!s) return;
      s.tone = s.tone || "il";
      const bits = [p.statusDesc || p.status];
      if (p.injury) bits.push(p.injury);
      const ret = returnLabel(p.earliestReturn);
      if (ret) bits.push(ret);
      s.lines.push(bits.join(" · "));
    });

    (data.ilMoves || []).forEach(function (m) {
      const s = slot(m.playerId, m.name, m.teamId);
      if (!s) return;
      if (m.action === "activated") s.tone = "back";
      const bits = [shortDate(m.date) + " " + moveSummary(m)];
      // 傷勢只在傷兵名單那行沒帶到時才補，不然同一句話會出現兩次
      if (m.injury && !s.lines.some(function (line) { return line.indexOf(m.injury) !== -1; })) {
        bits.push(m.injury);
      }
      s.lines.push(bits.join(" · "));
    });

    // 排名用 14 天那份，因為短窗的名次天天在跳，當成「他最近怎麼樣」的說明不穩
    (board("hardHits", "d14") || []).forEach(function (h, i) {
      const s = slot(h.playerId, h.name, h.teamId);
      if (!s) return;
      s.tone = s.tone || "hot";
      s.lines.push("近 14 天強擊球第 " + (i + 1) + " —— " + h.hardHits + " 球，最高 " + h.maxEV + " mph");
    });

    (board("barrels", "d14") || []).forEach(function (h, i) {
      const s = slot(h.playerId, h.name, h.teamId);
      if (!s) return;
      s.tone = s.tone || "hot";
      s.lines.push("近 14 天 barrel 第 " + (i + 1) + " —— " + h.barrels + " 顆");
    });

    (data.callups || []).forEach(function (c) {
      const s = slot(c.playerId, c.name, c.teamId);
      if (!s) return;
      s.tone = s.tone || "debut";
      s.lines.push(shortDate(c.date) + " " + (c.isDebut ? "大聯盟初登板" : moveLabel(c.type)));
    });

    return { byId: byId, byName: byName };
  }

  function statusFor(playerId, name) {
    if (!statusIndex) return null;
    if (playerId && statusIndex.byId[String(playerId)]) return statusIndex.byId[String(playerId)];
    if (name && statusIndex.byName[normalizeName(name)]) return statusIndex.byName[normalizeName(name)];
    return null;
  }

  /* ---------- 卡片 ---------- */

  const STAR_PATH =
    "M10 2.2l2.35 4.76 5.25.77-3.8 3.7.9 5.23L10 14.19l-4.7 2.47.9-5.23-3.8-3.7 5.25-.77z";

  function syncStar(btn, player) {
    const on = isWatched(player.id, player.name);
    btn.className = "star" + (on ? " is-on" : "");
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.setAttribute("aria-label", (on ? "取消關注 " : "關注 ") + player.name);
  }

  function starButton(player) {
    const btn = el("button", "star");
    btn.type = "button";
    btn.appendChild(svg("star-icon", [STAR_PATH], true));
    syncStar(btn, player);

    btn.addEventListener("click", function () {
      /*
       * 這裡不需要 preventDefault／stopPropagation：星號跟那張鋪滿卡片的 <a>
       * 是兄弟不是父子，點擊命中的是最上層的元素——也就是這顆按鈕——
       * 連結根本沒有收到事件，所以不會跳走。
       * （星號如果包在連結裡面就得擋，但那樣的 HTML 本來就是不合規的。）
       */
      /*
       * 只有關注名單那一區的內容「就是」這份名單，取消關注等於把這張卡抽走，
       * 非重畫不可。我的球員是另一份獨立的名單，星號動了它不會變，所以走partial。
       */
      if (activeTab === "watch") {
        // 卡片馬上會消失，先記住它排第幾張，重畫後把焦點交給遞補上來的那一張
        const list = btn.closest(".cards");
        const card = btn.closest(".card");
        const nth = list && card ? Array.prototype.indexOf.call(list.children, card) + 1 : 0;
        toggleWatch(player);
        focusLater([
          ".cards .card:nth-child(" + nth + ") .star",
          ".cards .card:last-child .star",
          ".ghost-btn",
        ]);
        render();
        return;
      }

      // 其他區只要更新這顆星就好，整頁重畫會把焦點洗掉，鍵盤使用者會迷路
      toggleWatch(player);
      syncStar(btn, player);
      renderNav();
    });
    return btn;
  }

  /*
   * 球員卡。整張可以按，連到 Baseball Savant（純數字 ID 就開得了，不需要名字 slug），
   * 右上角疊一顆星號切換關注。
   *
   * 連結是一張鋪滿整張卡的透明 <a>，不是把整張卡包成 <a>——
   * <a> 裡面不准放 <button>（HTML 規範：連結內不得有互動內容），
   * 瀏覽器雖然畫得出來，但讀螢幕軟體有的會直接不報那顆按鈕，星號就變成按不到。
   * 分成兩個平行的元素，兩邊都是規範內的用法，各自有自己的名字與焦點。
   *
   * 沒有 playerId 的資料連不了也關注不了——少數異動記錄缺 person id——
   * 這種就退回普通的 div，不要生一個點了沒反應的連結。
   */
  function playerCard(tone, player) {
    if (!player.id) return el("div", "card is-" + tone);

    const card = el("div", "card is-" + tone + " is-linked has-star");

    const link = el("a", "card-link");
    link.href = savantUrl(player.id);
    link.target = "_blank";
    link.rel = "noopener";
    // 這個 <a> 裡面沒有文字，一定要自己給名字，不然讀出來只有一個「連結」
    link.setAttribute("aria-label", "在 Baseball Savant 看 " + player.name);

    card.appendChild(link);
    card.appendChild(starButton(player));
    return card;
  }

  function cardHead(name, pos, badgeText, badgeTone) {
    const head = el("div", "card-head");
    const nameEl = el("div", "card-name");
    if (pos) nameEl.appendChild(el("span", "card-pos", pos));
    nameEl.appendChild(document.createTextNode(name));
    head.appendChild(nameEl);
    if (badgeText) head.appendChild(el("span", "badge is-" + badgeTone, badgeText));
    return head;
  }

  function metaRow(parts) {
    const meta = el("div", "card-meta");
    parts.forEach(function (part, i) {
      if (part === null || part === undefined || part === "") return;
      if (meta.childNodes.length) meta.appendChild(el("span", "sep", "·"));
      if (typeof part === "string") meta.appendChild(document.createTextNode(part));
      else meta.appendChild(part);
    });
    return meta;
  }

  /* ---------- 檢視 ---------- */

  function tabById(id) {
    return TABS.filter(function (t) {
      return t.id === id;
    })[0];
  }

  function viewsFor(tab) {
    if (!tab) return [];
    // 舊的 data.json 沒有 cat 欄位，這時候整個下拉藏起來，
    // 不要把每一篇都倒進「其他」假裝有分類
    if (tab.id === "news" && !hasNewsCat) return [];
    if ((tab.id === "watch") && !hasPlayerIndex) return [];
    return tab.views || [];
  }

  function currentView() {
    const opts = viewsFor(tabById(activeTab));
    if (!opts.length) return "";
    const saved = views[activeTab];
    const ok = opts.some(function (o) {
      return o.id === saved;
    });
    return ok ? saved : opts[0].id;
  }

  function setView(id) {
    views[activeTab] = id;
    writeStore(VIEW_KEY, views);
  }

  /* ---------- 各分頁 ---------- */

  function board(key, window) {
    const b = data[key];
    if (!b) return [];
    return b[window] || [];
  }

  function renderWatch() {
    const wrap = el("div");

    if (!watchlist.length) {
      wrap.appendChild(
        notice("關注名單還是空的。在任何球員卡右上角按星號就會加進來。")
      );
      wrap.appendChild(watchFoot());
      return wrap;
    }

    const view = currentView();
    const rows = [];
    watchlist.forEach(function (entry) {
      const st = statusFor(entry.id, entry.name);
      const id = entry.id || (st && st.id);
      /*
       * 名字以資料為準，不是以名單裡寫的為準。
       * watchlist.json 允許手打純 ASCII（見那個檔的說明），那串字是拿來「對人」的，
       * 不是拿來顯示的——照抄的話畫面上會出現 Ronald Acuna Jr.，
       * 而 MLB 寫的是 Ronald Acuña Jr.。對到人之後就該用對方的正式寫法。
       */
      const name = (st && st.name) || entry.name || "";
      const pos = id ? posOf(id) : "";

      // 位置查不到的人只在「全部」出現。硬塞進打者或投手都是猜的。
      if (view === "bat" && !isHitter(pos)) return;
      if (view === "pit" && !isPitcher(pos)) return;

      /*
       * 這一區刻意不套球隊篩選。TABS 裡它是 team: false，球隊下拉在這一頁是停用的——
       * 但 activeTeam 是跨分頁留著的，照樣拿來篩的話，從傷兵名單選了雙城再切過來，
       * 名單會被一個看起來按不動的下拉默默砍掉一半。
       */
      const teamId = (st && st.teamId) || (playersById[String(id)] || {}).teamId;

      rows.push({
        id: id, name: name, pos: pos, teamId: teamId,
        note: entry.note || "",
        lines: (st && st.lines) || [],
        tone: (st && st.tone) || "hot",
      });
    });

    // 名單不空、又沒有球隊篩選，走到這裡就一定是打者／投手篩掉的
    if (!rows.length) {
      wrap.appendChild(notice("這個條件下沒有人"));
      wrap.appendChild(watchFoot());
      return wrap;
    }

    const cards = el("div", "cards");
    rows.forEach(function (r) {
      const card = playerCard(r.tone, r);
      card.appendChild(cardHead(r.name, r.pos, teamName(r.teamId), r.tone));
      if (r.note) card.appendChild(el("div", "card-meta card-injury", r.note));
      if (!r.lines.length) {
        card.appendChild(el("div", "card-meta", "最近沒有消息"));
      }
      r.lines.forEach(function (line) {
        card.appendChild(el("div", "card-meta", line));
      });
      cards.appendChild(card);
    });

    wrap.appendChild(cards);
    wrap.appendChild(watchFoot());
    return wrap;
  }

  /*
   * 匯出。名單只存在這台瀏覽器，換手機就看不到——這件事一定要寫在畫面上，
   * 不然使用者改了 watchlist.json 發現沒反應，會以為壞掉。
   */
  function watchFoot() {
    const foot = el("div", "watch-foot");
    foot.appendChild(
      el(
        "p",
        "disclaimer",
        "關注名單存在這台瀏覽器裡，不會自動同步到其他裝置。" +
          "要在手機上也看到同一份，用下面的匯出貼回 watchlist.json 再 push。" +
          "本機一旦存過名單，watchlist.json 就只是預設值，不會再蓋掉你按的星號。"
      )
    );

    const btn = el("button", "ghost-btn", "匯出成 watchlist.json");
    btn.type = "button";
    const out = el("textarea", "export-box");
    out.readOnly = true;
    out.rows = 8;
    out.hidden = true;
    out.setAttribute("aria-label", "watchlist.json 內容");

    btn.addEventListener("click", function () {
      const players = watchlist.map(function (e) {
        const row = {};
        if (e.id) row.id = e.id;
        if (e.name) row.name = e.name;
        if (e.note) row.note = e.note;
        return row;
      });
      out.value = JSON.stringify({ players: players }, null, 2);
      out.hidden = false;
      out.focus();
      out.select();
      // 剪貼簿在部分瀏覽器要權限或 https，失敗就算了——文字已經選起來可以自己複製
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(out.value).then(
          function () { btn.textContent = "已複製到剪貼簿"; },
          function () { btn.textContent = "已選取，請自己複製"; }
        );
      } else {
        btn.textContent = "已選取，請自己複製";
      }
    });

    foot.appendChild(btn);
    foot.appendChild(out);
    return foot;
  }

  function renderRoster() {
    const wrap = el("div", "roster");

    wrap.appendChild(rosterGroup("打者", "hitters", HITTER_SLOTS));

    const pitchHead = el("div", "roster-head");
    pitchHead.appendChild(el("h3", null, "投手"));
    const stepper = el("div", "stepper");
    stepper.appendChild(
      stepBtn("minus", "－", "少一格投手", roster.pitchers.length <= 0, function () {
        // 從最後面拿掉，而且只在那一格是空的時候才直接刪，不然會無聲丟掉一個人
        const last = roster.pitchers[roster.pitchers.length - 1];
        if (last && !window.confirm("最後一格是 " + last.name + "，確定要移除嗎？")) return;
        roster.pitchers.pop();
        if (picker && picker.kind === "pitchers") picker = null;
        saveRoster();
        // 減到 0 的話－會停用，焦點退到＋
        focusLater([".step-btn.is-minus", ".step-btn.is-plus"]);
        render();
      })
    );
    stepper.appendChild(el("span", "stepper-value", roster.pitchers.length));
    stepper.appendChild(
      stepBtn("plus", "＋", "多一格投手", roster.pitchers.length >= MAX_PITCHERS, function () {
        roster.pitchers.push(null);
        saveRoster();
        focusLater([".step-btn.is-plus", ".step-btn.is-minus"]);
        render();
      })
    );
    pitchHead.appendChild(stepper);

    const pitchGroup = el("div", "roster-group");
    pitchGroup.appendChild(pitchHead);
    if (!roster.pitchers.length) {
      pitchGroup.appendChild(notice("還沒有投手格。按上面的＋加一格。"));
    } else {
      pitchGroup.appendChild(
        slotList("pitchers", roster.pitchers.map(function () { return "P"; }))
      );
    }
    wrap.appendChild(pitchGroup);

    wrap.appendChild(
      el(
        "p",
        "disclaimer",
        "守備格不驗資格——每個聯盟認定的位置資格都不一樣，這裡只照實顯示他在大聯盟登錄的守備位置，" +
          "要把游擊手放進捕手格是你的事。名單一樣只存在這台瀏覽器。"
      )
    );
    return wrap;
  }

  function rosterGroup(title, kind, labels) {
    const group = el("div", "roster-group");
    const head = el("div", "roster-head");
    head.appendChild(el("h3", null, title));
    group.appendChild(head);
    group.appendChild(slotList(kind, labels));
    return group;
  }

  function stepBtn(mod, text, label, disabled, onClick) {
    const b = el("button", "step-btn is-" + mod, text);
    b.type = "button";
    b.disabled = !!disabled;
    b.setAttribute("aria-label", label);
    b.addEventListener("click", onClick);
    return b;
  }

  function slotList(kind, labels) {
    const list = el("div", "slots");
    roster[kind].forEach(function (p, i) {
      list.appendChild(slotRow(kind, i, labels[i] || ""));
      if (picker && picker.kind === kind && picker.index === i) {
        list.appendChild(buildPicker(kind, i));
      }
    });
    return list;
  }

  function slotRow(kind, index, label) {
    const row = el("div", "slot");
    // 重畫之後要靠這個把焦點找回同一格，不能用 DOM 位置猜
    row.dataset.slot = kind + "-" + index;
    row.appendChild(el("span", "slot-label", label));

    const player = roster[kind][index];
    if (!player) {
      const open = picker && picker.kind === kind && picker.index === index;
      const btn = el("button", "slot-empty" + (open ? " is-open" : ""), open ? "取消" : "＋ 選球員");
      btn.type = "button";
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.addEventListener("click", function () {
        picker = open ? null : { kind: kind, index: index };
        // 打開的話焦點歸 buildPicker 送去搜尋框；按取消才要自己收回來
        if (open) focusLater([slotSel(kind, index) + " .slot-empty"]);
        render();
      });
      row.appendChild(btn);
      return row;
    }

    const st = statusFor(player.id, player.name);
    const tone = (st && st.tone) || "hot";
    const pos = posOf(player.id);
    const teamId = (st && st.teamId) || (playersById[String(player.id)] || {}).teamId;

    const card = playerCard(tone, player);
    card.appendChild(cardHead(player.name, pos, teamName(teamId), tone));
    ((st && st.lines) || []).forEach(function (line) {
      card.appendChild(el("div", "card-meta", line));
    });
    if (!st || !st.lines.length) card.appendChild(el("div", "card-meta", "最近沒有消息"));

    const clear = el("button", "slot-clear");
    clear.type = "button";
    clear.setAttribute("aria-label", "把 " + player.name + " 從這一格移除");
    clear.appendChild(svg(null, ["M5 5l10 10M15 5L5 15"], false));
    clear.addEventListener("click", function () {
      setSlot(kind, index, null);
      // 清掉之後這一格會變成「＋ 選球員」，焦點就停在原地
      focusLater([slotSel(kind, index) + " .slot-empty"]);
      render();
    });

    const holder = el("div", "slot-card");
    holder.appendChild(card);
    holder.appendChild(clear);
    row.appendChild(holder);
    return row;
  }

  /*
   * 搜尋面板。刻意不在每次輸入就重畫整區——那樣輸入框會被換掉、焦點跟著飛走，
   * 打第二個字就要重新點一次。只換結果那一塊。
   */
  function buildPicker(kind, index) {
    const panel = el("div", "picker");

    if (!hasPlayerIndex) {
      panel.appendChild(notice("球員索引還在產生中，下一輪資料更新後就能搜尋"));
      return panel;
    }

    const input = el("input", "picker-input");
    input.type = "search";
    input.placeholder = "打名字找人，例如 judge";
    input.setAttribute("aria-label", "搜尋球員");

    const results = el("div", "picker-results");

    function fill(query) {
      results.innerHTML = "";
      const q = normalizeName(query);
      if (q.length < 2) {
        results.appendChild(notice("至少打兩個字"));
        return;
      }
      const hits = playersList
        .filter(function (p) {
          return p.key.indexOf(q) !== -1;
        })
        .slice(0, 40);

      if (!hits.length) {
        results.appendChild(notice("找不到「" + query + "」"));
        return;
      }

      // 已經在關注名單上的排前面——會被排進先發的通常就是這些人
      hits.sort(function (a, b) {
        const aw = isWatched(a.id, a.name) ? 0 : 1;
        const bw = isWatched(b.id, b.name) ? 0 : 1;
        if (aw !== bw) return aw - bw;
        return a.name.localeCompare(b.name);
      });

      hits.slice(0, 20).forEach(function (p) {
        const btn = el("button", "picker-hit");
        btn.type = "button";
        if (p.pos) btn.appendChild(el("span", "card-pos", p.pos));
        btn.appendChild(el("span", "picker-name", p.name));
        btn.appendChild(el("span", "picker-team", teamName(p.teamId)));
        if (isWatched(p.id, p.name)) btn.appendChild(el("span", "picker-star", "★"));
        btn.addEventListener("click", function () {
          setSlot(kind, index, p);
          picker = null;
          // 面板收起來了，焦點落在剛填好的那一格的移除鈕上——還在同一格，選錯人可以馬上清掉
          focusLater([slotSel(kind, index) + " .slot-clear"]);
          render();
        });
        results.appendChild(btn);
      });
    }

    input.addEventListener("input", function () {
      fill(input.value);
    });
    fill("");

    panel.appendChild(input);
    panel.appendChild(results);
    pendingFocus = input;
    return panel;
  }

  function renderMoves() {
    const view = currentView();
    let rows = (data.ilMoves || []).filter(function (m) {
      return matchesTeam(m.teamId);
    });

    if (view === "back") {
      rows = rows.filter(function (m) {
        return m.action === "activated";
      });
    } else if (view === "soon") {
      rows = rows
        .filter(function (m) {
          return m.action !== "activated" && m.earliestReturn;
        })
        .sort(function (a, b) {
          return a.earliestReturn < b.earliestReturn ? -1 : a.earliestReturn > b.earliestReturn ? 1 : 0;
        });
    } else if (view === "new") {
      rows = rows
        .filter(function (m) {
          return m.action !== "activated";
        })
        .sort(function (a, b) {
          return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
        });
    }

    if (!rows.length) {
      return notice(
        view === "all"
          ? "近 " + (data.windows || {}).moves + " 天沒有名單異動"
          : "這個條件下沒有異動"
      );
    }

    const wrap = el("div", "cards");
    rows.forEach(function (m) {
      const back = m.action === "activated";
      const tone = back ? "back" : "il";
      const card = playerCard(tone, { id: m.playerId, name: m.name });
      card.appendChild(
        cardHead(
          m.name,
          posOf(m.playerId),
          back ? "歸隊" : m.days ? m.days + " 天 IL" : listLabel(m.listKind) + "名單",
          tone
        )
      );
      card.appendChild(
        metaRow([
          shortDate(m.date),
          m.teamId ? teamName(m.teamId) : "",
          m.injury ? el("span", "card-injury", m.injury) : "",
        ])
      );
      const ret = returnLabel(m.earliestReturn);
      if (ret) card.appendChild(el("div", "card-meta", ret));
      wrap.appendChild(card);
    });
    return wrap;
  }

  function renderBoard() {
    const view = currentView();
    const rows = (data.ilBoard || []).filter(function (p) {
      return matchesTeam(p.teamId);
    });
    if (!rows.length) return notice("這一隊目前沒有人在傷兵名單上");

    // 沒有日期的一律排最後，不要讓它們插在中間看起來像亂序
    function byField(field, dir) {
      return function (a, b) {
        const av = a[field];
        const bv = b[field];
        if (!av && !bv) return 0;
        if (!av) return 1;
        if (!bv) return -1;
        return av < bv ? -dir : av > bv ? dir : 0;
      };
    }

    if (view === "new") rows.sort(byField("startDate", -1));
    else if (view === "long") rows.sort(byField("startDate", 1));
    else rows.sort(byField("earliestReturn", 1));

    const wrap = el("div", "cards");
    rows.forEach(function (p) {
      const n = daysUntil(p.earliestReturn);
      const ready = n !== null && n <= 0;
      const tone = ready ? "back" : "il";

      const card = playerCard(tone, { id: p.playerId, name: p.name });
      card.appendChild(cardHead(p.name, p.pos, p.statusDesc || p.status, tone));
      card.appendChild(
        metaRow([teamName(p.teamId), p.injury ? el("span", "card-injury", p.injury) : ""])
      );
      // 起算日對不到異動記錄時就沒有最快回歸日，這時候誠實留白，不要瞎猜
      card.appendChild(
        el("div", "card-meta", returnLabel(p.earliestReturn) || "起算日不明，算不出可回歸日")
      );
      wrap.appendChild(card);
    });
    return wrap;
  }

  /*
   * 強擊球和 barrel 共用同一個版面，差別只在看哪個數字。
   * 兩個排行的每一列都同時帶著 hardHits 和 barrels，所以強擊球榜上
   * 也看得到他 barrel 幾顆，反過來也是。
   */
  function hitBoard(key) {
    const isBarrel = key === "barrels";
    const view = currentView();
    const rows = board(key, view).filter(function (h) {
      return matchesTeam(h.teamId);
    });

    if (!rows.length) {
      return notice(
        activeTeam
          ? "這一隊在這個時間窗沒有人上榜"
          : "還沒有足夠的擊球資料（可能是資料還在產生中）"
      );
    }

    const wrap = el("div", "cards");
    rows.forEach(function (h) {
      const card = playerCard("hot", { id: h.playerId, name: h.name });
      const rank = el("div", "rank");
      rank.appendChild(el("div", "rank-value", isBarrel ? h.barrels : h.hardHits));

      const body = el("div", "rank-body");
      body.appendChild(cardHead(h.name, posOf(h.playerId), teamName(h.teamId), "hot"));

      const rate = isBarrel ? h.barrelRate : h.hardHitRate;
      const parts = [
        h.battedBalls + " 次擊球中 " + Math.round((rate || 0) * 100) + "% 是" +
          (isBarrel ? " barrel" : "強擊球"),
        "最高 " + h.maxEV + " mph",
      ];
      // 另一個數字當對照：barrel 多但強擊球普通，或反過來，都是有意義的訊號
      parts.push(isBarrel ? "強擊球 " + h.hardHits + " 球" : "barrel " + (h.barrels || 0) + " 顆");
      body.appendChild(metaRow(parts));

      rank.appendChild(body);
      card.appendChild(rank);
      wrap.appendChild(card);
    });

    const holder = el("div");
    holder.appendChild(wrap);
    holder.appendChild(
      el(
        "p",
        "disclaimer",
        isBarrel
          ? "Barrel＝初速 98 mph 以上、而且仰角落在會變成長打的區間裡（98 mph 時是 26~30 度，" +
            "初速愈快區間愈寬）。這是照公開的公式從逐球資料算的，不是 MLB 官方標記的那個欄位，" +
            "中間幾度會比官方略嚴。"
          : "強擊球＝擊球初速 95 mph 以上，這是通用的 hard-hit 門檻，只看力道不看角度。" +
            "排序看的是數量不是比率，因為要找的是最近「頻繁」打出強擊球的人。"
      )
    );
    return holder;
  }

  function renderHardHit() {
    return hitBoard("hardHits");
  }

  function renderBarrels() {
    return hitBoard("barrels");
  }

  function renderCallups() {
    const view = currentView();
    let rows = (data.callups || []).filter(function (c) {
      return matchesTeam(c.teamId);
    });

    /*
     * 三個檢視互斥，加起來剛好等於全部。
     *
     * isDebut 跟 type 是兩個不同維度的東西——每個初登板的人都一定同時是
     * SE 或 CU（總得用某種方式被放上名單才能上場），所以只照 type 篩的話，
     * 初登板的人會同時出現在兩個檢視裡。而卡片的徽章又是初登板優先，
     * 於是「加進 40 人名單」底下會冒出一排寫著「初登板」、看不出為什麼
     * 在這裡的卡。初登板是這三件事裡最值得單獨看的，所以讓它獨佔一類。
     */
    if (view === "debut") rows = rows.filter(function (c) { return c.isDebut; });
    else if (view === "se") rows = rows.filter(function (c) { return c.type === "SE" && !c.isDebut; });
    else if (view === "cu") rows = rows.filter(function (c) { return c.type === "CU" && !c.isDebut; });

    // 抓取腳本把初登板排到最前面，但這裡每一種檢視都要照日期新到舊
    rows = rows.slice().sort(function (a, b) {
      return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
    });

    if (!rows.length) {
      return notice(
        view === "all"
          ? "近 " + (data.windows || {}).callups + " 天沒有登錄異動"
          : "這個條件下沒有紀錄"
      );
    }

    const wrap = el("div", "cards");
    rows.forEach(function (c) {
      const tone = c.isDebut ? "debut" : "hot";
      const card = playerCard(tone, { id: c.playerId, name: c.name });
      card.appendChild(cardHead(c.name, c.pos, c.isDebut ? "初登板" : moveLabel(c.type), tone));
      card.appendChild(
        metaRow([
          shortDate(c.date),
          c.teamId ? teamName(c.teamId) : "",
          c.age ? c.age + " 歲" : "",
          /*
           * 初登板的徽章寫「初登板」，就蓋掉了他是用哪一種方式上來的。
           * 那件事沒有不重要——被加進 40 人名單的初登板，跟本來就在名單上
           * 的初登板，球隊的投入程度差很多。徽章要短，所以補在這一列。
           */
          c.isDebut ? moveLabel(c.type) : "",
        ])
      );
      wrap.appendChild(card);
    });
    return wrap;
  }

  function streakColumn(title, rows, tone) {
    const col = el("div");
    col.appendChild(el("h3", null, title));
    const wrap = el("div", "cards");
    if (!rows.length) {
      wrap.appendChild(notice("目前沒有"));
    }
    rows.forEach(function (s) {
      const card = el("div", "card is-" + tone);
      const rank = el("div", "rank");
      rank.appendChild(el("div", "streak-code is-" + tone, s.code || ""));
      const body = el("div", "rank-body");
      body.appendChild(el("div", "card-name", teamFull(s.teamId) || teamName(s.teamId)));
      body.appendChild(el("div", "card-meta", s.wins + " 勝 " + s.losses + " 敗"));
      rank.appendChild(body);
      card.appendChild(rank);
      wrap.appendChild(card);
    });
    col.appendChild(wrap);
    return col;
  }

  function renderStreaks() {
    const s = data.streaks || { wins: [], losses: [] };
    const wins = (s.wins || []).filter(function (r) {
      return matchesTeam(r.teamId);
    });
    const losses = (s.losses || []).filter(function (r) {
      return matchesTeam(r.teamId);
    });

    const grid = el("div", "streak-cols");
    grid.appendChild(streakColumn("連勝中", wins, "back"));
    grid.appendChild(streakColumn("連敗中", losses, "cold"));
    return grid;
  }

  const NEWS_LABELS = { injury: "傷兵", move: "簽約異動", analysis: "分析預測", other: "其他" };

  function renderNews() {
    const view = currentView();
    const rows = (data.news || []).filter(function (n) {
      return !view || view === "all" || (n.cat || "other") === view;
    });
    if (!rows.length) return notice(view && view !== "all" ? "這一類目前沒有新聞" : "目前沒有抓到新聞");

    const wrap = el("div", "cards");
    rows.forEach(function (n) {
      const card = el("a", "card is-linked");
      card.href = n.link;
      card.target = "_blank";
      card.rel = "noopener";

      const head = el("div", "card-head");
      head.appendChild(el("div", "card-name", n.title));
      card.appendChild(head);

      card.appendChild(
        metaRow([
          el("span", "news-source", n.source),
          hasNewsCat ? NEWS_LABELS[n.cat || "other"] : "",
          n.date ? shortDate(n.date.slice(0, 10)) : "",
        ])
      );
      wrap.appendChild(card);
    });

    const holder = el("div");
    holder.appendChild(wrap);
    if (hasNewsCat) {
      holder.appendChild(
        el(
          "p",
          "disclaimer",
          "分類是用標題的關鍵字猜的，一定會有分錯的——分不出來的都丟進「其他」，" +
            "沒有假裝分得很準。"
        )
      );
    }
    return holder;
  }

  /*
   * 每一區的畫法與筆數。key 必須跟 TABS 的 id 完全對應，
   * test.html 有一條測試在檢查兩邊沒有一邊多一邊少。
   */
  const SECTIONS = {
    watch: { render: renderWatch, count: function () { return watchlist.length; } },
    roster: { render: renderRoster, count: rosterCount },
    moves: { render: renderMoves, count: function () { return (data.ilMoves || []).length; } },
    board: { render: renderBoard, count: function () { return (data.ilBoard || []).length; } },
    hardhit: { render: renderHardHit, count: function () { return board("hardHits", "d14").length; } },
    barrels: { render: renderBarrels, count: function () { return board("barrels", "d14").length; } },
    callups: { render: renderCallups, count: function () { return (data.callups || []).length; } },
    streaks: {
      render: renderStreaks,
      count: function () {
        const s = data.streaks || {};
        return (s.wins || []).length + (s.losses || []).length;
      },
    },
    news: { render: renderNews, count: function () { return (data.news || []).length; } },
  };

  /* ---------- 版面 ---------- */

  function renderNav() {
    navItemsEl.innerHTML = "";
    let lastGroup = null;

    TABS.forEach(function (tab) {
      if (tab.group !== lastGroup) {
        lastGroup = tab.group;
        navItemsEl.appendChild(el("h3", "nav-group", tab.group));
      }

      const btn = el("button", "nav-item" + (tab.id === activeTab ? " is-active" : ""));
      btn.type = "button";
      btn.setAttribute("aria-current", tab.id === activeTab ? "true" : "false");
      btn.appendChild(el("span", null, tab.label));
      btn.appendChild(el("span", "nav-count", SECTIONS[tab.id].count()));
      btn.addEventListener("click", function () {
        activeTab = tab.id;
        picker = null;
        writeStore(TAB_KEY, tab.id);
        closeDrawer();
        render();
      });
      navItemsEl.appendChild(btn);
    });
  }

  function renderViewOptions() {
    const opts = viewsFor(tabById(activeTab));
    viewSelect.innerHTML = "";

    if (!opts.length) {
      const only = el("option", null, "—");
      only.value = "";
      viewSelect.appendChild(only);
      viewSelect.disabled = true;
      viewSelect.title = "這一區沒有可以切換的檢視";
      return;
    }

    opts.forEach(function (o) {
      const opt = el("option", null, o.label);
      opt.value = o.id;
      viewSelect.appendChild(opt);
    });
    viewSelect.disabled = false;
    viewSelect.title = "";
    viewSelect.value = currentView();
  }

  /* ---------- 抽屜 ---------- */

  let drawerOpen = false;
  let closeTimer = null;

  function openDrawer() {
    if (drawerOpen) return;
    drawerOpen = true;
    clearTimeout(closeTimer);

    scrim.hidden = false;
    drawer.hidden = false;
    /*
     * hidden 等於 display:none，而 display 一變 transition 就不會跑。
     * 讀一次 offsetWidth 逼瀏覽器先算一次版面，滑入才會從 -100% 開始動。
     */
    void drawer.offsetWidth;
    scrim.classList.add("is-open");
    drawer.classList.add("is-open");
    menuBtn.setAttribute("aria-expanded", "true");

    // 開了就把焦點送進去，不然鍵盤使用者的下一個 Tab 會跑到抽屜後面的東西
    const active = navItemsEl.querySelector(".nav-item.is-active");
    (active || navItemsEl.querySelector(".nav-item") || drawerClose).focus();
  }

  function closeDrawer(returnFocus) {
    if (!drawerOpen) return;
    drawerOpen = false;

    scrim.classList.remove("is-open");
    drawer.classList.remove("is-open");
    menuBtn.setAttribute("aria-expanded", "false");

    /*
     * 等滑出去了才 hidden，不然會瞬間消失沒有收合的動作。
     * 不聽 transitionend 是因為 prefers-reduced-motion 之下沒有過場、
     * 那個事件永遠不會來，抽屜就會一直留在 DOM 裡擋著 Tab 順序。
     */
    clearTimeout(closeTimer);
    closeTimer = setTimeout(function () {
      scrim.hidden = true;
      drawer.hidden = true;
    }, 200);

    // 只有用鍵盤關的時候才把焦點送回按鈕；點選單項目是要去看內容的
    if (returnFocus) menuBtn.focus();
  }

  menuBtn.addEventListener("click", function () {
    drawerOpen ? closeDrawer(true) : openDrawer();
  });
  drawerClose.addEventListener("click", function () {
    closeDrawer(true);
  });
  scrim.addEventListener("click", function () {
    closeDrawer();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && drawerOpen) closeDrawer(true);
  });

  function renderTeamOptions() {
    const groups = {};
    (data.teams || []).forEach(function (t) {
      const key = t.division || t.league || "其他";
      (groups[key] = groups[key] || []).push(t);
    });

    teamSelect.innerHTML = "";
    const all = el("option", null, "全部球隊");
    all.value = "";
    teamSelect.appendChild(all);

    Object.keys(groups)
      .sort()
      .forEach(function (division) {
        const og = document.createElement("optgroup");
        og.label = division;
        groups[division]
          .sort(function (a, b) {
            return a.name.localeCompare(b.name);
          })
          .forEach(function (t) {
            const opt = el("option", null, t.name);
            opt.value = String(t.id);
            og.appendChild(opt);
          });
        teamSelect.appendChild(og);
      });
    teamSelect.value = activeTeam;
  }

  function render() {
    const tab = tabById(activeTab);
    pendingFocus = null;

    renderNav();
    renderViewOptions();

    // 選單收起來之後，按鈕上這行字是唯一還看得到「現在在哪一區」的地方
    menuLabel.textContent = tab ? tab.label : "選單";

    // 新聞沒有球隊欄位，篩選對它沒有意義，所以那一頁把選單停掉
    teamSelect.disabled = !(tab && tab.team);
    teamSelect.title = tab && tab.team ? "" : "這一頁沒有球隊資訊，篩選不適用";

    boardEl.innerHTML = "";
    const section = el("section", "section");
    section.appendChild(el("h2", null, tab ? tab.label : ""));
    section.appendChild(SECTIONS[activeTab].render());
    boardEl.appendChild(section);

    // 搜尋面板是這一輪才長出來的，DOM 進去之後才能給焦點
    if (pendingFocus) {
      pendingFocus.focus();
      pendingFocus = null;
      refocus = null;
    } else if (refocus) {
      for (let i = 0; i < refocus.length; i += 1) {
        const node = boardEl.querySelector(refocus[i]);
        if (node && !node.disabled) {
          node.focus();
          break;
        }
      }
      refocus = null;
    }
  }

  function renderStamp() {
    if (!data.generatedAt) return;
    const d = new Date(data.generatedAt);
    if (isNaN(d.getTime())) return;
    // 這個站的預設時區是台北，資料時間也照台北顯示
    const text = new Intl.DateTimeFormat("zh-TW", {
      timeZone: "Asia/Taipei",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(d);
    stampEl.textContent = "資料更新於 " + text + "（台北時間）";
  }

  /*
   * 前端上線後，data.json 要等下一輪 Actions 才會變成新形狀，中間最多差一小時。
   * 這層把舊形狀補成新形狀，讓那一小時裡最多是幾區暫時空著，而不是整頁爆掉。
   */
  function normalizeData(payload) {
    const d = payload || {};

    // 舊版的 hardHits 是單一陣列（就是 14 天那份），沒有 barrels
    if (Array.isArray(d.hardHits)) d.hardHits = { d14: d.hardHits, d7: [], d3: [] };
    if (!d.hardHits || typeof d.hardHits !== "object") d.hardHits = { d14: [], d7: [], d3: [] };
    if (!d.barrels || Array.isArray(d.barrels)) d.barrels = { d14: [], d7: [], d3: [] };

    // 舊的列叫 rate，新的拆成 hardHitRate / barrelRate
    ["d14", "d7", "d3"].forEach(function (w) {
      (d.hardHits[w] || []).forEach(function (r) {
        if (r.hardHitRate === undefined) r.hardHitRate = r.rate || 0;
        if (r.barrels === undefined) r.barrels = 0;
      });
    });

    hasNewsCat = (d.news || []).some(function (n) {
      return !!n.cat;
    });
    return d;
  }

  function applyData(payload, watch, index) {
    data = normalizeData(payload);

    teamsById = {};
    (data.teams || []).forEach(function (t) {
      teamsById[t.id] = t;
    });

    playersById = {};
    playersList = [];
    const rows = (index && index.players) || [];
    hasPlayerIndex = rows.length > 0;
    rows.forEach(function (r) {
      // [id, name, pos, teamId]，用陣列存是為了體積，fields 欄位在檔案裡寫著
      const rec = { id: r[0], name: r[1] || "", pos: r[2] || "", teamId: r[3] };
      rec.key = normalizeName(rec.name);
      playersById[String(rec.id)] = rec;
      playersList.push(rec);
    });

    /*
     * 名單來源的優先序：本機存過就以本機為準，沒存過才拿 watchlist.json 當預設。
     * 反過來的話使用者按的星號每次重整都會被檔案蓋掉。
     */
    const stored = readStore(WATCH_KEY, null);
    watchlist = Array.isArray(stored) ? stored : ((watch && watch.players) || []).slice();

    roster = normalizeRoster(readStore(ROSTER_KEY, null));
    views = readStore(VIEW_KEY, {}) || {};
    if (typeof views !== "object" || Array.isArray(views)) views = {};

    const savedTab = readStore(TAB_KEY, null);
    if (savedTab && SECTIONS[savedTab]) activeTab = savedTab;

    statusIndex = buildStatus();

    summaryEl.textContent =
      (data.ilBoard || []).length +
      " 人在傷兵名單上 · 近 " +
      (data.windows || {}).moves +
      " 天 " +
      (data.ilMoves || []).length +
      " 筆異動";
    renderStamp();
    renderTeamOptions();
    render();
  }

  teamSelect.addEventListener("change", function () {
    activeTeam = teamSelect.value;
    render();
  });

  viewSelect.addEventListener("change", function () {
    setView(viewSelect.value);
    picker = null;
    render();
  });

  /*
   * data.json 是必要的，抓不到就明講。
   * watchlist.json 與 players.json 是選用的，沒有或格式壞掉就退化成沒有那個功能，
   * 不要整頁掛掉。
   */
  function optional(url, fallback) {
    return fetch(url, { cache: "no-cache" })
      .then(function (res) {
        return res.ok ? res.json() : fallback;
      })
      .catch(function () {
        return fallback;
      });
  }

  Promise.all([
    fetch("data.json", { cache: "no-cache" }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }),
    optional("watchlist.json", { players: [] }),
    optional("players.json", { players: [] }),
  ])
    .then(function (results) {
      applyData(results[0], results[1], results[2]);
    })
    .catch(function (err) {
      summaryEl.textContent = "資料載入失敗";
      boardEl.innerHTML = "";
      boardEl.appendChild(notice("讀不到 data.json（" + err.message + "）"));
    });

  return {
    normalizeName: normalizeName,
    shortDate: shortDate,
    returnLabel: returnLabel,
    daysUntil: daysUntil,
    applyData: applyData,
    TABS: TABS,
    SECTIONS: SECTIONS,
    HITTER_SLOTS: HITTER_SLOTS,
  };
})();

window.MLB = MLB;
