const STORAGE_KEY = "uiia-cat-count";

const STILL_SRC = "cat-still.png";
const SPIN_SRC = "cat-spin.gif";
const AUDIO_SRC = "uiia.mp3";

/*
 * 音檔裡有三聲「uiia」，中間有明顯靜音。與其切成三個檔案，
 * 這裡整段載入一次、用 start(when, offset, duration) 播指定區間：
 * 只需要一次請求、不必重新編碼，切點也只是兩個數字，隨時可調。
 * 下面的秒數都落在三段之間的靜音處。
 */
const SEGMENTS = [
  [0.0, 1.75],
  [2.84, 5.12],
  [6.2, 8.45],
];

const catButton = document.getElementById("cat");
const catImg = document.getElementById("cat-img");
const countEl = document.getElementById("count");
const resetButton = document.getElementById("reset");

/* ---------- 計數 ---------- */

function loadCount() {
  try {
    return Number(localStorage.getItem(STORAGE_KEY)) || 0;
  } catch {
    return 0; // 隱私模式下 localStorage 可能不可用
  }
}

function saveCount(value) {
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    /* 存不進去就算了，不影響使用 */
  }
}

let count = loadCount();

function renderCount() {
  countEl.textContent = count.toLocaleString();
  countEl.classList.add("bump");
  setTimeout(() => countEl.classList.remove("bump"), 120);
}

countEl.textContent = count.toLocaleString();

/* ---------- 聲音 ---------- */

let audioCtx = null;
let outputBus = null;

function ensureAudio() {
  if (audioCtx) {
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;

  audioCtx = new Ctor();

  const compressor = audioCtx.createDynamicsCompressor();
  compressor.threshold.value = -12;
  compressor.ratio.value = 12;
  compressor.connect(audioCtx.destination);
  outputBus = compressor;

  return audioCtx;
}

// 位元組先抓下來，等第一次點擊（使用者操作）再解碼，避免自動播放限制
const audioBytes = fetch(AUDIO_SRC)
  .then((res) => (res.ok ? res.arrayBuffer() : null))
  .catch(() => null);

let decodedBuffer = null;
let decoding = null;

function getBuffer() {
  if (decodedBuffer) return Promise.resolve(decodedBuffer);
  if (!decoding) {
    decoding = audioBytes
      .then((bytes) => {
        const ctx = ensureAudio();
        if (!bytes || !ctx) return null;
        // decodeAudioData 會吃掉這塊 ArrayBuffer，複製一份留底
        return ctx.decodeAudioData(bytes.slice(0));
      })
      .then((buffer) => (decodedBuffer = buffer))
      .catch(() => null);
  }
  return decoding;
}

let currentVoice = null;

function playSegment(index) {
  const [start, end] = SEGMENTS[index];

  getBuffer().then((buffer) => {
    const ctx = ensureAudio();
    if (!buffer || !ctx) return;

    // 一次只留一聲，連點時直接接上下一段而不是疊在一起
    stopCurrentVoice();

    const duration = end - start;
    const now = ctx.currentTime;

    const gain = ctx.createGain();
    gain.connect(outputBus);
    // 切點雖然在靜音處，還是淡入淡出一下比較保險
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + 0.015);
    gain.gain.setValueAtTime(1, now + duration - 0.03);
    gain.gain.linearRampToValueAtTime(0.0001, now + duration);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    source.start(0, start, duration);

    const voice = { source, gain };
    currentVoice = voice;
    source.onended = () => {
      if (currentVoice === voice) currentVoice = null;
    };
  });
}

function stopCurrentVoice() {
  if (!currentVoice) return;
  const { source, gain } = currentVoice;
  const now = audioCtx.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(0.0001, now + 0.02);
  source.stop(now + 0.03);
  currentVoice = null;
}

/* ---------- 旋轉 ---------- */
/*
 * 旋轉本身是 GIF 在動，這裡只負責在靜止圖與旋轉 GIF 之間切換。
 * 連點時不重播 GIF，只把停止時間往後延 —— 旋轉動畫沒有「正確的起始幀」，
 * 從哪一格接下去看起來都一樣順。
 */

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let spinTimer = null;

function spin(durationMs) {
  if (reduceMotion) return;

  if (catImg.getAttribute("src") !== SPIN_SRC) {
    catImg.setAttribute("src", SPIN_SRC);
  }
  clearTimeout(spinTimer);
  spinTimer = setTimeout(() => {
    catImg.setAttribute("src", STILL_SRC);
    spinTimer = null;
  }, durationMs);
}

/* ---------- 互動 ---------- */

catButton.addEventListener("click", () => {
  count += 1;
  saveCount(count);
  renderCount();

  // 第 1 次點播第 1 段、第 2 次第 2 段⋯⋯第 4 次再回到第 1 段
  const index = (count - 1) % SEGMENTS.length;
  const [start, end] = SEGMENTS[index];

  playSegment(index);
  spin((end - start) * 1000); // 貓咪轉到這一聲結束為止

  catImg.classList.add("pop");
  setTimeout(() => catImg.classList.remove("pop"), 120);
});

resetButton.addEventListener("click", () => {
  count = 0;
  saveCount(count);
  renderCount();
});
