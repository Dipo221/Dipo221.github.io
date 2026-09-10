/*
 * 世界的時間規則。
 *
 * 這支全是純函式——不碰 DOM、不讀 localStorage、不呼叫 Date.now()，
 * 時間一律當參數傳進來。所以 test.html 可以直接餵一個假的時間點進來驗，
 * 不用等到真的下午兩點才知道貓會不會睡。
 *
 * 整個遊戲最重要的規則寫在 returnScene()：**離開越久，回來看到的越好。**
 * 傳統電子雞是反過來的——飢餓值隨時間掉，你沒來貓就受苦。
 * 那種設計會讓「三天沒開」變成一件有罪惡感的事，而這個遊戲存在的理由
 * 就是給人在忙完之後喘一口氣，不是再給一個 deadline。
 * 所以這裡沒有任何一個數值會往下掉，bondDelta 也永遠不會是負的。
 * test.html 有一條測試專門守這件事，改動這支之前先去看那條。
 */
const World = (function () {
  "use strict";

  const MINUTE = 60 * 1000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  /*
   * mulberry32。要的不是亂數品質，是「同一個種子一定給同一串」——
   * 這樣使用者重整頁面不會重骰禮物。不做加密級的東西，溫和擋掉就好。
   */
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /*
   * 種子取自「上次離開的那個小時」。
   * 同一次回訪不管重整幾次都是同一個種子，但下次真的離開再回來就會換。
   */
  function seedFrom(lastSeen) {
    return Math.floor(lastSeen / HOUR);
  }

  function pick(list, rand) {
    return list[Math.floor(rand() * list.length) % list.length];
  }

  /* ---------------------------------------------------------------- */

  /*
   * 現在是台北的幾點。
   *
   * 不能用 date.getHours()，那是**看的人**的本地時間。
   * Disi 住在淡水的房間，牠幾點睡覺跟看的人在哪無關——
   * 人在德國下午打開，那時台北是半夜，就該看到一隻睡著的貓。
   *
   * 同樣的道理和寫法在 tools/open-now/hours.js 的 taipeiNow() 已經有了
   * （那邊是「店在淡水，營業時間當然是台北時間」）。
   * 沒有直接載那支是因為為了一個時區換算，
   * 不值得把 460 行的營業時間解析器綁進這個工具，也不該讓兩個工具互相依賴。
   */
  function taipeiHour(date) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Taipei",
      hour: "2-digit",
      hourCycle: "h23"
    }).formatToParts(date || new Date());

    for (let i = 0; i < parts.length; i++) {
      if (parts[i].type === "hour") return parseInt(parts[i].value, 10);
    }
    return 0;
  }

  /*
   * 台北的今天是幾號，格式 YYYY-MM-DD。
   *
   * 拿來當每日計數的 key。日期一定要用台北的：
   * 人在柏林的訪客在他的晚上會落到「明天」那把 key，
   * 數字就跟 Disi 實際過的那一天對不起來。
   *
   * 用 formatToParts 自己組而不是靠 en-CA 之類的地區格式，
   * 是因為地區格式會隨瀏覽器的 ICU 版本變，自己組才是確定的。
   */
  function taipeiDate(date) {
    const p = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    })
      .formatToParts(date || new Date())
      .reduce(function (acc, part) {
        acc[part.type] = part.value;
        return acc;
      }, {});

    return p.year + "-" + p.month + "-" + p.day;
  }

  /*
   * 房間光線用的四個時段。這個只管畫面，不管貓的行為——
   * 行為看下面的 energy()，兩者的分界點刻意不一樣。
   */
  function timeOfDay(date) {
    const h = taipeiHour(date);
    if (h >= 5 && h < 8) return "dawn";
    if (h >= 8 && h < 17) return "day";
    if (h >= 17 && h < 20) return "dusk";
    return "night";
  }

  /*
   * 貓的活力，0 到 1。
   *
   * 貓是晨昏性動物（crepuscular），一天有兩個活動高峰在清晨和黃昏，
   * 中間的下午幾乎整段在睡。照這個曲線走，牠的作息才會像真的貓——
   * 使用者中午打開看到牠在睡、傍晚打開看到牠在衝，那個落差就是靈魂。
   *
   * 直接查表比寫成三角函數好讀，也好在 test 裡指定某一小時來驗。
   */
  const ENERGY_BY_HOUR = [
    0.2, 0.15, 0.15, 0.2, 0.35, 0.6, // 00-05 深夜，偶爾起來晃一下
    0.85, 0.9, 0.8,                   // 06-08 清晨高峰
    0.5, 0.45, 0.4,                   // 09-11 安定下來、理毛
    0.2, 0.15, 0.12, 0.12, 0.2,       // 12-16 下午，睡死
    0.9, 1.0, 0.95,                   // 17-19 黃昏高峰，會暴衝
    0.75, 0.65, 0.5, 0.35             // 20-23 還很活躍，慢慢收
  ];

  function energy(date) {
    return ENERGY_BY_HOUR[taipeiHour(date)];
  }

  /*
   * 現在是台北一天中的第幾分鐘（0-1439）。
   *
   * dailyStory() 要判斷「出門的時間到了沒」，taipeiHour() 只到整點，
   * 撐不起「17:35 出門、18:20 回來」這種比對，所以另外開一支到分鐘的。
   */
  function taipeiMinuteOfDay(date) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Taipei",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(date || new Date());

    let h = 0;
    let m = 0;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].type === "hour") h = parseInt(parts[i].value, 10);
      if (parts[i].type === "minute") m = parseInt(parts[i].value, 10);
    }
    return h * 60 + m;
  }

  /* ---------------------------------------------------------------- */

  /*
   * Disi 自己的一天（待辦第 8 項）。「今天心情怎樣」跟「現在在不在家」
   * 合成一個函式來想，因為它們常常是同一件事——「今天出去帶了東西回來」
   * 這句心情，講的就是牠出去那件事。分開做的話心情跟出門會各自隨機，
   * 講出兩件互相矛盾的事：牠明明在家，卻說自己今天出去玩過。
   *
   * 種子只吃台北的日期字串，不吃任何存檔或使用者狀態——所以同一個台北日，
   * 所有人看到同一份心情，重整頁面不會重骰，跟禮物同一招（seedFrom + rng，
   * 只是這裡種的是「今天是哪一天」不是「上次離開的那個小時」）。
   *
   * rand() 不管今天出不出門都照同一個順序抽三次（要不要出門、出門的時間、
   * 平常的心情）。這樣兩條分支耗掉的亂數量一樣——不這樣做的話，
   * 哪天在其中一支中間插一行新的 rand()，只有走另一條分支的日期會悄悄換掉
   * 種子往後的整串結果，變成一個只在特定日期出現的詭異回歸。
   */
  function seedFromDate(dateStr) {
    return parseInt(dateStr.replace(/-/g, ""), 10);
  }

  const AWAY_CHANCE = 1 / 7;      // 大概一週一次：訪客必須幾乎不可能連續撲空
  const AWAY_START_AT = 17 * 60;  // 出門只發生在黃昏高峰（17-19，見上面的 ENERGY_BY_HOUR）
  const AWAY_START_RANGE = 90;    // 出門時間落在 17:00-18:30
  const AWAY_MIN_DURATION = 20;   // 20-45 分鐘：短到空房間只是暫時的
  const AWAY_DURATION_RANGE = 25;

  const DAILY_MOODS = [
    (n) => n + " 今天曬了太陽，覺得很舒服。",
    (n) => n + " 今天沒抓到那隻小動物，有點懊惱。",
    (n) => n + " 今天大部分時間都在睡。",
    (n) => n + " 今天一直趴在窗邊看外面。"
  ];

  /*
   * 今天的排程：今天有沒有出門、幾點出門、出多久、平常的心情是哪一句。
   * 純函式，只吃「台北日期字串」，所以 test.html 可以直接塞
   * "2026-09-07" 之類的字串驗，不用真的等到那一天才知道結果。
   */
  function dailyStory(dateStr, name) {
    const n = name || CAT_NAME;
    const rand = rng(seedFromDate(dateStr));

    const goesOut = rand() < AWAY_CHANCE;
    const startMin = AWAY_START_AT + Math.floor(rand() * AWAY_START_RANGE);
    const duration = AWAY_MIN_DURATION + Math.floor(rand() * AWAY_DURATION_RANGE);
    const mood = pick(DAILY_MOODS, rand)(n);

    if (!goesOut) {
      return { away: null, moodBefore: mood, moodAfter: mood };
    }

    return {
      away: { startMin: startMin, endMin: startMin + duration, duration: duration },
      // 出門前不能先講「牠帶東西回來了」——那件事在敘事的時間軸上還沒發生
      moodBefore: mood,
      moodAfter: n + " 今天出去帶了東西回來，很得意。"
    };
  }

  /*
   * 現在算不算「牠出門了」。每次呼叫都是拿當下時間重新跟今天的排程比對一次，
   * 不是一個觸發之後會一直維持的旗標——出門時段一過，它自己就變回 false。
   */
  function isAway(date) {
    const d = date || new Date();
    const story = dailyStory(taipeiDate(d));
    if (!story.away) return false;
    const min = taipeiMinuteOfDay(d);
    return min >= story.away.startMin && min < story.away.endMin;
  }

  /*
   * 空房間那句提示。**自己判斷現在算不算出門**，不是只看今天有沒有排出門——
   * 今天有出門排程，但還沒到出門時間（或已經回來了）的話一樣回 null。
   * 呼叫端不用先想著要呼叫 isAway() 才安全，這支自己就是安全的。
   *
   * 回來的時間只分兩檔，不報精確分鐘數：「大概半小時」是敘事，
   * 「大概 23 分鐘」是報表，這頁不該有報表的語氣。
   */
  function awayNote(date, name) {
    const d = date || new Date();
    if (!isAway(d)) return null;
    const story = dailyStory(taipeiDate(d), name);
    const eta = story.away.duration < 30 ? "一下下" : "大概半小時";
    return (name || CAT_NAME) + " 跑出去玩了，" + eta + "後回來看看。";
  }

  /*
   * 摸摸的時候講的「今天過得怎樣」。
   *
   * 心情是敘事不是狀態：**不進存檔、不被任何邏輯讀取、不影響 bond
   * 也不影響行為**，純粹是「台北日期＋現在幾點 → 一句話」。
   * 出門那天，出門前後講的是 dailyStory 給的兩句不同的話——
   * 出門前講的是平常那句，回來之後才換成「牠帶東西回來了」。
   */
  function dailyMood(date, name) {
    const d = date || new Date();
    const story = dailyStory(taipeiDate(d), name);
    if (!story.away) return story.moodBefore;
    return taipeiMinuteOfDay(d) < story.away.endMin ? story.moodBefore : story.moodAfter;
  }

  /* ---------------------------------------------------------------- */

  /*
   * 名字。定義成常數而不是存在每個人的存檔裡——牠是同一隻貓，
   * 不是每個訪客各自領養的一隻。
   *
   * 存檔的 cat.name 當作選用的覆寫：有值就用它。
   * 這樣要改名開 console 改一行就好，不用重新部署。
   */
  const CAT_NAME = "Disi";

  function catName(save) {
    return (save && save.cat && save.cat.name) || CAT_NAME;
  }

  /*
   * Disi 搬進來的日子。改這個常數就等於改牠的年紀。
   *
   * 減 8 小時是把它對齊到**台北的**午夜，不是 UTC 的——
   * 這樣天數會在台北凌晨換日，跟房間的日夜同一套時間。
   *
   * 這個數字刻意不進存檔：所有人看到的都該是同一個，
   * 而且存檔清掉時牠不該突然變回剛搬來。
   */
  const ARRIVED = Date.UTC(2026, 7, 25) - 8 * 60 * 60 * 1000;

  function daysHere(now) {
    return Math.max(0, Math.floor(((now || Date.now()) - ARRIVED) / DAY));
  }

  /*
   * 行為亂數的種子：把時間切成 3 分鐘一段，同一段給同一個種子。
   *
   * 這樣同一個切片裡進來的人，起手會看到 Disi 在做同一件事。
   * 用絕對時間戳而不是台北的分鐘，因為切片只要「大家一致」就好，
   * 對齊到哪個時區沒有意義。
   *
   * 這是**近似**不是保證同步：進來之後兩邊的狀態機各自跑，
   * 抽到的長度不同就會慢慢分岔。要逐格一致得在切片內重播狀態機，
   * 那個複雜度換來的差別很小，刻意不做。
   */
  function behaviourSlot(now) {
    return Math.floor((now || Date.now()) / (3 * MINUTE));
  }

  // 貓叼回來的東西。都是牠在房間裡「撿到」的，不是憑空生出來的道具
  const GIFTS = [
    { id: "leaf", label: "一片葉子" },
    { id: "cap", label: "一個瓶蓋" },
    { id: "tie", label: "你的髮圈" },
    { id: "pebble", label: "一顆小石頭" },
    { id: "paper", label: "一顆皺掉的紙團" },
    { id: "sock", label: "一隻襪子(另一隻不知道去哪了)" }
  ];

  /*
   * 選單裡「更新日誌」給訪客看的白話版，不是 CHANGELOG.md 那份給開發者看的
   * 開發日誌——那份滿是函式名稱、pixel 座標，訪客看了不知道在講什麼。
   *
   * **底下的句子明陽自己寫，不要代筆補上去。** 這是整個遊戲唯一直接對訪客
   * 講話的地方，語氣是他的。CHANGELOG.md 那份照寫沒問題，兩份不是同一件事。
   * 功能做完就停在這裡等他寫，他寫完才一起 commit。
   *
   * 新到舊排，跟 CHANGELOG.md 的順序一樣（test.html 押著日期要新到舊，加反了會紅）。
   */
  const UPDATES = [
    { date: "2026-09-11", text: "Disi可以被家具擋住，不會永遠走在前面。" },
    { date: "2026-09-09", text: "選單裡加入遊戲介紹、更新日誌。" },
    { date: "2026-09-08", text: "設計電腦版木牌，加入側邊選單功能。" },
    { date: "2026-09-07", text: "Disi有自己一天的心情，有時候偷跑出去玩，新增手機版側邊選單功能" },
    { date: "2026-09-06", text: "修改吉他擺放位置。" },
    { date: "2026-09-05", text: "新增紙箱、吉他與書桌。" },
    { date: "2026-09-04", text: "新增吊燈、海報、盆栽、層架、地毯和盆栽。" },
    { date: "2026-09-03", text: "重新調整畫面比例，手機和電腦都是滿版，房間新增床、書櫃、逗貓棒，取消互動按鈕，改成按房間內物品觸發。" },
    { date: "2026-09-01", text: "把Disi加大，修正外觀小瑕疵，新增奔跑、眨眼、舔毛動畫。" },
    { date: "2026-08-28", text: "加大窗戶，光線隨著現實時間變化。" },
    { date: "2026-08-27", text: "設計房間架構，新增紅磚牆、木地板、斜屋頂。" },
    { date: "2026-08-26", text: "重新設計Disi的外觀，新增坐姿和吃飯動畫。" },
    { date: "2026-08-25", text: "這個遊戲誕生的第一天，Disi住了進來。" }
  ];

  /*
   * 名字用代入的，不要寫死在字串裡——cat.name 可以覆寫。
   *
   * 句首用名字、句中用「牠」，而且不是每一句都塞。
   * 每句都放名字讀起來會像在念稿。
   */
  const BRIEF = [
    (n) => n + " 在你走後不久就睡了。",
    () => "牠換了個位置，假裝剛剛沒在等你。",
    (n) => n + " 在窗邊坐了一下。"
  ];

  // 存檔裡只留 id，要顯示的時候再查回名字，這樣改文案不用動到舊存檔
  function giftLabel(id) {
    for (let i = 0; i < GIFTS.length; i++) {
      if (GIFTS[i].id === id) return GIFTS[i].label;
    }
    return "一個不知道是什麼的東西";
  }

  function humanize(ms) {
    if (ms >= DAY) return Math.floor(ms / DAY) + " 天";
    if (ms >= HOUR) return Math.floor(ms / HOUR) + " 小時";
    return Math.max(1, Math.floor(ms / MINUTE)) + " 分鐘";
  }

  /*
   * 回訪場景。elapsed 是離開了多久，seed 決定這次抽到什麼。
   *
   * opts.owner 為 false 時（訪客）算法完全一樣，但 message 一律是 null——
   * 「你離開了 5 天，牠等你很久了」是明陽跟 Disi 之間的事，
   * 路人不該收到那句話。訪客要看的字由 script.js 依貓當下的狀態另外生。
   * 預設是 true，所以既有的呼叫端不會壞。
   *
   * 回傳的 bondDelta 永遠 >= 0。這不是「目前剛好沒有負的」，
   * 是這個遊戲的設計前提，任何修改都不該打破它——包含訪客版。
   */
  function returnScene(elapsed, seed, opts) {
    const o = opts || {};
    const name = o.name || CAT_NAME;
    const owner = o.owner !== false;
    const rand = rng(seed);
    const say = (text) => (owner ? text : null);

    // 五分鐘內當作根本沒離開。硬要生一個事件只會變成洗版面的假訊息
    if (elapsed < 5 * MINUTE) {
      return { tier: "none", message: null, gift: null, bondDelta: 0, greet: false };
    }

    if (elapsed < HOUR) {
      return {
        tier: "brief",
        message: say(pick(BRIEF, rand)(name)),
        gift: null,
        bondDelta: 0,
        greet: false
      };
    }

    if (elapsed < 8 * HOUR) {
      return {
        tier: "nap",
        message: say(name + " 在你的椅子上睡了 " + humanize(elapsed) + "。"),
        gift: null,
        bondDelta: 1,
        greet: false
      };
    }

    if (elapsed < 2 * DAY) {
      const gift = pick(GIFTS, rand);
      return {
        tier: "gift",
        message: say("你不在的時候，牠找到了" + gift.label + "，放在門口。"),
        gift: gift,
        bondDelta: 2,
        greet: false
      };
    }

    // 超過兩天。這是最需要做對的一格——回來看到的必須是溫的
    const gift = pick(GIFTS, rand);
    return {
      tier: "longing",
      message: say(
        "你離開了 " + humanize(elapsed) + "。" + name + " 聽到聲音就過來了，還帶著" + gift.label + "。"
      ),
      gift: gift,
      bondDelta: 3,
      // 迎上來是看得到的行為，不是關係層的文字，訪客也留著
      greet: true
    };
  }

  return {
    rng: rng,
    seedFrom: seedFrom,
    taipeiHour: taipeiHour,
    taipeiDate: taipeiDate,
    timeOfDay: timeOfDay,
    energy: energy,
    catName: catName,
    daysHere: daysHere,
    behaviourSlot: behaviourSlot,
    returnScene: returnScene,
    humanize: humanize,
    giftLabel: giftLabel,
    taipeiMinuteOfDay: taipeiMinuteOfDay,
    dailyStory: dailyStory,
    isAway: isAway,
    awayNote: awayNote,
    dailyMood: dailyMood,
    CAT_NAME: CAT_NAME,
    ARRIVED: ARRIVED,
    GIFTS: GIFTS,
    UPDATES: UPDATES,
    MINUTE: MINUTE,
    HOUR: HOUR,
    DAY: DAY
  };
})();

window.World = World;
