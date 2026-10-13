// Apply the theme before the first paint: map colors are read from CSS
// variables, so rendering under the wrong theme would draw wrong colors.
// Loaded as a blocking classic script (CSP: script-src 'self').
(function () {
  var t = "system";
  try {
    t = localStorage.getItem("theme") || "system";
  } catch (e) {
    /* storage unavailable: follow the system */
  }
  if (t !== "light" && t !== "dark" && t !== "scada") {
    t = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  document.documentElement.classList.add(t);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", { light: "#f5f6f7", dark: "#191c20", scada: "#0b0d0c" }[t]);
})();
