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

/* ---------- 計數 ---------- */
/*
 * 計數放在 Abacus（免費的共用計數服務）上，所有訪客共用同一個數字。
 * GitHub Pages 是純靜態的、沒有後端，所以只能靠外部服務。
 *
 * 點擊時先在畫面上樂觀地 +1，再把伺服器回傳的值當作準。confirmed 是
 * 伺服器確認過的數字，pending 是送出去還沒回來的點擊數。
 */

const COUNTER_URL = "https://abacus.jasoncameron.dev";
const COUNTER_NS = "dipo221-github-io";
const COUNTER_KEY = "uiia-cat";

let confirmed = null; // 還不知道伺服器上的值時是 null
let pending = 0;

function renderCount(bump) {
  countEl.textContent = confirmed === null ? "—" : (confirmed + pending).toLocaleString();
  countEl.classList.toggle("pending", confirmed === null || pending > 0);

  if (!bump) return;
  countEl.classList.add("bump");
  setTimeout(() => countEl.classList.remove("bump"), 120);
}

function acceptServerValue(value) {
  if (typeof value !== "number") return;
  // 多個請求可能亂序回來，只往上取
  confirmed = confirmed === null ? value : Math.max(confirmed, value);
}

// 進站先讀目前的數字（不會增加）
fetch(`${COUNTER_URL}/get/${COUNTER_NS}/${COUNTER_KEY}`)
  .then((res) => (res.ok ? res.json() : { value: 0 })) // key 還沒建立時是 404
  .then((data) => acceptServerValue(data.value))
  .catch(() => {
    /* 連不上就維持「—」，之後點擊成功的話數字自然會出現 */
  })
  .finally(() => renderCount(false));

function bumpCounter() {
  pending += 1;
  renderCount(true);

  fetch(`${COUNTER_URL}/hit/${COUNTER_NS}/${COUNTER_KEY}`)
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => data && acceptServerValue(data.value))
    .catch(() => {
      /* 這一下沒算到，畫面會退回伺服器的數字 */
    })
    .finally(() => {
      pending -= 1;
      renderCount(false);
    });
}

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

// 播哪一段要看「這個人按了第幾下」，不能用共用計數 —— 那個數字會被
// 別的訪客推著跳，聲音就不會照順序輪。
let clicks = 0;

catButton.addEventListener("click", () => {
  bumpCounter();

  // 第 1 次點播第 1 段、第 2 次第 2 段⋯⋯第 4 次再回到第 1 段
  const index = clicks % SEGMENTS.length;
  clicks += 1;
  const [start, end] = SEGMENTS[index];

  playSegment(index);
  spin((end - start) * 1000); // 貓咪轉到這一聲結束為止

  catImg.classList.add("pop");
  setTimeout(() => catImg.classList.remove("pop"), 120);
});
