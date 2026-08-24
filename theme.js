/*
 * 明暗主題。
 *
 * 這支必須放在 <head> 裡，而且要排在 <link rel="stylesheet"> 前面同步載入——
 * data-theme 得在瀏覽器第一次 paint 之前就設好，不然使用者重新整理時
 * 會先看到一閃的深色再跳成淺色。放到 body 尾端（跟站上其他 script 一樣）就會閃。
 *
 * tools/ 底下的頁面也載這支，但只有首頁有那顆切換鈕，
 * 所以跟按鈕有關的部分都要容許它不存在。
 */
const Theme = (function () {
  "use strict";

  // 沿用 open-now 的 localStorage 命名慣例：<範圍>:<功能>
  const KEY = "mingyang:theme";
  const root = document.documentElement;
  const media = window.matchMedia("(prefers-color-scheme: light)");

  /*
   * 讀不到就當作沒選過。無痕模式或擋了 storage 的瀏覽器會直接丟例外，
   * 不接住的話這支整個掛掉，連帶讓全站沒有主題可用——寧可退回預設值。
   */
  function saved() {
    try {
      const value = localStorage.getItem(KEY);
      return value === "light" || value === "dark" ? value : null;
    } catch (err) {
      return null;
    }
  }

  function get() {
    return root.getAttribute("data-theme") === "light" ? "light" : "dark";
  }

  // 只換畫面，不記錄選擇。跟隨系統偏好時走這條
  function apply(theme) {
    root.setAttribute("data-theme", theme);
    syncButton(theme);
  }

  function set(theme) {
    apply(theme);
    try {
      localStorage.setItem(KEY, theme);
    } catch (err) {
      // 存不起來就算了，至少這次瀏覽是正常的
    }
  }

  function toggle() {
    set(get() === "dark" ? "light" : "dark");
  }

  // 按鈕顯示的是「按下去會變成什麼」，不是現在的狀態
  function syncButton(theme) {
    const btn = document.getElementById("theme-toggle");
    if (!btn) return;

    const goingLight = theme === "dark";
    btn.textContent = goingLight ? "☀️" : "🌙";
    btn.setAttribute("aria-label", goingLight ? "切換到淺色主題" : "切換到深色主題");
  }

  // 立刻套用。這行是整支的重點，要在 paint 之前跑到
  apply(saved() || (media.matches ? "light" : "dark"));

  // 沒自己選過的話就跟著系統跑，例如 Windows 到晚上自動切深色
  media.addEventListener("change", function (event) {
    if (!saved()) apply(event.matches ? "light" : "dark");
  });

  // head 裡跑的時候 body 還沒 parse 到，按鈕要等 DOM 好了才綁得到
  document.addEventListener("DOMContentLoaded", function () {
    const btn = document.getElementById("theme-toggle");
    if (!btn) return;

    syncButton(get());
    btn.addEventListener("click", toggle);
  });

  return { get: get, set: set, toggle: toggle };
})();

window.Theme = Theme;
