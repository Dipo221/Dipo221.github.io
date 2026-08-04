const STORAGE_KEY = "uiia-cat-count";

const STILL_SRC = "cat-still.png";
const SPIN_SRC = "cat-spin.gif";
const SPIN_LOOP_MS = 1830; // cat-spin.gif 轉一圈的長度

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

/* ---------- 「uiia」聲音合成 ---------- */
/*
 * 用共振峰（formant）合成人聲母音：鋸齒波當聲源，三個並聯的
 * bandpass 濾波器掃過 u → i → i → a 的共振峰頻率，就會唸出「uiia」。
 */

const VOWEL_FORMANTS = {
  u: [320, 800, 2240],
  i: [270, 2300, 3010],
  a: [730, 1090, 2440],
};

// [在整段音的相對位置, 母音]
const VOWEL_SEQUENCE = [
  [0.0, "u"],
  [0.3, "i"],
  [0.62, "i"],
  [1.0, "a"],
];

const FORMANT_GAINS = [1, 0.55, 0.25];

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

  // 連點時多個聲音會疊加，用壓縮器擋住破音
  const compressor = audioCtx.createDynamicsCompressor();
  compressor.threshold.value = -12;
  compressor.ratio.value = 12;
  compressor.connect(audioCtx.destination);
  outputBus = compressor;

  return audioCtx;
}

function playUiia(rate) {
  const ctx = ensureAudio();
  if (!ctx) return;

  const t0 = ctx.currentTime + 0.01;
  const dur = 0.75 / rate;
  const end = t0 + dur;

  const voice = ctx.createGain();
  voice.connect(outputBus);
  voice.gain.setValueAtTime(0, t0);
  voice.gain.linearRampToValueAtTime(0.5, t0 + 0.05);
  voice.gain.setValueAtTime(0.5, t0 + dur * 0.72);
  voice.gain.linearRampToValueAtTime(0.0001, end);

  // 聲源：帶點起伏的鋸齒波
  const f0 = 400 * rate;
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(f0 * 0.85, t0);
  osc.frequency.linearRampToValueAtTime(f0 * 1.2, t0 + dur * 0.45);
  osc.frequency.linearRampToValueAtTime(f0 * 0.95, end);

  // 顫音，聽起來比較像叫聲而不是電子音
  const vibrato = ctx.createOscillator();
  vibrato.frequency.value = 7;
  const vibratoDepth = ctx.createGain();
  vibratoDepth.gain.value = f0 * 0.035;
  vibrato.connect(vibratoDepth);
  vibratoDepth.connect(osc.frequency);

  FORMANT_GAINS.forEach((gainValue, formantIndex) => {
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = "bandpass";
    bandpass.Q.value = 9;

    VOWEL_SEQUENCE.forEach(([position, vowel], stepIndex) => {
      const at = t0 + dur * position;
      const freq = VOWEL_FORMANTS[vowel][formantIndex];
      if (stepIndex === 0) bandpass.frequency.setValueAtTime(freq, at);
      else bandpass.frequency.linearRampToValueAtTime(freq, at);
    });

    const gain = ctx.createGain();
    gain.gain.value = gainValue;

    osc.connect(bandpass);
    bandpass.connect(gain);
    gain.connect(voice);
  });

  osc.start(t0);
  vibrato.start(t0);
  osc.stop(end + 0.05);
  vibrato.stop(end + 0.05);
}

/* ---------- 旋轉 ---------- */
/*
 * 旋轉本身是 GIF 在動，所以這裡只負責在靜止圖與旋轉 GIF 之間切換。
 * 連點時不重播 GIF，只把停止時間往後延 —— 旋轉動畫沒有「正確的起始幀」，
 * 從哪一格接下去看起來都一樣順。
 */

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let spinTimer = null;

function spin() {
  if (reduceMotion) return;

  if (catImg.getAttribute("src") !== SPIN_SRC) {
    catImg.setAttribute("src", SPIN_SRC);
  }
  clearTimeout(spinTimer);
  spinTimer = setTimeout(() => {
    catImg.setAttribute("src", STILL_SRC);
    spinTimer = null;
  }, SPIN_LOOP_MS);
}

/* ---------- 連點強度 ---------- */
/* 連續快點會讓叫聲越來越高，停手就慢慢降回原音高。 */

let energy = 0;
let lastClickAt = 0;

function bumpEnergy() {
  const now = performance.now();
  const gap = now - lastClickAt;
  lastClickAt = now;

  if (gap < 700) energy = Math.min(energy + 0.25, 1);
  else energy = Math.max(0, energy - gap / 2000);

  return energy;
}

/* ---------- 互動 ---------- */

catButton.addEventListener("click", () => {
  count += 1;
  saveCount(count);
  renderCount();

  playUiia(1 + bumpEnergy() * 0.5);
  spin();

  catImg.classList.add("pop");
  setTimeout(() => catImg.classList.remove("pop"), 120);
});

resetButton.addEventListener("click", () => {
  count = 0;
  saveCount(count);
  renderCount();
});
