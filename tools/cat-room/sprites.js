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
    /*
     * 圖的網址帶版本號，因為 rows 一變，舊圖配新 manifest 會整個錯位——
     * 快取裡還是 3 排的舊圖時，後面幾排會取到圖外面，貓變成一塊空白。
     * 加姿勢改了圖就要把這個號碼加一。
     *
     * 檔名帶著格子大小（見 art/pixel.py 的 build_sheet），所以 2026-09-01
     * 從 16x16 改成 24x24 那次是換檔名，不是加號碼——換網址本來就繞過快取，
     * 而且 `disi-16.png` 裡面裝 24x24 的貓是一份會騙人的文件。
     */
    sheet: "art/disi-24.png?v=1",
    frameW: 24,
    frameH: 24,
    cols: 3,
    rows: 6,

    /*
     * 圖裡的貓臉朝左（眼睛在左邊、尾巴在右邊）。
     * 往右走的時候要水平翻面，所以這個旗標決定 scaleX 的正負。
     * 寫成資料而不是寫死在 script.js，是因為換一包朝右的素材時
     * 只要把這行改成 false，其他都不用動。
     */
    facesLeft: true,

    /*
     * 一排一個姿勢：
     *   第 0 排 站著、睜眼、尾巴尖左右勾  → idle
     *   第 1 排 站著、重心上下起伏        → walk 與 run 共用
     *   第 2 排 趴著、眼睛閉成橫線        → sleep
     *   第 3 排 坐著、尾巴尖左右勾        → sit
     *   第 4 排 低頭吃、頭上下點          → eat
     *   第 5 排 坐著洗臉、頭往抬起的腳壓  → groom
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
      /*
       * sit 跟 idle 一樣只有尾巴在動，所以幀速也跟 idle 同一個量級。
       * 上半身直接沿用 idle 那三格的頭與尾巴，換掉的只有肩膀以下——
       * 坐與站在剪影上的差別全在下半身，上面跟著變只會像換了一隻貓。
       */
      sit: { row: 3, frames: [0, 1, 2], ms: 320, loop: true },
      /*
       * eat 走 0-1-2-1，跟 walk 同一種來回：0 是嘴埋進碗裡、2 是抬頭嚼。
       * 190ms 一格、一輪 760ms，比 walk 慢一點——嚼東西的節奏比走路鬆。
       */
      eat: { row: 4, frames: [0, 1, 2, 1], ms: 190, loop: true },
      /*
       * groom 跟 eat 一樣是頭在動、身體不動，所以也走 0-1-2-1 的來回：
       * 0 是下巴壓在抬起來的那隻腳上、2 是抬起頭。
       * 但幀速用 idle 那一級的 260ms，不是 eat 的 190ms——理毛是慢動作，
       * 用 190ms 會變成在啄自己的腳。
       */
      groom: { row: 5, frames: [0, 1, 2, 1], ms: 260, loop: true }
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
     * eat 與 groom 以前都指到 idle，理由是沒有那些格、與其假裝不如讓牠站著。
     * 素材改成自己畫的之後 eat 有了，24x24 這一版 groom 也有了自己的一排——
     * 理毛要側過身舔，那真的不是 idle 換個頭就有的。
     * 所以現在這裡只剩兩個，而且兩個都是**刻意共用**不是欠著。
     */
    alias: {
      play: "run",
      approach: "walk"
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
