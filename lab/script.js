/*
 * 連結列的聚光跟著游標走：把游標在列裡的座標寫進 --mx / --my，
 * style.css 的 .lab-link::before 用它當漸層圓心。手機上就停在正中央。
 */
(function () {
  document.querySelectorAll(".lab-link").forEach(function (link) {
    link.addEventListener("pointermove", function (e) {
      var r = link.getBoundingClientRect();
      link.style.setProperty("--mx", (e.clientX - r.left) + "px");
      link.style.setProperty("--my", (e.clientY - r.top) + "px");
    });
  });
})();
