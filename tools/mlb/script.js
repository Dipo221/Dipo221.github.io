/*
 * MLB 追蹤。
 *
 * data.json 是 GitHub Actions 每小時產生的，這裡只負責讀出來畫。
 * 前端刻意不直接打 statsapi：會有 CORS 問題、每個訪客都打一次也不禮貌，
 * 而且資料先落地成靜態檔，離線或 API 掛掉時這頁還是看得到東西。
 *
 * 關注名單的比對放在前端，不放在抓取腳本裡——
 * 這樣改完 watchlist.json 重整就看得到結果，不用等下一輪 Actions 跑完。
 */
const MLB = (function () {
  "use strict";

  const TAB_KEY = "mlb:tab";

  /*
   * 組合用重音記號（U+0300–U+036F）。用 RegExp 建構式從純 ASCII 字串組出來，
   * 是因為直接寫成字面量的話那個範圍在編輯器裡是兩個隱形字元，很容易被誤刪或誤改。
   */
  const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

  const TABS = [
    { id: "moves", label: "傷兵異動", team: true },
    { id: "board", label: "傷兵名單", team: true },
    { id: "hardhit", label: "強擊球", team: true },
    { id: "callups", label: "新秀登板", team: true },
    { id: "streaks", label: "連勝連敗", team: true },
    { id: "news", label: "新聞", team: false },
  ];

  let data = null;
  let teamsById = {};
  let watchlist = [];
  let activeTab = "moves";
  let activeTeam = "";

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
  const watchSection = document.getElementById("watch-section");
  const watchEl = document.getElementById("watch");
  const watchCountEl = document.getElementById("watch-count");

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
   * 最快可回歸的說法。這是規則算出來的最早有資格被啟動的日期，
   * 不是預估回歸日，所以字面一定要寫「最快」。
   */
  function returnLabel(earliest, daysUntil) {
    if (!earliest) return "";
    if (daysUntil === null || daysUntil === undefined) return "最快 " + shortDate(earliest) + " 可回歸";
    if (daysUntil <= 0) return "已可回歸";
    if (daysUntil === 1) return "最快明天可回歸";
    return "最快 " + shortDate(earliest) + " 可回歸（還有 " + daysUntil + " 天）";
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

  /* ---------- 關注名單 ---------- */

  function buildWatchIndex() {
    const byId = {};
    const byName = {};
    watchlist.forEach(function (entry) {
      if (entry.id) byId[String(entry.id)] = entry;
      if (entry.name) byName[normalizeName(entry.name)] = entry;
    });
    return { byId: byId, byName: byName };
  }

  function watchHit(index, playerId, name) {
    if (playerId && index.byId[String(playerId)]) return index.byId[String(playerId)];
    if (name && index.byName[normalizeName(name)]) return index.byName[normalizeName(name)];
    return null;
  }

  /*
   * 掃過所有區塊，把關注名單上的球員撈出來。
   * 同一個人可能同時出現在傷兵與強擊球排行，合併成一張卡不要重複列。
   */
  function collectWatched() {
    const index = buildWatchIndex();
    const found = {};

    function slot(playerId, name, teamId) {
      const entry = watchHit(index, playerId, name);
      if (!entry) return null;
      const key = String(playerId || normalizeName(name));
      if (!found[key]) {
        found[key] = {
          name: name,
          teamId: teamId,
          note: entry.note || "",
          lines: [],
          tone: "",
        };
      }
      return found[key];
    }

    (data.ilBoard || []).forEach(function (p) {
      const s = slot(p.playerId, p.name, p.teamId);
      if (!s) return;
      s.tone = s.tone || "il";
      const bits = [p.statusDesc || p.status];
      if (p.injury) bits.push(p.injury);
      const ret = returnLabel(p.earliestReturn, p.daysUntil);
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

    (data.hardHits || []).forEach(function (h, i) {
      const s = slot(h.playerId, h.name, h.teamId);
      if (!s) return;
      s.tone = s.tone || "hot";
      s.lines.push(
        "近期強擊球排行第 " + (i + 1) + " —— " + h.hardHits + " 球，最高 " + h.maxEV + " mph"
      );
    });

    (data.callups || []).forEach(function (c) {
      const s = slot(c.playerId, c.name, c.teamId);
      if (!s) return;
      s.tone = s.tone || "debut";
      s.lines.push(shortDate(c.date) + " " + (c.isDebut ? "大聯盟初登板" : c.typeDesc || ""));
    });

    return Object.keys(found).map(function (k) {
      return found[k];
    });
  }

  function renderWatch() {
    if (!watchlist.length) {
      watchSection.hidden = true;
      return;
    }
    const rows = collectWatched();
    watchEl.innerHTML = "";
    if (!rows.length) {
      watchSection.hidden = false;
      watchCountEl.textContent = "";
      watchEl.appendChild(notice("關注名單上的球員最近都沒有消息 —— 這通常是好事"));
      return;
    }

    watchSection.hidden = false;
    watchCountEl.textContent = rows.length + " 人";

    rows.forEach(function (r) {
      const card = el("div", "card is-" + (r.tone || "hot"));
      const head = el("div", "card-head");
      const name = el("div", "card-name");
      name.appendChild(document.createTextNode(r.name));
      head.appendChild(name);
      if (r.teamId) head.appendChild(el("span", "badge is-" + (r.tone || "hot"), teamName(r.teamId)));
      card.appendChild(head);

      if (r.note) card.appendChild(el("div", "card-meta card-injury", r.note));
      r.lines.forEach(function (line) {
        card.appendChild(el("div", "card-meta", line));
      });
      watchEl.appendChild(card);
    });
  }

  /* ---------- 各分頁 ---------- */

  function renderMoves() {
    const rows = (data.ilMoves || []).filter(function (m) {
      return matchesTeam(m.teamId);
    });
    if (!rows.length) return notice("近 " + (data.windows || {}).moves + " 天沒有名單異動");

    const wrap = el("div", "cards");
    rows.forEach(function (m) {
      const back = m.action === "activated";
      const card = el("div", "card " + (back ? "is-back" : "is-il"));

      const head = el("div", "card-head");
      const name = el("div", "card-name");
      name.appendChild(document.createTextNode(m.name));
      head.appendChild(name);
      head.appendChild(
        el(
          "span",
          "badge " + (back ? "is-back" : "is-il"),
          back ? "歸隊" : m.days ? m.days + " 天 IL" : listLabel(m.listKind) + "名單"
        )
      );
      card.appendChild(head);

      const meta = el("div", "card-meta");
      meta.appendChild(document.createTextNode(shortDate(m.date)));
      if (m.teamId) {
        meta.appendChild(el("span", "sep", "·"));
        meta.appendChild(document.createTextNode(teamName(m.teamId)));
      }
      if (m.injury) {
        meta.appendChild(el("span", "sep", "·"));
        meta.appendChild(el("span", "card-injury", m.injury));
      }
      card.appendChild(meta);

      const ret = returnLabel(m.earliestReturn, null);
      if (ret) card.appendChild(el("div", "card-meta", ret));
      wrap.appendChild(card);
    });
    return wrap;
  }

  function renderBoard() {
    const rows = (data.ilBoard || []).filter(function (p) {
      return matchesTeam(p.teamId);
    });
    if (!rows.length) return notice("這一隊目前沒有人在傷兵名單上");

    const wrap = el("div", "cards");
    rows.forEach(function (p) {
      const ready = p.daysUntil !== null && p.daysUntil !== undefined && p.daysUntil <= 0;
      const card = el("div", "card " + (ready ? "is-back" : "is-il"));

      const head = el("div", "card-head");
      const name = el("div", "card-name");
      if (p.pos) name.appendChild(el("span", "card-pos", p.pos));
      name.appendChild(document.createTextNode(p.name));
      head.appendChild(name);
      head.appendChild(el("span", "badge " + (ready ? "is-back" : "is-il"), p.statusDesc || p.status));
      card.appendChild(head);

      const meta = el("div", "card-meta");
      meta.appendChild(document.createTextNode(teamName(p.teamId)));
      if (p.injury) {
        meta.appendChild(el("span", "sep", "·"));
        meta.appendChild(el("span", "card-injury", p.injury));
      }
      card.appendChild(meta);

      const ret = returnLabel(p.earliestReturn, p.daysUntil);
      // 起算日對不到異動記錄時就沒有最快回歸日，這時候誠實留白，不要瞎猜
      card.appendChild(el("div", "card-meta", ret || "起算日不明，算不出可回歸日"));
      wrap.appendChild(card);
    });
    return wrap;
  }

  function renderHardHit() {
    const rows = (data.hardHits || []).filter(function (h) {
      return matchesTeam(h.teamId);
    });
    if (!rows.length) return notice("還沒有足夠的擊球資料");

    const wrap = el("div", "cards");
    rows.forEach(function (h) {
      const card = el("div", "card is-hot");
      const rank = el("div", "rank");

      const value = el("div", "rank-value", h.hardHits);
      rank.appendChild(value);

      const body = el("div", "rank-body");
      const head = el("div", "card-head");
      const name = el("div", "card-name");
      name.appendChild(document.createTextNode(h.name));
      head.appendChild(name);
      head.appendChild(el("span", "badge is-hot", teamName(h.teamId)));
      body.appendChild(head);

      const meta = el("div", "card-meta");
      meta.appendChild(
        document.createTextNode(
          h.battedBalls + " 次擊球中 " + Math.round(h.rate * 100) + "% 是強擊球"
        )
      );
      meta.appendChild(el("span", "sep", "·"));
      meta.appendChild(document.createTextNode("最高 " + h.maxEV + " mph"));
      meta.appendChild(el("span", "sep", "·"));
      meta.appendChild(document.createTextNode("平均 " + h.avgEV + " mph"));
      body.appendChild(meta);

      rank.appendChild(body);
      card.appendChild(rank);
      wrap.appendChild(card);
    });

    const foot = el(
      "p",
      "disclaimer",
      "強擊球＝擊球初速 95 mph 以上，這是通用的 hard-hit 門檻。" +
        "排序看的是數量不是比率，因為要找的是最近「頻繁」打出強擊球的人。"
    );
    const holder = el("div");
    holder.appendChild(wrap);
    holder.appendChild(foot);
    return holder;
  }

  function renderCallups() {
    const rows = (data.callups || []).filter(function (c) {
      return matchesTeam(c.teamId);
    });
    if (!rows.length) return notice("近 " + (data.windows || {}).callups + " 天沒有升上大聯盟的紀錄");

    const wrap = el("div", "cards");
    rows.forEach(function (c) {
      const card = el("div", "card " + (c.isDebut ? "is-debut" : "is-hot"));

      const head = el("div", "card-head");
      const name = el("div", "card-name");
      if (c.pos) name.appendChild(el("span", "card-pos", c.pos));
      name.appendChild(document.createTextNode(c.name));
      head.appendChild(name);
      head.appendChild(
        el(
          "span",
          "badge " + (c.isDebut ? "is-debut" : "is-hot"),
          c.isDebut ? "初登板" : c.type === "SE" ? "選上合約" : "叫上大聯盟"
        )
      );
      card.appendChild(head);

      const meta = el("div", "card-meta");
      meta.appendChild(document.createTextNode(shortDate(c.date)));
      if (c.teamId) {
        meta.appendChild(el("span", "sep", "·"));
        meta.appendChild(document.createTextNode(teamName(c.teamId)));
      }
      if (c.age) {
        meta.appendChild(el("span", "sep", "·"));
        meta.appendChild(document.createTextNode(c.age + " 歲"));
      }
      card.appendChild(meta);
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

  function renderNews() {
    const rows = data.news || [];
    if (!rows.length) return notice("目前沒有抓到新聞");

    const wrap = el("div", "cards");
    rows.forEach(function (n) {
      const card = el("a", "card");
      card.href = n.link;
      card.target = "_blank";
      card.rel = "noopener";

      const head = el("div", "card-head");
      head.appendChild(el("div", "card-name", n.title));
      card.appendChild(head);

      const meta = el("div", "card-meta");
      meta.appendChild(el("span", "news-source", n.source));
      if (n.date) {
        meta.appendChild(el("span", "sep", "·"));
        meta.appendChild(document.createTextNode(shortDate(n.date.slice(0, 10))));
      }
      card.appendChild(meta);
      wrap.appendChild(card);
    });
    return wrap;
  }

  const RENDERERS = {
    moves: renderMoves,
    board: renderBoard,
    hardhit: renderHardHit,
    callups: renderCallups,
    streaks: renderStreaks,
    news: renderNews,
  };

  /* ---------- 版面 ---------- */

  function countFor(tabId) {
    if (tabId === "moves") return (data.ilMoves || []).length;
    if (tabId === "board") return (data.ilBoard || []).length;
    if (tabId === "hardhit") return (data.hardHits || []).length;
    if (tabId === "callups") return (data.callups || []).length;
    if (tabId === "news") return (data.news || []).length;
    if (tabId === "streaks") {
      const s = data.streaks || {};
      return (s.wins || []).length + (s.losses || []).length;
    }
    return 0;
  }

  function renderNav() {
    navItemsEl.innerHTML = "";
    TABS.forEach(function (tab) {
      const btn = el("button", "nav-item" + (tab.id === activeTab ? " is-active" : ""));
      btn.type = "button";
      btn.setAttribute("aria-current", tab.id === activeTab ? "true" : "false");
      btn.appendChild(el("span", null, tab.label));
      btn.appendChild(el("span", "nav-count", countFor(tab.id)));
      btn.addEventListener("click", function () {
        activeTab = tab.id;
        try {
          localStorage.setItem(TAB_KEY, tab.id);
        } catch (err) {
          /* 無痕模式寫不進去，記不住分頁而已，不影響其他功能 */
        }
        closeDrawer();
        render();
      });
      navItemsEl.appendChild(btn);
    });
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
    renderNav();
    renderWatch();

    const tab = TABS.filter(function (t) {
      return t.id === activeTab;
    })[0];

    // 選單收起來之後，按鈕上這行字是唯一還看得到「現在在哪一區」的地方
    menuLabel.textContent = tab ? tab.label : "選單";

    // 新聞沒有球隊欄位，篩選對它沒有意義，所以那一頁把選單停掉
    teamSelect.disabled = !(tab && tab.team);
    teamSelect.title = tab && tab.team ? "" : "這一頁沒有球隊資訊，篩選不適用";

    boardEl.innerHTML = "";
    const section = el("section", "section");
    const heading = el("h2");
    heading.appendChild(document.createTextNode(tab ? tab.label : ""));
    section.appendChild(heading);
    section.appendChild(RENDERERS[activeTab]());
    boardEl.appendChild(section);
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

  function applyData(payload, watch) {
    data = payload;
    watchlist = (watch && watch.players) || [];
    teamsById = {};
    (data.teams || []).forEach(function (t) {
      teamsById[t.id] = t;
    });

    try {
      const saved = localStorage.getItem(TAB_KEY);
      if (saved && RENDERERS[saved]) activeTab = saved;
    } catch (err) {
      /* 讀不到就用預設分頁 */
    }

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

  /*
   * data.json 是必要的，抓不到就明講。
   * watchlist.json 是選用的，沒有或格式壞掉就當空名單，不要整頁掛掉。
   */
  Promise.all([
    fetch("data.json", { cache: "no-cache" }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }),
    fetch("watchlist.json", { cache: "no-cache" })
      .then(function (res) {
        return res.ok ? res.json() : { players: [] };
      })
      .catch(function () {
        return { players: [] };
      }),
  ])
    .then(function (results) {
      applyData(results[0], results[1]);
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
    applyData: applyData,
  };
})();

window.MLB = MLB;
