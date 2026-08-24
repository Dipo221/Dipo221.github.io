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
   * 房間光線用的四個時段。這個只管畫面，不管貓的行為——
   * 行為看下面的 energy()，兩者的分界點刻意不一樣。
   */
  function timeOfDay(date) {
    const h = date.getHours();
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
    return ENERGY_BY_HOUR[date.getHours()];
  }

  /* ---------------------------------------------------------------- */

  // 貓叼回來的東西。都是牠在房間裡「撿到」的，不是憑空生出來的道具
  const GIFTS = [
    { id: "leaf", label: "一片葉子" },
    { id: "cap", label: "一個瓶蓋" },
    { id: "tie", label: "你的髮圈" },
    { id: "pebble", label: "一顆小石頭" },
    { id: "paper", label: "一顆皺掉的紙團" },
    { id: "sock", label: "一隻襪子（另一隻不知道去哪了）" }
  ];

  const BRIEF = [
    "你剛走牠就睡了。",
    "牠換了個位置，假裝剛剛沒在等你。",
    "牠在窗邊坐了一下。"
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
   * 回傳的 bondDelta 永遠 >= 0。這不是「目前剛好沒有負的」，
   * 是這個遊戲的設計前提，任何修改都不該打破它。
   */
  function returnScene(elapsed, seed) {
    const rand = rng(seed);

    // 五分鐘內當作根本沒離開。硬要生一個事件只會變成洗版面的假訊息
    if (elapsed < 5 * MINUTE) {
      return { tier: "none", message: null, gift: null, bondDelta: 0, greet: false };
    }

    if (elapsed < HOUR) {
      return {
        tier: "brief",
        message: pick(BRIEF, rand),
        gift: null,
        bondDelta: 0,
        greet: false
      };
    }

    if (elapsed < 8 * HOUR) {
      return {
        tier: "nap",
        message: "牠在你的椅子上睡了 " + humanize(elapsed) + "。",
        gift: null,
        bondDelta: 1,
        greet: false
      };
    }

    if (elapsed < 2 * DAY) {
      const gift = pick(GIFTS, rand);
      return {
        tier: "gift",
        message: "你不在的時候，牠找到了" + gift.label + "，放在門口。",
        gift: gift,
        bondDelta: 2,
        greet: false
      };
    }

    // 超過兩天。這是最需要做對的一格——回來看到的必須是溫的
    const gift = pick(GIFTS, rand);
    return {
      tier: "longing",
      message: "你離開了 " + humanize(elapsed) + "。牠聽到聲音就過來了，還帶著" + gift.label + "。",
      gift: gift,
      bondDelta: 3,
      greet: true
    };
  }

  return {
    rng: rng,
    seedFrom: seedFrom,
    timeOfDay: timeOfDay,
    energy: energy,
    returnScene: returnScene,
    humanize: humanize,
    giftLabel: giftLabel,
    GIFTS: GIFTS,
    MINUTE: MINUTE,
    HOUR: HOUR,
    DAY: DAY
  };
})();

window.World = World;
