/*
 * Sprite manifest。純資料 + 兩個取格的助手。
 *
 * 換素材包只動這一支，遊戲邏輯完全不用碰。當初拆出這層，是因為
 * 像素貓素材的授權差很多（有些明文寫「不可公開散布」，放進公開 repo 就違約），
 * 要留隨時換掉的餘地——結果真的用上了。現在這包是自己畫的，
 * 換掉原本那包 CC BY 素材的時候，這支以外一行都沒動。
 * 來源、畫法與工具寫在 art/LICENSE.txt。
 *
 * sheet 設成 null 時會進入 placeholder 模式，貓變成一個會動的色塊。
 * 這不是暫時湊合——在美術定案前先把手感、時間流動、存檔跑通，
 * 比先貼一張畫得爛的圖有用。站規那句「placeholder 勝過畫得爛的假貨」就是這個意思。
 */
const Sprites = (function () {
  "use strict";

  const manifest = {
    sheet: "art/disi-16.png",
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
     * 三排各一個姿勢：
     *   第 0 排 站著、睜眼、尾巴尖左右勾  → idle
     *   第 1 排 站著、重心上下起伏        → walk 與 run 共用
     *   第 2 排 趴著、眼睛閉成橫線        → sleep
     *
     * walk 與 run 是同三格畫面、不同播放順序：
     *   walk  0-1-2-1  身體先沉、頭慢一拍跟上，回程也錯開，每段只動一個部位
     *   run   0-1-2    從 2 直接跳回 0，頭與身體同時彈起
     * 同步回彈當走路很假，當跑步剛好是奔馳騰空那一下。一組畫面兩種步態。
     *
     * run 的 ms 是算的不是挑的。play 在地上的速度是其他移動狀態的 2.05 倍
     * （script.js 裡那行三元），走路一輪 4x150 = 600ms，除以 2.05 得 293ms，
     * 所以跑步用 3x100 = 300ms，步頻才跟得上位移。動任何一邊都要重算另一邊。
     * 同一份資料在 art/disi.py 的 PLAY，那邊是手動同步的，改這裡記得改那裡。
     */
    anims: {
      idle: { row: 0, frames: [0, 1, 2], ms: 260, loop: true },
      walk: { row: 1, frames: [0, 1, 2, 1], ms: 150, loop: true },
      run: { row: 1, frames: [0, 1, 2], ms: 100, loop: true },
      sleep: { row: 2, frames: [0, 1, 2], ms: 800, loop: true },
      // 坐著就是 idle 的第一格定住，這包沒有專門的坐姿
      sit: { row: 0, frames: [0], ms: 400, loop: true }
    },

    /*
     * 沒有專屬動畫的動作就指到有的那個，不要硬湊。補了新動畫就改對應的那行。
     *
     * play 指到 run 不是為了好看。play 在地上本來就跑得比較快，
     * 之前跟 walk 共用同一套幀速，步頻跟不上位移，腳等於在打滑。
     *
     * approach 留在 walk 是刻意的：它的移動速度跟 walk 一樣，
     * 而且主動走過來是這個遊戲唯一的長線進度（見 cat.js 的 BOND_FOR_APPROACH），
     * 那件事的重點是安靜地被發現，衝過來會把氣氛打掉。
     *
     * eat 指到 idle 是誠實的妥協：沒有低頭吃東西的格，
     * 與其拿一個姿勢不對的格假裝，不如讓牠站在碗邊。
     */
    alias: {
      groom: "idle",
      play: "run",
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
