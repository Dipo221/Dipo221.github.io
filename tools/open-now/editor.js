/*
 * 編輯功能：新增／刪除／修改店家，直接存回 GitHub。
 *
 * 設計前提是「這個網站是公開的，但只有站長能編輯」：
 *   - 編輯介面只在網址帶 #edit、或這台裝置存過 token 時才出現，一般訪客看不到。
 *   - 憑證（GitHub token、Google 金鑰）只存在瀏覽器的 localStorage，
 *     不會進 repo、不會出現在網址、也不會被 commit 出去。
 *     所以 Google 金鑰其實從來沒有公開過，只有你自己的瀏覽器有。
 *
 * 存檔是直接對 GitHub 的 contents API 打，實測 api.github.com 有回
 * Access-Control-Allow-Origin: *，所以純前端就能寫檔，不需要後端。
 */

(function () {
  "use strict";

  const REPO = {
    owner: "Dipo221",
    repo: "Dipo221.github.io",
    path: "tools/open-now/places.json",
    branch: "main",
  };

  // 搜尋店家時偏向這一帶，才不會打「星巴克」跑出台北車站那家
  const SEARCH_CENTER = { lat: 25.1677, lng: 121.4406 }; // 淡水老街
  const SEARCH_RADIUS = 6000;

  const TOKEN_KEY = "open-now:github-token";
  const GOOGLE_KEY = "open-now:google-key";

  const getToken = () => localStorage.getItem(TOKEN_KEY) || "";
  const getGoogleKey = () => localStorage.getItem(GOOGLE_KEY) || "";

  // 沒帶 #edit 又沒存過 token 的話，這支就整個不做事
  const editMode = location.hash === "#edit" || !!getToken();
  if (!editMode) return;

  let fileSha = null; // GitHub 上這個檔案目前的版本，更新時必須帶
  let loadedText = null; // 載進來時的原始內容，存檔前用來偵測衝突
  let editingIndex = null; // 正在編哪一筆，null 代表新增

  /* ---------- 小工具 ---------- */

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text; // 一律用 textContent，不要讓店名有機會變成 HTML
    return node;
  }

  // base64 的編解碼在 codec.js，那支有測試涵蓋（中文很容易在這裡壞掉）
  const encodeBase64 = Codec.encodeBase64;
  const decodeBase64 = Codec.decodeBase64;

  function serialize(data) {
    return JSON.stringify(data, null, 2) + "\n";
  }

  /* ---------- 狀態列 ---------- */

  const statusBar = el("div", "editor-status");

  let statusTimer = null;
  function setStatus(text, kind) {
    clearTimeout(statusTimer);
    statusBar.textContent = text || "";
    statusBar.className = "editor-status" + (kind ? " is-" + kind : "");
    if (kind === "ok") {
      statusTimer = setTimeout(() => {
        statusBar.textContent = "";
        statusBar.className = "editor-status";
      }, 6000);
    }
  }

  /* ---------- GitHub ---------- */

  function githubUrl() {
    return (
      "https://api.github.com/repos/" +
      REPO.owner +
      "/" +
      REPO.repo +
      "/contents/" +
      REPO.path
    );
  }

  function githubHeaders() {
    return {
      Authorization: "Bearer " + getToken(),
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  function describeGithubError(res) {
    if (res.status === 401) return "token 無效或過期了";
    if (res.status === 403) return "token 權限不足（需要這個 repo 的 Contents 讀寫）";
    if (res.status === 404) return "找不到檔案或 repo（也可能是 token 沒開這個 repo）";
    if (res.status === 409) return "版本衝突，請重新整理後再改一次";
    return "GitHub 回了 " + res.status;
  }

  // 從 GitHub 讀權威版本。GitHub Pages 建置有延遲，剛存完再重新整理，
  // 靜態檔可能還是舊的；編輯時一律以 API 讀到的為準。
  function loadFromGithub() {
    if (!getToken()) return Promise.resolve(false);

    return fetch(githubUrl() + "?ref=" + encodeURIComponent(REPO.branch), {
      headers: githubHeaders(),
      cache: "no-store",
    })
      .then((res) => {
        if (!res.ok) throw new Error(describeGithubError(res));
        return res.json();
      })
      .then((payload) => {
        fileSha = payload.sha;
        loadedText = decodeBase64(payload.content);
        window.OpenNow.applyData(JSON.parse(loadedText));
        return true;
      })
      .catch((err) => {
        setStatus("讀取 GitHub 失敗：" + err.message + "（畫面上是靜態檔的內容）", "warn");
        return false;
      });
  }

  function saveToGithub(message) {
    const token = getToken();
    if (!token) {
      setStatus("還沒設定 GitHub token，改動只留在畫面上", "warn");
      return Promise.resolve(false);
    }

    setStatus("儲存中⋯");

    // 存之前先看一眼遠端有沒有被別的裝置改過。有的話寧可停下來問，
    // 也不要默默把手機上剛加的店蓋掉。
    return fetch(githubUrl() + "?ref=" + encodeURIComponent(REPO.branch), {
      headers: githubHeaders(),
      cache: "no-store",
    })
      .then((res) => {
        if (!res.ok) throw new Error(describeGithubError(res));
        return res.json();
      })
      .then((remote) => {
        const remoteText = decodeBase64(remote.content);
        if (loadedText !== null && remoteText !== loadedText) {
          throw new Error(
            "GitHub 上的內容跟你打開頁面時不一樣了（可能是在另一台裝置改過）。請重新整理再改一次，避免蓋掉那邊的修改"
          );
        }

        const text = serialize(window.OpenNow.data);
        return fetch(githubUrl(), {
          method: "PUT",
          headers: Object.assign({ "Content-Type": "application/json" }, githubHeaders()),
          body: JSON.stringify({
            message: message,
            content: encodeBase64(text),
            sha: remote.sha,
            branch: REPO.branch,
          }),
        }).then((res) => {
          if (!res.ok) throw new Error(describeGithubError(res));
          return res.json().then((result) => {
            fileSha = result.content.sha;
            loadedText = text;
            setStatus("已存到 GitHub，網站大約 30 秒後更新", "ok");
            return true;
          });
        });
      })
      .catch((err) => {
        setStatus("存檔失敗：" + err.message, "error");
        return false;
      });
  }

  /* ---------- Google Places ---------- */

  let mapsLoading = null;

  function loadGoogleMaps() {
    const key = getGoogleKey();
    if (!key) return Promise.reject(new Error("還沒設定 Google 金鑰"));
    if (window.google && window.google.maps && window.google.maps.importLibrary) {
      return Promise.resolve();
    }
    if (mapsLoading) return mapsLoading;

    mapsLoading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src =
        "https://maps.googleapis.com/maps/api/js?key=" +
        encodeURIComponent(key) +
        "&libraries=places&v=weekly&loading=async&language=zh-TW&region=TW" +
        "&callback=__openNowMapsReady";
      script.async = true;
      window.__openNowMapsReady = () => resolve();
      script.onerror = () => reject(new Error("Google Maps 載入失敗，檢查金鑰是否正確"));
      document.head.appendChild(script);
    });

    return mapsLoading;
  }

  // 完整的 Google Maps 網址裡有店名，可以直接抽出來代打。
  // 但手機「分享」給的是 maps.app.goo.gl 短網址，那個沒有 CORS，前端展不開。
  function nameFromMapsUrl(text) {
    const match = text.match(/\/maps\/place\/([^/@?]+)/);
    if (!match) return null;
    try {
      return decodeURIComponent(match[1].replace(/\+/g, " "));
    } catch (err) {
      return null;
    }
  }

  function isShortMapsUrl(text) {
    return /(maps\.app\.goo\.gl|goo\.gl\/maps)/.test(text);
  }

  function searchPlaces(query) {
    return loadGoogleMaps()
      .then(() => google.maps.importLibrary("places"))
      .then(({ Place }) =>
        Place.searchByText({
          textQuery: query,
          fields: ["displayName", "formattedAddress", "regularOpeningHours", "id"],
          locationBias: { center: SEARCH_CENTER, radius: SEARCH_RADIUS },
          maxResultCount: 6,
          language: "zh-TW",
          region: "TW",
        })
      )
      .then((result) => result.places || []);
  }

  /* ---------- 表單 ---------- */

  const dialog = el("dialog", "editor-dialog");

  const form = el("form", "editor-form");
  form.method = "dialog";

  const formTitle = el("h3", null, "新增店家");
  form.appendChild(formTitle);

  function field(labelText, hintText) {
    const wrap = el("label", "field");
    wrap.appendChild(el("span", "field-label", labelText));
    const input = el("input");
    input.type = "text";
    wrap.appendChild(input);
    if (hintText) wrap.appendChild(el("span", "field-hint", hintText));
    return { wrap: wrap, input: input };
  }

  // 搜尋列
  const searchRow = el("div", "field");
  searchRow.appendChild(el("span", "field-label", "從 Google 帶入"));
  const searchLine = el("div", "search-line");
  const searchInput = el("input");
  searchInput.type = "text";
  searchInput.placeholder = "打店名，或貼 Google Maps 網址";
  const searchButton = el("button", "btn", "搜尋");
  searchButton.type = "button";
  searchLine.appendChild(searchInput);
  searchLine.appendChild(searchButton);
  searchRow.appendChild(searchLine);
  const searchHint = el("span", "field-hint", "");
  searchRow.appendChild(searchHint);
  const results = el("div", "search-results");
  searchRow.appendChild(results);
  form.appendChild(searchRow);

  const nameField = field("店名");
  const hoursField = field("營業時間");
  const hoursCheck = el("span", "field-check");
  hoursField.wrap.appendChild(hoursCheck);
  const tagsField = field("標籤", "用逗號分開，例如：宵夜, 麵食");
  const noteField = field("備註", "選填，會顯示在店名下面");

  form.appendChild(nameField.wrap);
  form.appendChild(hoursField.wrap);
  form.appendChild(tagsField.wrap);
  form.appendChild(noteField.wrap);

  const actions = el("div", "editor-actions");
  const cancelButton = el("button", "btn", "取消");
  cancelButton.type = "button";
  const saveButton = el("button", "btn btn-primary", "儲存");
  saveButton.type = "button";
  actions.appendChild(cancelButton);
  actions.appendChild(saveButton);
  form.appendChild(actions);

  dialog.appendChild(form);
  document.body.appendChild(dialog);

  /* 邊打邊驗證營業時間，不要等到存下去才發現寫錯 */
  function validateHours() {
    const text = hoursField.input.value.trim();
    if (!text) {
      hoursCheck.textContent = "";
      hoursCheck.className = "field-check";
      return false;
    }

    const parsed = Hours.parse(text);
    if (!parsed.ok) {
      hoursCheck.textContent = "✗ " + parsed.error;
      hoursCheck.className = "field-check is-bad";
      return false;
    }

    // 直接告訴他「現在算起來是開還是關」，比覆述規則更容易看出寫錯
    const status = Hours.statusAt(parsed, Hours.taipeiNow());
    hoursCheck.textContent =
      "✓ 看得懂，現在算起來是「" + (status.open ? "營業中" : "已打烊") + "」";
    hoursCheck.className = "field-check is-good";
    return true;
  }

  hoursField.input.addEventListener("input", validateHours);

  /* 搜尋 */

  function renderResults(places) {
    results.innerHTML = "";

    if (!places.length) {
      results.appendChild(el("p", "field-hint", "找不到，換個關鍵字試試"));
      return;
    }

    for (const place of places) {
      const item = el("button", "result");
      item.type = "button";

      const displayName =
        (place.displayName && place.displayName.text) || place.displayName || "(無名)";
      const hours = Hours.fromGoogle(place.regularOpeningHours);

      item.appendChild(el("span", "result-name", displayName));
      item.appendChild(el("span", "result-address", place.formattedAddress || ""));
      item.appendChild(
        el("span", "result-hours", hours ? hours : "Google 上沒有營業時間，要自己填")
      );

      item.addEventListener("click", () => {
        nameField.input.value = displayName;
        if (hours) hoursField.input.value = hours;
        validateHours();
        results.innerHTML = "";
        searchHint.textContent = hours
          ? "帶入了，存之前確認一下時間對不對"
          : "Google 沒有這家店的營業時間，請手動填";
      });

      results.appendChild(item);
    }
  }

  function runSearch() {
    const raw = searchInput.value.trim();
    if (!raw) return;

    if (isShortMapsUrl(raw)) {
      searchHint.textContent =
        "短網址（maps.app.goo.gl）沒辦法從瀏覽器展開，請改貼店名，或用電腦版 Google Maps 的完整網址";
      return;
    }

    const query = nameFromMapsUrl(raw) || raw;
    searchHint.textContent = "搜尋「" + query + "」⋯";
    results.innerHTML = "";

    searchPlaces(query)
      .then((places) => {
        searchHint.textContent = "";
        renderResults(places);
      })
      .catch((err) => {
        searchHint.textContent = err.message + "（也可以直接手動填下面的欄位）";
      });
  }

  searchButton.addEventListener("click", runSearch);
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      runSearch();
    }
  });

  /* 開關表單 */

  function openForm(index) {
    editingIndex = index == null ? null : index;
    const place = editingIndex == null ? null : window.OpenNow.data.places[editingIndex];

    formTitle.textContent = place ? "編輯店家" : "新增店家";
    searchInput.value = "";
    searchHint.textContent = "";
    results.innerHTML = "";

    nameField.input.value = place ? place.name : "";
    hoursField.input.value = place ? place.hours : "";
    tagsField.input.value = place && place.tags ? place.tags.join(", ") : "";
    noteField.input.value = (place && place.note) || "";

    validateHours();
    dialog.showModal();
    (place ? hoursField.input : searchInput).focus();
  }

  cancelButton.addEventListener("click", () => dialog.close());

  saveButton.addEventListener("click", () => {
    const name = nameField.input.value.trim();
    const hours = hoursField.input.value.trim();

    if (!name) {
      setStatus("店名不能空白", "error");
      return;
    }
    if (!validateHours()) {
      hoursField.input.focus();
      return;
    }

    const place = { name: name, hours: hours };
    const tags = tagsField.input.value
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (tags.length) place.tags = tags;
    const note = noteField.input.value.trim();
    if (note) place.note = note;

    const places = window.OpenNow.data.places;
    if (editingIndex == null) {
      places.push(place);
    } else {
      places[editingIndex] = place;
    }

    dialog.close();
    window.OpenNow.applyData(window.OpenNow.data); // 先更新畫面，不等 GitHub
    saveToGithub((editingIndex == null ? "Add " : "Update ") + name + " to open-now list");
  });

  /* ---------- 掛到卡片上 ---------- */

  window.OpenNowEditor = {
    decorateCard: function (wrap, entry, index) {
      const tools = el("div", "card-tools");

      const edit = el("button", "icon-btn", "編輯");
      edit.type = "button";
      edit.title = "編輯 " + entry.place.name;
      edit.addEventListener("click", () => openForm(index));

      const remove = el("button", "icon-btn is-danger", "刪除");
      remove.type = "button";
      remove.title = "刪除 " + entry.place.name;
      remove.addEventListener("click", () => {
        if (!confirm("確定要刪掉「" + entry.place.name + "」嗎？")) return;
        window.OpenNow.data.places.splice(index, 1);
        window.OpenNow.applyData(window.OpenNow.data);
        saveToGithub("Remove " + entry.place.name + " from open-now list");
      });

      tools.appendChild(edit);
      tools.appendChild(remove);
      wrap.appendChild(tools);
    },
  };

  /* ---------- 設定面板 ---------- */

  const settings = el("dialog", "editor-dialog");
  const settingsForm = el("form", "editor-form");
  settingsForm.method = "dialog";
  settingsForm.appendChild(el("h3", null, "設定"));

  function secretField(labelText, hintText, linkText, linkHref) {
    const wrap = el("label", "field");
    wrap.appendChild(el("span", "field-label", labelText));
    const input = el("input");
    input.type = "password";
    input.autocomplete = "off";
    wrap.appendChild(input);
    const hint = el("span", "field-hint", hintText + " ");
    if (linkHref) {
      const link = el("a", null, linkText);
      link.href = linkHref;
      link.target = "_blank";
      link.rel = "noopener";
      hint.appendChild(link);
    }
    wrap.appendChild(hint);
    return { wrap: wrap, input: input };
  }

  const tokenField = secretField(
    "GitHub token",
    "只給這一個 repo 的 Contents 讀寫權限就夠了。建議設 90 天到期。",
    "去建立 →",
    "https://github.com/settings/personal-access-tokens/new"
  );
  const keyField = secretField(
    "Google Maps 金鑰",
    "選填。只有搜尋店家時會用到，不填就手動輸入營業時間。金鑰只存在這台裝置。",
    "Google Cloud →",
    "https://console.cloud.google.com/google/maps-apis/credentials"
  );

  settingsForm.appendChild(tokenField.wrap);
  settingsForm.appendChild(keyField.wrap);

  settingsForm.appendChild(
    el(
      "p",
      "field-hint",
      "這兩個都只存在這台裝置的瀏覽器裡，不會被 commit 出去，別人開這個網站也看不到。"
    )
  );

  const settingsActions = el("div", "editor-actions");
  const clearButton = el("button", "btn is-danger", "清除憑證");
  clearButton.type = "button";
  const closeSettings = el("button", "btn", "關閉");
  closeSettings.type = "button";
  const saveSettings = el("button", "btn btn-primary", "儲存");
  saveSettings.type = "button";
  settingsActions.appendChild(clearButton);
  settingsActions.appendChild(closeSettings);
  settingsActions.appendChild(saveSettings);
  settingsForm.appendChild(settingsActions);

  settings.appendChild(settingsForm);
  document.body.appendChild(settings);

  closeSettings.addEventListener("click", () => settings.close());

  clearButton.addEventListener("click", () => {
    if (!confirm("清除這台裝置上的 token 與金鑰？")) return;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(GOOGLE_KEY);
    tokenField.input.value = "";
    keyField.input.value = "";
    settings.close();
    setStatus("已清除。重新整理後就會回到一般瀏覽模式", "ok");
  });

  saveSettings.addEventListener("click", () => {
    const token = tokenField.input.value.trim();
    const key = keyField.input.value.trim();

    if (token) localStorage.setItem(TOKEN_KEY, token);
    if (key) localStorage.setItem(GOOGLE_KEY, key);

    settings.close();
    setStatus("已儲存設定", "ok");
    if (token) loadFromGithub();
  });

  /* ---------- 工具列 ---------- */

  const bar = el("div", "editor-bar");

  const addButton = el("button", "btn btn-primary", "＋ 新增店家");
  addButton.type = "button";
  addButton.addEventListener("click", () => openForm(null));

  const settingsButton = el("button", "btn", "設定");
  settingsButton.type = "button";
  settingsButton.addEventListener("click", () => {
    tokenField.input.value = getToken();
    keyField.input.value = getGoogleKey();
    settings.showModal();
  });

  bar.appendChild(el("span", "editor-label", "編輯模式"));
  bar.appendChild(addButton);
  bar.appendChild(settingsButton);

  const main = document.querySelector("main");
  main.insertBefore(bar, main.firstChild);
  main.insertBefore(statusBar, bar.nextSibling);

  document.body.classList.add("is-editing");

  if (!getToken()) {
    setStatus("還沒設定 GitHub token，改了不會存起來。先按「設定」。", "warn");
  } else {
    loadFromGithub();
  }
})();
