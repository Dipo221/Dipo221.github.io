/*
 * GitHub 的 contents API 收發檔案內容都是 base64，這裡負責轉換。
 *
 * 單獨拆成一支是為了能被 test.html 測到。看起來只有幾行，但中文店家名稱
 * 全部要靠它來回一趟，錯了不會噴錯，只會讓 places.json 變成亂碼，
 * 而且是存進 GitHub 之後才發現——所以寧可測。
 */

const Codec = (function () {
  "use strict";

  /*
   * btoa 只接受 Latin-1（每個字元 0-255），中文丟進去會直接丟
   * InvalidCharacterError。要先用 TextEncoder 轉成 UTF-8 位元組，
   * 再把每個位元組當成一個字元交給 btoa。
   */
  function encodeBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  /*
   * 反過來。注意 GitHub 回的 base64 是有換行的（每 60 字元一行），
   * atob 遇到換行會丟錯，所以先把空白清掉。
   */
  function decodeBase64(base64) {
    const binary = atob(String(base64).replace(/\s/g, ""));
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  return { encodeBase64: encodeBase64, decodeBase64: decodeBase64 };
})();
