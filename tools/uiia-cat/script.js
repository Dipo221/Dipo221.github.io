const STORAGE_KEY = "uiia-cat-count";

const catButton = document.getElementById("cat");
const catSvg = catButton.querySelector(".cat-svg");
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
  const dur = 0.62 / rate;
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

const SPIN_BOOST = 900; // 每次點擊增加的角速度（度／秒）
const SPIN_MAX = 2600;
const SPIN_RETAINED_PER_SEC = 0.35; // 每秒保留的角速度比例
const SPIN_STOP_THRESHOLD = 40;

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let angle = 0;
let velocity = 0;
let lastFrame = 0;
let rafId = null;

function frame(now) {
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;

  if (velocity > SPIN_STOP_THRESHOLD) {
    angle += velocity * dt;
    velocity *= Math.pow(SPIN_RETAINED_PER_SEC, dt);
  } else {
    // 慢下來之後，滑回最近的整圈讓貓咪站正
    velocity = 0;
    const target = Math.round(angle / 360) * 360;
    angle += (target - angle) * Math.min(dt * 8, 1);
    if (Math.abs(target - angle) < 0.5) {
      angle = target % 360;
      catSvg.style.transform = "rotate(0deg)";
      rafId = null;
      return;
    }
  }

  catSvg.style.transform = `rotate(${angle}deg)`;
  rafId = requestAnimationFrame(frame);
}

function spin() {
  velocity = Math.min(velocity + SPIN_BOOST, SPIN_MAX);
  if (rafId === null) {
    lastFrame = performance.now();
    rafId = requestAnimationFrame(frame);
  }
}

/* ---------- 互動 ---------- */

catButton.addEventListener("click", () => {
  count += 1;
  saveCount(count);
  renderCount();

  // 連點時轉得越快、叫聲也越高，越像迷因原片
  const intensity = velocity / SPIN_MAX;
  playUiia(1 + intensity * 0.5);

  if (reduceMotion) return;
  spin();
});

resetButton.addEventListener("click", () => {
  count = 0;
  saveCount(count);
  renderCount();
});
