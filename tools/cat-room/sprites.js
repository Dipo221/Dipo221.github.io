/*
 * Sprite manifest。純資料 + 兩個取格的助手。
 *
 * 換素材包只動這一支，遊戲邏輯完全不用碰。這件事很重要——
 * 像素貓素材的授權差很多（有些明文寫「不可公開散布」，放進公開 repo 就違約），
 * 所以要保留隨時換掉的餘地。目前選的是 CC-BY 4.0 的那個，
 * 授權與出處寫在 art/LICENSE.txt。
 *
 * sheet 設成 null 時會進入 placeholder 模式，貓變成一個會動的色塊。
 * 這不是暫時湊合——在美術定案前先把手感、時間流動、存檔跑通，
 * 比先貼一張畫得爛的圖有用。站規那句「placeholder 勝過畫得爛的假貨」就是這個意思。
 */
const Sprites = (function () {
  "use strict";

  const manifest = {
    sheet: "art/cat-16.png",
    frameW: 16,
    frameH: 16,
    cols: 3,
    rows: 3,

    /*
     * 圖裡的貓臉朝左（眼睛在左邊、尾巴在右邊）。
     * 往右走的時候要水平翻面，所以這個旗標決定 scaleX 的正負。
     * 寫成資料而不是寫死在 script.js，是因為換一包朝右的素材時
     * 只要把這行改成 false，其他都不用動。
     */
    facesLeft: true,

    /*
     * 這張表是看圖判讀出來的，不是素材附的說明：
     *   第 0 排 直立、睜眼、尾巴小幅擺動   → idle
     *   第 1 排 直立、尾巴豎起再垂下       → 當成走路（16x16 畫不出腳，靠尾巴表現在動）
     *   第 2 排 趴著、眼睛閉成一條線       → sleep
     */
    anims: {
      idle: { row: 0, frames: [0, 1, 2], ms: 260, loop: true },
      walk: { row: 1, frames: [0, 1, 2], ms: 150, loop: true },
      sleep: { row: 2, frames: [0, 1, 2], ms: 800, loop: true },
      // 坐著就是 idle 的第一格定住，這包沒有專門的坐姿
      sit: { row: 0, frames: [0], ms: 400, loop: true }
    },

    /*
     * 素材包沒有的動作就指到有的那個，不要硬湊。
     * 之後換到動畫更齊的包，只要補 anims、把對應的那行從 alias 刪掉就好。
     *
     * eat 指到 idle 是誠實的妥協：這包沒有低頭吃東西的格，
     * 與其拿一個姿勢不對的格假裝，不如讓牠站在碗邊。
     */
    alias: {
      groom: "idle",
      play: "walk",
      approach: "walk",
      eat: "idle"
    }
  };

  function ready() {
    return !!manifest.sheet;
  }

  // 跟著 alias 走一層。alias 不做遞迴，指到不存在的名字就退回 idle
  function resolve(name) {
    const target = manifest.alias[name] || name;
    return manifest.anims[target] || manifest.anims.idle;
  }

  /*
   * 算現在該顯示第幾格。
   * loop 為 false 的動畫播完會停在最後一格並回報 done，
   * 讓狀態機知道「這段演完了」。
   */
  function frameFor(name, elapsed) {
    const anim = resolve(name);
    const total = anim.frames.length;
    const step = Math.floor(elapsed / anim.ms);

    let index;
    let done = false;

    if (anim.loop) {
      index = step % total;
    } else if (step >= total) {
      index = total - 1;
      done = true;
    } else {
      index = step;
    }

    return { col: anim.frames[index], row: anim.row, done: done };
  }

  return {
    manifest: manifest,
    ready: ready,
    resolve: resolve,
    frameFor: frameFor
  };
})();

window.Sprites = Sprites;
