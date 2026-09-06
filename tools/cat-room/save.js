/*
 * 存檔。
 *
 * 命名照全站慣例 <範圍>:<功能>，跟 open-now:github-token、mingyang:theme 一致。
 *
 * 讀寫一律包 try/catch：無痕模式和擋掉 storage 的瀏覽器會直接丟例外，
 * 不接住的話整頁掛掉。存不起來就當作每次都是新的貓——遊戲還是能玩，
 * 這比白畫面好。theme.js 也是這樣處理的。
 */
const Save = (function () {
  "use strict";

  const KEY = "cat-room:save";
  const VERSION = 1;

  /*
   * 注意這裡沒有任何一個「會往下掉」的欄位。
   * 沒有飢餓值、沒有清潔值、沒有心情值——這是設計上的決定，不是還沒做。
   * bond 只會加，加完就留在那裡。
   */
  function blank(now) {
    return {
      v: VERSION,
      cat: { name: null, bond: 0, sprite: "tabby" },
      firstSeen: now,
      lastSeen: now,
      totalVisits: 0,
      fed: { count: 0, lastAt: null },
      pet: { count: 0 },
      gifts: [],
      /*
       * items 是 v2 的訪客貓與圖鑑要用的，先留著讓存檔格式不用再改一次版。
       *
       * lampOn 是吊燈、deskLampOn 是桌燈的開關（M3，2026-09-04 與 09-05）。
       * **它們不違反上面那條**：這是使用者自己按的狀態，
       * 不是時間到了會自己變的數值。沒有人不來牠就會自己把燈關掉這種事。
       *
       * 兩盞燈各存各的，因為它們各關各的。預設都是開著。
       */
      room: { items: [], lampOn: true, deskLampOn: true },
      seenCats: []
    };
  }

  /*
   * 把讀到的東西補成完整的形狀。
   *
   * 兩個方向都要顧：舊存檔缺欄位要補齊；未來版本的存檔（v 比現在大）
   * 不能直接砍掉重來，那等於把使用者養了半年的貓刪了。
   * 所以策略一律是「以預設值為底，把讀到的蓋上去」，不認得的欄位原樣留著。
   */
  function migrate(raw, now) {
    const base = blank(now);
    if (!raw || typeof raw !== "object") return base;

    const out = Object.assign({}, base, raw);
    out.cat = Object.assign({}, base.cat, raw.cat);
    out.fed = Object.assign({}, base.fed, raw.fed);
    out.pet = Object.assign({}, base.pet, raw.pet);
    out.room = Object.assign({}, base.room, raw.room);

    if (!Array.isArray(out.gifts)) out.gifts = [];
    if (!Array.isArray(out.seenCats)) out.seenCats = [];
    if (!Array.isArray(out.room.items)) out.room.items = [];
    // 壞掉的存檔會讓它變成字串或 null，而 "false" 是真的——
    // 那會變成一盞關不掉的燈。只認真正的 false，其餘一律當作開著。
    // **舊存檔沒有 deskLampOn，這條同時也是它的預設值**
    out.room.lampOn = out.room.lampOn !== false;
    out.room.deskLampOn = out.room.deskLampOn !== false;

    // 存檔壞掉時這些會是 NaN 或字串，往下算時間會整個爛掉，先擋起來
    if (typeof out.firstSeen !== "number" || !isFinite(out.firstSeen)) out.firstSeen = now;
    if (typeof out.lastSeen !== "number" || !isFinite(out.lastSeen)) out.lastSeen = now;
    if (typeof out.cat.bond !== "number" || !isFinite(out.cat.bond)) out.cat.bond = 0;
    if (out.cat.bond < 0) out.cat.bond = 0;
    if (typeof out.totalVisits !== "number" || !isFinite(out.totalVisits)) out.totalVisits = 0;

    // 比現在新的存檔就讓它維持原本的版本號，不要往下降
    out.v = Math.max(VERSION, typeof raw.v === "number" ? raw.v : 0);

    return out;
  }

  function load(now) {
    let raw = null;
    try {
      const text = localStorage.getItem(KEY);
      if (text) raw = JSON.parse(text);
    } catch (err) {
      // 壞掉的 JSON 或讀不到 storage，都當作沒有存檔
      raw = null;
    }
    return { state: migrate(raw, now), isNew: !raw };
  }

  function save(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (err) {
      return false;
    }
  }

  function clear() {
    try {
      localStorage.removeItem(KEY);
    } catch (err) {
      // 清不掉也沒什麼好處理的
    }
  }

  return {
    KEY: KEY,
    VERSION: VERSION,
    blank: blank,
    migrate: migrate,
    load: load,
    save: save,
    clear: clear
  };
})();

window.Save = Save;
