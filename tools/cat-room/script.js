/*
 * 接線：DOM、rAF 迴圈、輸入。
 *
 * 邏輯都在 world.js / cat.js / save.js / sprites.js，那四支不碰 DOM 所以測得到。
 * 這支只負責把它們接到畫面上，盡量不要在這裡放規則。
 */
(function () {
  "use strict";

  const room = document.getElementById("room");
  const catEl = document.getElementById("cat");
  const spriteEl = document.getElementById("cat-sprite");
  const bowlEl = document.getElementById("bowl");
  const noteEl = document.getElementById("note");
  const metaEl = document.getElementById("meta");
  const motionBtn = document.getElementById("motion-toggle");

  const MOTION_KEY = "cat-room:motion";

  /* ---------------------------------------------------------------- */
  /* 動態偏好                                                          */

  /*
   * 這是一個整個賣點就是待機動畫的遊戲，碰到 prefers-reduced-motion
   * 不能就這樣端出一隻不會動的貓。
   *
   * 拆開來看：會引起前庭不適的是「位移」——貓在房間裡走來走去。
   * 呼吸和眨眼是低振幅的原地變化，不是那個問題，而且療癒感正好來自這些。
   * 所以 reduced 模式停掉走動、保留呼吸。
   *
   * 另外給一顆按鈕可以覆寫：為了捲動而全域開 reduce 的人，
   * 未必不想看貓走路。預設尊重系統，但選擇權留給使用者。
   */
  const motionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");

  function savedMotion() {
    try {
      const v = localStorage.getItem(MOTION_KEY);
      return v === "full" || v === "reduced" ? v : null;
    } catch (err) {
      return null;
    }
  }

  let motion = savedMotion() || (motionMedia.matches ? "reduced" : "full");

  /*
   * 這顆按鈕只在有意義的時候才出現，兩種情況：
   *
   *   1. 系統開了減少動畫 —— 需要一個把動態要回來的入口
   *   2. 目前正處於減少動態 —— 一定要留一條路回去
   *
   * 第 2 條不是多寫的。少了它會有這條死路：系統開著減少動畫時把貓調成不動、
   * 之後又去把系統設定關掉 —— 這時 saved 是 "reduced"、系統說不用減少，
   * 按鈕消失，貓就永遠卡在不會走動的狀態，而且沒有任何地方可以改回來。
   *
   * 兩條都不成立的話（大多數人就是這樣），這顆按鈕唯一的作用是把使用者
   * 特地來看的東西關掉，沒必要一直佔著版面。
   */
  /*
   * 顯示過就留著，不要再收回去。
   *
   * 不latch 的話會有這個畫面：使用者按下「開啟動態」，動態恢復了，
   * 但條件同時不成立，按鈕就在他手指底下消失——而且他想反悔也沒得按。
   * 控制項可以晚點出現，不該在被使用的當下蒸發。
   */
  let motionControlLatched = false;

  function applyMotion() {
    document.body.setAttribute("data-motion", motion);
    if (!motionBtn) return;

    if (motionMedia.matches || motion === "reduced") motionControlLatched = true;
    motionBtn.hidden = !motionControlLatched;

    const goingFull = motion === "reduced";
    motionBtn.textContent = goingFull ? "開啟動態" : "減少動態";
    motionBtn.setAttribute("aria-pressed", motion === "reduced" ? "true" : "false");
  }

  function toggleMotion() {
    motion = motion === "reduced" ? "full" : "reduced";
    try {
      localStorage.setItem(MOTION_KEY, motion);
    } catch (err) {
      // 存不起來就只影響這次瀏覽
    }
    applyMotion();
  }

  applyMotion();
  if (motionBtn) motionBtn.addEventListener("click", toggleMotion);
  motionMedia.addEventListener("change", function (e) {
    // 沒自己選過就跟著系統跑。選過的話狀態不動，但按鈕該不該出現要重算
    if (!savedMotion()) motion = e.matches ? "reduced" : "full";
    applyMotion();
  });

  /* ---------------------------------------------------------------- */
  /* 存檔與回訪                                                        */

  const now = Date.now();
  const loaded = Save.load(now);
  const state = loaded.state;

  const scene = World.returnScene(now - state.lastSeen, World.seedFrom(state.lastSeen));

  // 先用舊的 lastSeen 算完場景，才可以把它更新成現在
  state.lastSeen = now;
  state.totalVisits += 1;
  state.cat.bond += scene.bondDelta;
  if (scene.gift) state.gifts.push({ id: scene.gift.id, at: now });
  Save.save(state);

  function showNote(text) {
    if (!noteEl) return;
    noteEl.textContent = text || "";
    noteEl.classList.toggle("is-empty", !text);
  }

  if (loaded.isNew) {
    showNote("有一隻貓自己走了進來，決定住下。");
  } else {
    showNote(scene.message);
  }

  function renderMeta() {
    if (!metaEl) return;
    const days = Math.floor((Date.now() - state.firstSeen) / World.DAY);
    const parts = [];
    if (days >= 1) parts.push("你們認識 " + days + " 天了");
    if (state.gifts.length) parts.push("收到 " + state.gifts.length + " 件禮物");
    metaEl.textContent = parts.join("　·　");
  }

  /*
   * 同一種禮物收到很多次就併成一行加數量，不要列出十片一模一樣的葉子。
   * 這排是這個遊戲唯一看得見的累積——沒有分數、沒有等級、沒有進度條。
   */
  function renderGifts() {
    const giftsEl = document.getElementById("gifts");
    if (!giftsEl) return;

    const counts = {};
    const order = [];
    for (let i = 0; i < state.gifts.length; i++) {
      const id = state.gifts[i].id;
      if (counts[id] === undefined) {
        counts[id] = 0;
        order.push(id);
      }
      counts[id] += 1;
    }

    giftsEl.textContent = "";
    for (let i = 0; i < order.length; i++) {
      const li = document.createElement("li");
      li.className = "gift";
      li.textContent = World.giftLabel(order[i]) + (counts[order[i]] > 1 ? " ×" + counts[order[i]] : "");
      giftsEl.appendChild(li);
    }
  }

  function renderProgress() {
    renderMeta();
    renderGifts();
  }

  renderProgress();

  /* ---------------------------------------------------------------- */
  /* 房間光線                                                          */

  /*
   * 房間跟著真實時間走，兩個主題下都是。
   *
   * 站台的深／淺主題管的是頁面外框，房間內部是遊戲自己的世界——
   * 房間是一扇看出去的窗，照片裡是夜景不會因為你切成淺色就變白天。
   * 所以這裡不讀 data-theme，只讀時鐘。
   */
  function syncLight() {
    room.setAttribute("data-tod", World.timeOfDay(new Date()));
  }
  syncLight();
  setInterval(syncLight, 60 * 1000);

  /* ---------------------------------------------------------------- */
  /* 貓                                                                */

  const rand = Math.random;

  const cat = {
    state: "sit",
    startedAt: performance.now(),
    duration: 4000,
    x: 0.5,        // 房間寬度的比例，0 是最左
    targetX: 0.5,
    facing: 1,
    close: false   // 走到前面來（approach 用）
  };

  let roomW = room.clientWidth;
  window.addEventListener("resize", function () {
    roomW = room.clientWidth;
  });

  function enter(next, at) {
    // 吃完就把碗收掉。放在這裡是因為 eat 結束的路徑只有這一條
    if (cat.state === "eat" && next !== "eat") bowlEl.classList.remove("is-full");

    cat.state = next;
    cat.startedAt = at;
    cat.duration = Cat.durationFor(next, rand);
    cat.close = next === "approach";
    cat.pending = null;

    /*
     * x 是「貓的左緣佔房間寬度的比例」，而貓本身寬 15%，
     * 所以上限是 0.85 才不會切出右邊界。留一點餘裕抓 0.78。
     */
    if (next === "approach") {
      cat.targetX = 0.42; // 置中：0.42 + 一半的 0.15 ≈ 0.5
    } else if (Cat.moves(next)) {
      cat.targetX = 0.06 + rand() * 0.72;
    }

    catEl.setAttribute("data-anim", next);
  }

  /*
   * 先走過去，到了再做那件事。
   *
   * 餵食如果直接切成 eat，貓會站在原地對著空氣吃——碗在房間另一頭。
   * 所以先派牠走過去，抵達之後才進入真正的動作。
   */
  function goThenDo(targetX, then, at) {
    enter("walk", at);
    cat.targetX = targetX;
    cat.pending = then;
    cat.duration = 8000;
  }

  function step(t) {
    if (cat.pending) {
      const arrived = Math.abs(cat.targetX - cat.x) <= 0.006;
      /*
       * 逾時也要放行：reduced-motion 模式整段不位移，
       * 光等「走到」的話牠會永遠站在那裡等一件不會發生的事。
       */
      if (arrived || t - cat.startedAt > cat.duration) {
        const next = cat.pending;
        cat.pending = null;
        enter(next, t);
      }
    } else if (t - cat.startedAt > cat.duration) {
      const next = Cat.pickNext(cat.state, World.energy(new Date()), state.cat.bond, rand);
      enter(next, t);
    }

    // 位移。reduced 模式整段跳過，貓留在原地但還是會呼吸、眨眼
    if (motion === "full" && Cat.moves(cat.state)) {
      const speed = cat.state === "play" ? 0.0045 : 0.0022;
      const dx = cat.targetX - cat.x;
      if (Math.abs(dx) > 0.005) {
        const move = Math.sign(dx) * Math.min(Math.abs(dx), speed);
        cat.x += move;
        cat.facing = move > 0 ? 1 : -1;
      }
    }

    render(t);
    requestAnimationFrame(step);
  }

  function render(t) {
    const px = cat.x * roomW;
    /*
     * cat.facing 是「往哪邊移動」：1 是往右。
     * 但圖裡的貓本來就朝左，所以往右走才要翻面——facesLeft 決定正負，
     * 換一包朝右的素材時只要改 sprites.js 那個旗標。
     */
    const flip = Sprites.manifest.facesLeft ? -cat.facing : cat.facing;
    catEl.style.transform =
      "translate3d(" + px.toFixed(1) + "px, " + (cat.close ? "10px" : "0px") + ", 0) " +
      "scaleX(" + flip + ")";

    if (Sprites.ready()) {
      const m = Sprites.manifest;
      const f = Sprites.frameFor(cat.state, t - cat.startedAt);
      // 見 style.css：百分比的 background-position 要除以「格數 - 1」
      const fx = m.cols > 1 ? (f.col / (m.cols - 1)) * 100 : 0;
      const fy = m.rows > 1 ? (f.row / (m.rows - 1)) * 100 : 0;
      spriteEl.style.backgroundPosition = fx + "% " + fy + "%";
    }
  }

  /*
   * 開場狀態。一定要走 enter()，直接指定 cat.state 的話
   * data-anim 和 duration 會停在初始值，跟實際狀態對不上。
   */
  if (scene.greet) {
    // 離開超過兩天：從角落走過來，這樣「迎上來」才看得出來
    cat.x = 0.06;
    enter("approach", performance.now());
  } else {
    enter(World.energy(new Date()) < 0.3 ? "sleep" : "sit", performance.now());
  }

  // 有素材包才切過去，沒有就維持 placeholder 色塊
  if (Sprites.ready()) {
    const m = Sprites.manifest;
    document.body.setAttribute("data-art", "sprite");
    spriteEl.style.backgroundImage = 'url("' + m.sheet + '")';
    spriteEl.style.backgroundSize = m.cols * 100 + "% " + m.rows * 100 + "%";
  }

  requestAnimationFrame(step);

  /* ---------------------------------------------------------------- */
  /* 互動                                                              */

  // bond 給得太浮濫的話「牠最近比較常過來」就不再是一件事了，隔一段時間才給一次
  const BOND_COOLDOWN = 30 * 1000;
  let lastBondAt = 0;

  function grantBond(amount) {
    const t = Date.now();
    if (t - lastBondAt < BOND_COOLDOWN) return;
    lastBondAt = t;
    state.cat.bond += amount;
    Save.save(state);
  }

  function react(cls) {
    catEl.classList.add(cls);
    setTimeout(function () {
      catEl.classList.remove(cls);
    }, 600);
  }

  function pet() {
    // 摸摸永遠有效，睡著的貓也可以摸，牠會呼嚕。這是真的
    state.pet.count += 1;
    grantBond(1);
    react("is-purring");
    showNote(cat.state === "sleep" ? "牠沒睜眼，但呼嚕聲變大了。" : "牠瞇起眼睛，往你的手靠過去。");
    Save.save(state);
    renderProgress();
  }

  function feed() {
    if (!Cat.accepts(cat.state, "feed")) {
      showNote("牠睡得很熟，等一下再說吧。");
      return;
    }
    state.fed.count += 1;
    state.fed.lastAt = Date.now();
    grantBond(1);
    bowlEl.classList.add("is-full");
    goThenDo(0.68, "eat", performance.now()); // 碗在 74%，走過去再吃
    showNote("牠聽到碗的聲音就過來了。");
    Save.save(state);
  }

  function wand() {
    if (!Cat.accepts(cat.state, "wand")) {
      // 一隻會無視你的貓才像貓
      showNote("牠動了一下耳朵，然後繼續睡。");
      return;
    }
    grantBond(1);
    enter("play", performance.now());
    showNote("牠壓低身體，尾巴開始擺。");
    Save.save(state);
  }

  document.getElementById("act-pet").addEventListener("click", pet);
  document.getElementById("act-feed").addEventListener("click", feed);
  document.getElementById("act-wand").addEventListener("click", wand);

  // 直接摸貓本人比按鈕直覺
  catEl.addEventListener("click", pet);

  /* ---------------------------------------------------------------- */
  /* 離開與回來                                                        */

  function markSeen() {
    state.lastSeen = Date.now();
    Save.save(state);
  }

  /*
   * 分頁開著掛一整天不該算成「離開」，所以在前景時定時更新 lastSeen。
   * 切走時記一次，切回來時如果離開夠久就補一段回訪訊息。
   */
  setInterval(function () {
    if (!document.hidden) markSeen();
  }, 60 * 1000);

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      markSeen();
      return;
    }
    const away = Date.now() - state.lastSeen;
    const back = World.returnScene(away, World.seedFrom(state.lastSeen));
    if (back.tier !== "none") {
      state.cat.bond += back.bondDelta;
      if (back.gift) state.gifts.push({ id: back.gift.id, at: Date.now() });
      showNote(back.message);
      renderProgress();
    }
    markSeen();
    syncLight();
  });

  // pagehide 在手機上比 beforeunload 可靠
  window.addEventListener("pagehide", markSeen);
})();
