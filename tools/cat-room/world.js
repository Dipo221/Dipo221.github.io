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
    { id: "sock", label: "一隻襪子（另一隻不知道去哪了）" }
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
    CAT_NAME: CAT_NAME,
    ARRIVED: ARRIVED,
    GIFTS: GIFTS,
    MINUTE: MINUTE,
    HOUR: HOUR,
    DAY: DAY
  };
})();

window.World = World;
