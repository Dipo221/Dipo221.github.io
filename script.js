document.getElementById("year").textContent = new Date().getFullYear();

/*
 * 工具卡片的邊框光跟著游標走：把游標在卡片裡的座標寫進 --mx / --my，
 * style.css 的 .tool-card::before / ::after 用它當漸層圓心。
 * 手機沒有 pointermove 的懸停，就停在 CSS 預設的正中央。
 */
(function () {
  document.querySelectorAll(".tool-card").forEach(function (card) {
    card.addEventListener("pointermove", function (e) {
      var r = card.getBoundingClientRect();
      card.style.setProperty("--mx", (e.clientX - r.left) + "px");
      card.style.setProperty("--my", (e.clientY - r.top) + "px");
    });
  });
})();
