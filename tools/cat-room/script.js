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
  /* 主人模式                                                          */

  const OWNER_KEY = "cat-room:owner";

  /*
   * 網址帶 #me 就記住這台裝置是主人，之後直接進來也認得。
   * 照 open-now/editor.js 的 #edit，但改用 localStorage 而不是 sessionStorage——
   * 那邊要的是單次分頁的編輯權限，這邊要的是「我這台電腦」。
   *
   * **這不是安全機制，也不需要是。**
   * bond 和禮物本來就存在每個人自己的瀏覽器裡，陌生人就算翻原始碼
   * 找到 #me 解鎖，看到的也只是他自己的一排 0，沒有任何屬於明陽的東西會外流。
   * 它單純是一個顯示開關。
   */
  function readOwner() {
    try {
      if (location.hash === "#me") {
        localStorage.setItem(OWNER_KEY, "1");
        return true;
      }
      return localStorage.getItem(OWNER_KEY) === "1";
    } catch (err) {
      // storage 被擋掉的話至少讓這次的 #me 有效
      return location.hash === "#me";
    }
  }

  const isOwner = readOwner();
  document.body.setAttribute("data-role", isOwner ? "owner" : "guest");

  /* ---------------------------------------------------------------- */
  /* 存檔與回訪                                                        */

  const now = Date.now();
  const loaded = Save.load(now);
  const state = loaded.state;
  const catName = World.catName(state);

  const scene = World.returnScene(
    now - state.lastSeen,
    World.seedFrom(state.lastSeen),
    { name: catName, owner: isOwner }
  );

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

  /*
   * 訪客沒有領養誰，不能跟他說「有一隻貓走進來決定住下」。
   * 開場白對他來說是介紹，不是宣告。
   */
  if (loaded.isNew) {
    showNote(
      isOwner
        ? "有一隻貓自己走了進來，決定住下。"
        : "這是 " + catName + "。牠住在明陽的房間裡。"
    );
  } else if (scene.message) {
    showNote(scene.message);
  }
  // 訪客且沒有訊息時先留白，等開場狀態決定好再補一句「牠在幹嘛」（見 openingNote）

  // 訪客看的是牠此刻在做什麼——那正是他進來想看的東西
  const DOING = {
    sleep: "正在睡覺",
    groom: "正在理毛",
    walk: "在房間裡走來走去",
    play: "玩得正起勁",
    sit: "坐在地上",
    idle: "在發呆",
    approach: "正朝你走過來",
    eat: "在吃東西"
  };

  function describeDoing() {
    return catName + " " + (DOING[cat.state] || DOING.idle) + "。";
  }

  /* ---------------------------------------------------------------- */
  /* 被摸過幾次（共用計數）                                            */

  /*
   * 跟 uiia-cat 同一個服務、同一個 namespace，key 另開一個。
   * 只能加不能減，跟這個用途完美契合。
   *
   * 這是**匿名的總量計數**，跟一般的瀏覽人次計數器同一種東西：
   * 沒有 ID、沒有 IP、沒有任何可以指認個人的資料，端點本來就是公開的。
   *
   * 訪客摸摸照樣送 /hit（所以記得到），但畫面上不顯示任何數字，
   * 所以他不會意識到自己被記錄。/get 只有主人模式才打——訪客不顯示，抓了也沒用。
   *
   * **硬規則：這是 cat-room 唯一的對外連線，它掛掉不能影響遊戲。**
   * 抓不到就不顯示那一段，貓照常跑，整頁離線也要能玩。
   */
  const COUNTER_URL = "https://abacus.jasoncameron.dev";
  const COUNTER_NS = "dipo221-github-io";

  /*
   * 每天一把 key。
   *
   * Abacus 的計數器只能加、不能歸零，所以「今天被摸過幾次」不是靠重置做的——
   * 過了台北的午夜就換一把 key，新的那把自然從 0 開始，舊的留在那裡不管它。
   *
   * 還沒有人摸過的那把 key 是不存在的，/get 會回 404。
   * 底下把非 2xx 一律當成 0，所以那不是錯誤，就是「今天還沒被摸過」。
   */
  function petsKey() {
    /*
     * 前綴用 touch 而不是 pets，是為了跟開發時測出來的髒資料切開——
     * Abacus 不能減也不能刪，cat-room-pets-* 那幾把被驗證用的點擊灌過，
     * 沿用的話上線第一天會看到不是真的數字。
     */
    return "cat-room-touch-" + World.taipeiDate();
  }

  const pets = { confirmed: null, pending: 0, day: null };

  function acceptCount(value) {
    if (typeof value !== "number") return;
    /*
     * 只增不減，才不會被亂序回來的回應往回拉。
     * 換日時一定要先把 confirmed 清成 null（見 syncPetsDay）——
     * 否則數字從昨天的 7 掉到今天的 0，會被這個 Math.max 擋住，
     * 畫面就一直停在 7。
     */
    pets.confirmed = pets.confirmed === null ? value : Math.max(pets.confirmed, value);
  }

  function loadCount() {
    if (!isOwner) return;
    const key = pets.day;
    fetch(COUNTER_URL + "/get/" + COUNTER_NS + "/" + key)
      .then((res) => (res.ok ? res.json() : { value: 0 }))
      .then((data) => {
        if (pets.day !== key) return; // 等回應的期間換日了，這筆是昨天的
        acceptCount(data.value);
        renderMeta();
      })
      .catch(() => {
        // 服務掛了就是不顯示那一段，其他照舊
      });
  }

  /*
   * 換日。每分鐘跟著 syncLight 檢查一次，
   * 所以分頁掛整晚跨過台北午夜時，數字會自己歸零重算。
   */
  function syncPetsDay() {
    const key = petsKey();
    if (pets.day === key) return;

    pets.day = key;
    pets.confirmed = null;
    pets.pending = 0;
    loadCount();
    renderMeta();
  }

  // 摸摸會被連點，一秒內只算一次，免得誤觸把數字灌上去
  let lastHitAt = 0;

  function countPet() {
    const t = Date.now();
    if (t - lastHitAt < 1000) return;
    lastHitAt = t;

    syncPetsDay(); // 剛好在午夜按下去的話，先換到今天那把
    const key = pets.day;

    pets.pending += 1;
    renderMeta();

    fetch(COUNTER_URL + "/hit/" + COUNTER_NS + "/" + key)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && pets.day === key) acceptCount(data.value);
      })
      .catch(() => {
        // 這一下沒記到就算了，不要跳錯誤打斷使用者
      })
      .finally(() => {
        if (pets.day !== key) return; // 換日了，pending 已經被歸零，不要再減
        pets.pending = Math.max(0, pets.pending - 1);
        renderMeta();
      });
  }

  /* ---------------------------------------------------------------- */

  /*
   * 小標＝牠住多久了。
   *
   * 這句講的是 Disi，不是你跟牠的關係，所以算自固定日期而不是存檔——
   * 所有人看到同一個數字，而且清掉 localStorage 牠也不會突然變回剛搬來。
   *
   * 不重複寫名字：正上方的 h1 就是「Disi」，再寫一次會變成
   * 「Disi ／ Disi 已經在這邊生活了…」。主詞由標題提供就夠了。
   */
  function renderTagline() {
    const el = document.getElementById("tagline");
    if (!el) return;
    const days = World.daysHere(Date.now());
    el.textContent = days < 1 ? "今天剛搬進來" : "已經在這邊生活了 " + days + " 天";
  }

  function renderMeta() {
    if (!metaEl) return;

    // 剩下的都是關係層與共用計數，只有主人看得到
    const parts = [];
    if (isOwner) {
      if (pets.confirmed !== null) {
        const n = pets.confirmed + pets.pending;
        // 0 次講「還沒被摸過」，不要寫成「今天被摸過 0 次」那麼像報表
        parts.push(n === 0 ? "今天還沒被摸過" : "今天被摸過 " + n.toLocaleString() + " 次");
      }
      if (state.gifts.length) parts.push("收到 " + state.gifts.length + " 件禮物");
    }

    metaEl.textContent = parts.join("　·　");
    // 訪客這一行是空的。留著會空出 min-height 那段高度，直接收掉
    metaEl.hidden = parts.length === 0;
  }

  /*
   * 同一種禮物收到很多次就併成一行加數量，不要列出十片一模一樣的葉子。
   * 這排是這個遊戲唯一看得見的累積——沒有分數、沒有等級、沒有進度條。
   */
  function renderGifts() {
    const giftsEl = document.getElementById("gifts");
    if (!giftsEl) return;

    // 禮物是關係層的東西，訪客看不到
    if (!isOwner) {
      giftsEl.textContent = "";
      return;
    }

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
    renderTagline();
    renderMeta();
    renderGifts();
  }

  renderProgress();
  syncPetsDay(); // 決定今天那把 key，順便把數字抓回來

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
    // 分頁掛整晚的話，這兩個都要跟著在台北的午夜換過去
    renderTagline();
    syncPetsDay();
  }
  syncLight();
  setInterval(syncLight, 60 * 1000);

  /* ---------------------------------------------------------------- */
  /* 貓                                                                */

  /*
   * 行為的亂數用「時間切片」當種子，不是 Math.random——
   * 同一個 3 分鐘切片裡進來的人，起手會看到 Disi 在做同一件事，
   * 這樣「大家看到的都是一樣的畫面」才算數。
   *
   * 進來之後兩邊的狀態機各自跑、抽到的長度不同就會慢慢分岔，
   * 所以這是**近似不是保證同步**。要逐格一致得在切片內重播狀態機，
   * 那個複雜度換來的差別很小，刻意不做。
   */
  const rand = World.rng(World.behaviourSlot(now));

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

  /*
   * 訪客沒有關係層的訊息，但也不該只看到一片空白——
   * 補一句牠現在在幹嘛。要等 enter() 決定好開場狀態才知道要寫什麼，
   * 所以放在這裡而不是上面跟其他文案一起。
   */
  if (!loaded.isNew && !scene.message) {
    showNote(describeDoing());
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
    // 訪客也照樣送出去，他只是看不到數字
    countPet();
    showNote(
      cat.state === "sleep"
        ? catName + " 沒睜眼，但呼嚕聲變大了。"
        : catName + " 瞇起眼睛，往你的手靠過去。"
    );
    Save.save(state);
    renderProgress();
  }

  function feed() {
    if (!Cat.accepts(cat.state, "feed")) {
      showNote(catName + " 睡得很熟，等一下再說吧。");
      return;
    }
    state.fed.count += 1;
    state.fed.lastAt = Date.now();
    grantBond(1);
    bowlEl.classList.add("is-full");
    goThenDo(0.68, "eat", performance.now()); // 碗在 74%，走過去再吃
    showNote(catName + " 聽到碗的聲音就過來了。");
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
    const back = World.returnScene(away, World.seedFrom(state.lastSeen), {
      name: catName,
      owner: isOwner
    });
    if (back.tier !== "none") {
      state.cat.bond += back.bondDelta;
      if (back.gift) state.gifts.push({ id: back.gift.id, at: Date.now() });
      // 訪客拿不到關係層的話，改講牠現在在幹嘛
      showNote(back.message || describeDoing());
      renderProgress();
    }
    markSeen();
    syncLight();
  });

  // pagehide 在手機上比 beforeunload 可靠
  window.addEventListener("pagehide", markSeen);
})();
