/*
 * 貓的行為狀態機。
 *
 * 一樣是純函式：亂數從外面傳進來（rand 是一個回傳 0~1 的函式），
 * 所以 test.html 可以塞一個固定序列進來驗，也可以跑一萬次看分佈。
 *
 * 設計上刻意不做「指令 → 反應」的對應表。貓自己決定要做什麼，
 * 使用者的動作只是改變機率。一隻隨叫隨到的貓不像貓，
 * 會無視你才像——這是這個遊戲好不好玩的關鍵，不是偷懶。
 */
const Cat = (function () {
  "use strict";

  /*
   * 每個狀態待多久（毫秒）。睡覺那格特別長是故意的：
   * 貓真的會睡很久，而且畫面上有一隻安靜睡著的貓，比一直動來動去更療癒。
   * moves 表示這個狀態會在房間裡位移，reduced-motion 時要擋掉的就是這些。
   */
  const STATES = {
    idle: { min: 2500, max: 6000 },
    sit: { min: 4000, max: 12000 },
    groom: { min: 4000, max: 9000 },
    sleep: { min: 20000, max: 90000 },
    walk: { min: 2000, max: 5000, moves: true },
    play: { min: 3000, max: 7000, moves: true },
    approach: { min: 3000, max: 5000, moves: true },
    eat: { min: 4000, max: 7000 }
  };

  // 吃完會理毛。真的貓就是這樣，這個小細節比多加一個功能有用
  const FORCED_NEXT = { eat: "groom" };

  /*
   * bond 要累積到一定程度，approach（主動走向你）才會開始出現。
   * 這是整個遊戲唯一的長線進度，而且它是行為上的變化、不是一條進度條——
   * 使用者不會看到數字，只會某天發現「牠最近比較常過來」。
   */
  const BOND_FOR_APPROACH = 12;
  const BOND_FULL = 60;

  function bondFactor(bond) {
    if (bond < BOND_FOR_APPROACH) return 0;
    const t = (bond - BOND_FOR_APPROACH) / (BOND_FULL - BOND_FOR_APPROACH);
    return Math.max(0, Math.min(1, t));
  }

  /*
   * 算出各狀態的權重。energy 是 World.energy() 給的 0~1。
   *
   * 低活力時 sleep 的權重會壓過所有其他選項，這正是下午那段要的效果；
   * 高活力時 walk / play 才拉得起來。
   */
  function weights(current, energy, bond) {
    const w = {
      sleep: (1 - energy) * 3.2,
      sit: 0.8,
      idle: 0.8,
      groom: 0.5,
      walk: energy * 2,
      play: energy * 1.2,
      approach: bondFactor(bond) * energy * 0.9
    };

    /*
     * 同一個狀態的權重砍半，讓牠不要卡在原地重複。
     * 用砍半而不是歸零，因為連續睡兩段是正常的，連續走兩段也不奇怪。
     */
    if (w[current] !== undefined) w[current] *= 0.5;

    return w;
  }

  function pickNext(current, energy, bond, rand) {
    if (FORCED_NEXT[current]) return FORCED_NEXT[current];

    const w = weights(current, energy, bond);
    const keys = Object.keys(w);

    let total = 0;
    for (let i = 0; i < keys.length; i++) total += w[keys[i]];
    if (total <= 0) return "sit";

    let roll = rand() * total;
    for (let i = 0; i < keys.length; i++) {
      roll -= w[keys[i]];
      if (roll <= 0) return keys[i];
    }
    return keys[keys.length - 1];
  }

  // 狀態要待多久。同一個狀態每次長度不同，規律的節奏會讓牠看起來像機器
  function durationFor(state, rand) {
    const s = STATES[state] || STATES.idle;
    return s.min + rand() * (s.max - s.min);
  }

  function moves(state) {
    return !!(STATES[state] && STATES[state].moves);
  }

  /*
   * 別停在看不見的地方（待辦第 4 項）。
   *
   * 紙箱會擋住貓，那是刻意的——走過去的時候整隻不見才叫縱深。
   * 但**挑一個看不見的地方停下來**是另一回事：sleep 一睡 20~90 秒，
   * 那段時間畫面上不是「貓躲在箱子後面」，是「貓不見了」。
   * 所以走隨機的路可以穿過禁區，選目的地的時候要被推出來。
   *
   * rects 是 room-data.js 的 noStop（[x0, y0, x1, y1]，x 是中心、y 是腳），
   * back / front 是地板的前後界。**優先往房間裡面推**：貓退到箱子後面
   * 但比箱口高的地方，頭會從箱口上面露出來——那是這一版最好看的位置。
   * 裡面推不動（頂到牆）才往前面推，兩邊都不行就原地不動。
   *
   * 純函式，不碰 DOM，所以 test.html 塞幾個假的矩形就能驗。
   */
  /*
   * 推出禁區之後要離邊界多遠。
   *
   * **不是為了浮點數，是為了 script.js 的死區。** 那邊每一幀只有在
   * 「還差 0.005 以上」的時候才移動貓（差一點點就別抖了）。這個數字如果比
   * 0.005 小，貓卡在禁區最上緣的時候會算出一個近到不用動的目標——
   * 於是牠留在看不見的地方，而且是靜止的。0.012 大約是 2 個來源像素。
   */
  const EDGE = 0.012;

  function avoidHidden(rects, x, y, back, front) {
    if (!rects || !rects.length) return y;
    // 推出一個矩形可能掉進另一個裡面。矩形只有兩三個，掃到不動為止就好
    for (let pass = 0; pass < rects.length + 1; pass++) {
      let hit = null;
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]) { hit = r; break; }
      }
      if (!hit) return y;
      const up = hit[1] - EDGE;
      const down = hit[3] + EDGE;
      if (up >= back) y = up;
      else if (down <= front) y = down;
      else return y;
    }
    return y;
  }

  /*
   * 使用者動作能不能打斷現在的狀態。
   *
   * 睡著的貓不會理逗貓棒——這條是刻意留的挫折感，
   * 而且它讓「牠醒著的時候願意陪你玩」這件事有了重量。
   * 但摸摸永遠有效：你可以摸一隻睡著的貓，牠會呼嚕，這是真的。
   */
  function accepts(state, action) {
    if (action === "pet") return true;
    if (state === "sleep") return false;
    return true;
  }

  return {
    STATES: STATES,
    BOND_FOR_APPROACH: BOND_FOR_APPROACH,
    bondFactor: bondFactor,
    weights: weights,
    pickNext: pickNext,
    durationFor: durationFor,
    moves: moves,
    avoidHidden: avoidHidden,
    accepts: accepts
  };
})();

window.Cat = Cat;
