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
   * 不重複寫名字：左邊那塊木牌就是「Disi」，再寫一次會變成
   * 「Disi ／ Disi 已經在這邊生活了…」。主詞由標題提供就夠了。
   *
   * **句子縮短過**（2026-09-03）。原本是「已經在這邊生活了 N 天」，
   * 那時候它自己佔一整行；現在它跟木牌擠在介面條的同一列，
   * 而 22px 的點陣中文一個字就是 22px 寬，那句會把木牌擠出畫面。
   * 這不是文案偏好，是**版面的硬限制**——見 style.css 的 .hud-days。
   */
  function renderTagline() {
    const el = document.getElementById("tagline");
    if (!el) return;
    const days = World.daysHere(Date.now());
    el.textContent = days < 1 ? "剛搬來" : "住了 " + days + " 天";
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

  /*
   * 座標。兩個都是「佔房間寬／高的比例」，但指的位置不一樣：
   *
   *   x 是貓的**中心**   y 是貓的**腳**
   *
   * 這樣定是為了對得上磚格。碗在第 16 欄，牠的中心就是 16.5/20——
   * 直接算得出來，不用再加減半隻貓的寬度。腳同理：貓站在地板上，
   * 決定牠站在哪一列的是腳不是頭。art/room.py 的 CAT_AT 用同一套定義，
   * 所以校對圖上量到的位置跟這裡的數字是同一個東西。
   *
   * 舊版的 x 是**左緣**、y 根本不存在（CSS 寫死 bottom: 24%）。
   * 換過來的原因是房間變成滿版之後貓只佔一小格，
   * 左緣那套的「上限 0.78」之類的數字全部要重算，而且怎麼算都不好記。
   */

  /*
   * 貓能走到的前後界。
   *
   * 這兩個數字以前是**照著磚號表用眼睛量出來的**（0.62 / 0.96），
   * 房間一改就默默錯掉：不會報錯，只會變成貓的頭戳進牆裡。
   * 現在改成讀 room-data.js，那支是 art/pixel.py 從磚號表直接產的，
   * 所以資料只有一份。舊的兩個數字留在 fallback 裡當「room-data.js 沒載到」
   * 的保險——那時候貓還是會走，只是走在上一版房間的範圍裡。
   */
  const RD = window.RoomData || null;
  const FLOOR = {
    back: RD ? RD.floorTop : 0.62,
    front: RD ? RD.floorBottom : 0.96
  };

  /*
   * 房間與貓的**來源像素**。畫面上的位置全部是「來源像素的比例 x 現在多大」，
   * 所以視窗怎麼縮都不用重算，也不用去量 DOM。
   *
   * CAT_SRC 從 sprites.js 的 manifest 來，不是自己寫一個 16。
   * 那份 manifest 本來就是「換素材只動這一支」的那一層，
   * M2 把貓重畫成 24x24 的時候這支跟 style.css 都不用碰。
   */
  const COLS = RD ? RD.cols : 20;
  const ROWS = RD ? RD.rows : 11;
  const ROOM_W = COLS * (RD ? RD.tile : 16);
  const ROOM_H = ROWS * (RD ? RD.tile : 16);
  const CAT_SRC = Sprites.manifest.frameW;
  // CSS 也要知道貓多大。從這裡推過去，兩邊就不可能講不同的數字
  room.style.setProperty("--cat-src", String(CAT_SRC));

  /*
   * 餵食要走到哪裡。三個數字全部從碗那一格算出來：
   *
   *   BOWL_AT   碗的中心，貓抵達之後轉頭看的方向
   *   BOWL_X    貓站的地方——碗**旁邊**左一格，不是碗上面
   *   BOWL_Y    貓的腳。碗的影子畫在牠那格的最底下，所以那格的下緣就是碗的落地點，
   *             貓的腳踩在同一條線上才會看起來站在一起
   *
   * 以前這裡是三個手打的小數（0.781 / 0.93 / 0.844）。它們是照著上一版的
   * 磚號表量的，房間一改就全錯，而且錯的樣子是「貓對著空地低頭吃」——
   * 看得出來怪，但看不出來是這三個數字。
   */
  const BOWL = (RD && RD.objects.bowl) || [16, 9, 1, 1];
  const BOWL_AT = (BOWL[0] + BOWL[2] / 2) / COLS;
  const BOWL_X = (BOWL[0] - 0.5) / COLS;
  const BOWL_Y = (BOWL[1] + BOWL[3]) / ROWS;

  const cat = {
    state: "sit",
    startedAt: performance.now(),
    duration: 4000,
    x: 0.5,
    targetX: 0.5,
    y: 0.80,
    targetY: 0.80,
    facing: 1,
    faceAt: null   // 抵達之後要轉向哪裡（goThenDo 用）
  };

  const bleed = document.getElementById("room-bleed");
  let roomW = room.clientWidth;
  let roomH = room.clientHeight;
  window.addEventListener("resize", function () {
    roomW = room.clientWidth;
    roomH = room.clientHeight;
  });

  function enter(next, at) {
    // 吃完就把碗收掉。放在這裡是因為 eat 結束的路徑只有這一條
    if (cat.state === "eat" && next !== "eat") bowlEl.classList.remove("is-full");

    cat.state = next;
    cat.startedAt = at;
    cat.duration = Cat.durationFor(next, rand);
    cat.pending = null;
    cat.faceAt = null;

    /*
     * x 是中心，貓寬 1/16，所以理論上限是 15.5/16 = 0.969。
     * 抓 0.06~0.94 留一點邊，貓才不會整隻貼在牆角上。
     */
    if (next === "approach") {
      // 走到房間正中間、而且走到最前面來——「迎上來」要靠這兩件事一起
      cat.targetX = 0.5;
      cat.targetY = FLOOR.front;
    } else if (Cat.moves(next)) {
      cat.targetX = 0.06 + rand() * 0.88;
      cat.targetY = FLOOR.back + rand() * (FLOOR.front - FLOOR.back);
    }

    catEl.setAttribute("data-anim", next);
  }

  /*
   * 先走過去，到了再做那件事。
   *
   * 餵食如果直接切成 eat，貓會站在原地對著空氣吃——碗在房間另一頭。
   * 所以先派牠走過去，抵達之後才進入真正的動作。
   */
  function goThenDo(targetX, targetY, then, at, faceAt) {
    enter("walk", at);
    cat.targetX = targetX;
    cat.targetY = targetY;
    cat.pending = then;
    cat.faceAt = typeof faceAt === "number" ? faceAt : null;
    cat.duration = 8000;
  }

  /* ---------------------------------------------------------------- */
  /* 視角                                                              */

  /*
   * 房間比視窗寬的時候要有一個「鏡頭」跟著貓，不然牠走到房間另一頭就等於
   * 消失了，畫面剩一片空牆。
   *
   * **桌機從滿版那一版起也會走到這裡**（待辦第 15 項）。以前桌機整間放得下、
   * scrollWidth 等於 clientWidth，底下第一行就直接返回；現在房間吃滿高度，
   * 20/11 比螢幕扁，左右一定會溢出。這支不用改一個字——它問的一直是
   * 「有沒有溢出」而不是「是不是手機」，那個判斷從一開始就寫對了。
   *
   * 兩件事要顧：
   *
   *   1. 使用者自己滑去看房間別的地方時要讓開，不能跟他搶。
   *      分辨方法是記住自己捲到哪（camAt），對不上就是人捲的。
   *   2. 不要黏死在貓身上。中間留一段死區，貓在畫面中央附近晃的時候鏡頭不動——
   *      鏡頭每一幀都跟著微調的話，看起來會像房間在抖而不是貓在走。
   */
  const CAM_YIELD = 4000;   // 使用者自己滑過之後，鏡頭讓開多久
  let camAt = 0;
  let camUserAt = -CAM_YIELD;

  /*
   * 被摸的時候會慢眨到這個時間為止。0 表示現在沒有在慢眨。
   *
   * 貓對人**慢慢地**眨一次眼是示好，不是普通的眨眼——差別完全在長度，
   * 所以這裡存的是一個截止時間而不是一個旗標。600ms 跟 react() 那個
   * is-purring 的 600ms 是同一個數字：呼嚕跟瞇眼是同一個反應的兩半，
   * 一起開始一起結束。改一個就要改另一個。
   *
   * 另外，pet() 的文案本來就寫著「瞇起眼睛，往你的手靠過去」——
   * 那句話從 16x16 的時候就在了，只是美術一直沒做到。這裡是把它補上。
   */
  const SLOW_BLINK_MS = 600;
  let slowBlinkUntil = 0;

  if (bleed) {
    bleed.addEventListener("scroll", function () {
      // 誤差 2px 是給瀏覽器的次像素捲動留的，不是人滑的
      if (Math.abs(bleed.scrollLeft - camAt) > 2) camUserAt = performance.now();
    });
  }

  function follow() {
    if (!bleed) return;
    const slack = bleed.scrollWidth - bleed.clientWidth;
    if (slack <= 0) return; // 整間看得完，沒有鏡頭這回事
    if (performance.now() - camUserAt < CAM_YIELD) return;

    const view = bleed.clientWidth;
    const want = Math.max(0, Math.min(slack, cat.x * roomW - view / 2));
    const gap = want - bleed.scrollLeft;
    // 死區：貓離畫面中心不到八分之一個視窗寬就不動鏡頭
    if (Math.abs(gap) < view / 8) return;

    camAt = bleed.scrollLeft + gap * 0.05;
    bleed.scrollLeft = camAt;
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
        /*
         * 抵達之後把面向轉向目的地。
         *
         * facing 只在移動中更新，所以從碗**右邊**走過來的那幾次，
         * 停下來時面向還停在「往左」，接著就變成背對著碗低頭吃地板。
         * 大約十幾次遇到一次，以前 eat 假裝成 idle 看不出來，
         * 畫了真的低頭姿勢之後就露餡了。
         */
        if (cat.faceAt !== null) cat.facing = cat.faceAt > cat.x ? 1 : -1;
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
      /*
       * 前後走。速度比左右慢一半，因為地板的縱深（4 列）比寬度（20 欄）短得多——
       * 同樣的速度會讓牠看起來一直在往前衝。
       * facing 不跟著 y 動：往前往後在側面圖上不該翻身。
       */
      const dy = cat.targetY - cat.y;
      if (Math.abs(dy) > 0.005) {
        cat.y += Math.sign(dy) * Math.min(Math.abs(dy), speed * 0.5);
      }
    }

    render(t);
    follow();
    requestAnimationFrame(step);
  }

  function render(t) {
    /*
     * x 是中心、y 是腳，所以往回推半隻貓的寬、整隻貓的高，才是左上角。
     *
     * 貓多大是算的不是寫死的：上一版寫 roomW/32 與 roomH/7，成立的前提是
     * 「一格貓正好等於一塊磚」。20x11 之後貓橫跨一格半，那兩個數字就錯了，
     * 而且錯的方式很難查——貓會偏半格，看起來像動畫沒對準。
     * 分母跟 style.css 的 .cat 是同一條算式，兩邊都從 manifest 的格寬來。
     */
    const px = cat.x * roomW - (roomW * CAT_SRC / ROOM_W) / 2;
    const py = cat.y * roomH - roomH * CAT_SRC / ROOM_H;
    /*
     * cat.facing 是「往哪邊移動」：1 是往右。
     * 但圖裡的貓本來就朝左，所以往右走才要翻面——facesLeft 決定正負，
     * 換一包朝右的素材時只要改 sprites.js 那個旗標。
     */
    const flip = Sprites.manifest.facesLeft ? -cat.facing : cat.facing;
    catEl.style.transform =
      "translate3d(" + px.toFixed(1) + "px, " + py.toFixed(1) + "px, 0) " +
      "scaleX(" + flip + ")";

    if (Sprites.ready()) {
      const m = Sprites.manifest;
      const f = Sprites.frameFor(cat.state, t - cat.startedAt);
      /*
       * 眨眼：sheet 右半邊是同樣的姿勢、眼睛閉著，所以「眨」就是把欄號
       * 往右加 openCols。姿勢那邊一行都不用動——這是把眨眼做成多三欄
       * 而不是多一排的整個理由。
       *
       * 兩個來源相或：平常的節拍，加上被摸之後那段慢眨。
       * 兩者都吃絕對時間 t，跟 cat.startedAt 無關，換動作不會打斷眨到一半。
       *
       * 睡著的時候這裡照樣會切欄，但 sleep 那三格的閉眼版跟睜眼版
       * 位元相同（眼睛本來就閉著），所以是個看不見的無操作。
       * 不為牠寫特例是刻意的：少一條要跟美術同步的規則。
       */
      const shut = t < slowBlinkUntil || Sprites.blinkAt(t);
      const col = f.col + (shut ? m.openCols : 0);
      // 見 style.css：百分比的 background-position 要除以「格數 - 1」
      const fx = m.cols > 1 ? (col / (m.cols - 1)) * 100 : 0;
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
    cat.y = FLOOR.back;
    enter("approach", performance.now());
  } else {
    enter(World.energy(new Date()) < 0.3 ? "sleep" : "sit", performance.now());
  }

  /*
   * 鏡頭起手要用**跳**的，不能用 follow() 那個漸進的——
   * 手機上一進來就看到房間從最左邊慢慢滑到貓身上，
   * 那是一個沒有人要求的開場動畫，而且會蓋掉「牠已經在那裡」的感覺。
   */
  if (bleed) {
    const slack0 = bleed.scrollWidth - bleed.clientWidth;
    if (slack0 > 0) {
      camAt = Math.max(0, Math.min(slack0, cat.x * roomW - bleed.clientWidth / 2));
      bleed.scrollLeft = camAt;
    }
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
    // 慢眨。睡著的時候這行照樣跑，但 sleep 的眼睛已經閉著，畫面上不會有事
    slowBlinkUntil = performance.now() + SLOW_BLINK_MS;
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
    // 三個座標都是從 room-data.js 的碗算出來的，見上面 BOWL_* 那段
    goThenDo(BOWL_X, BOWL_Y, "eat", performance.now(), BOWL_AT);
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

  /*
   * 可以點的不是按鈕列，是房間裡的東西（待辦第 5 項）。
   *
   * `.actions` 那三顆整排刪掉了。摸點貓、餵點碗、玩點逗貓棒——
   * 去找東西比按按鈕更像在跟一個房間相處，而且滿版之後版面上
   * 本來也沒有地方擺一排鈕了。
   *
   * **座標一格都不手抄。** room-data.js 是 art/pixel.py 從磚號表直接產的，
   * 所以「碗在哪一格」只有一個答案；以後每加一件家具，它的可點區塊
   * 自動就有座標。手抄的那一版錯起來是安靜的：按鈕還在、點下去有反應，
   * 只是熱區跟畫面上的東西差了一格。
   */
  function hotspot(name, label, fn) {
    const box = RD && RD.objects && RD.objects[name];
    // 房間裡沒這個東西就不要生一顆點得到卻看不見的按鈕
    if (!box) return;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "hotspot";
    // 東西是畫在 room-pano.png 裡的，不是元素，所以熱區是蓋上去的一塊
    b.setAttribute("aria-label", label);
    b.style.left = (box[0] / COLS * 100) + "%";
    b.style.top = (box[1] / ROWS * 100) + "%";
    b.style.width = (box[2] / COLS * 100) + "%";
    b.style.height = (box[3] / ROWS * 100) + "%";
    b.addEventListener("click", fn);
    room.appendChild(b);
  }

  hotspot("bowl", "餵食", feed);
  hotspot("wand", "拿逗貓棒逗牠", wand);

  /*
   * 貓本人。牠在 HTML 裡已經是 <button> 了——牠會動，熱區沒辦法用
   * 固定的百分比蓋上去，只能是牠自己。
   */
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
