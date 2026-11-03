// Runs before any CSS loads so the first frame already has the right theme
// (no white flash in dark mode). Mirrors applyAppearance in src/lib/hooks.ts.
(function () {
  var theme = "system";
  try {
    theme = JSON.parse(localStorage.getItem("hopilo.theme") || "{}").theme || "system";
  } catch (e) {}
  var dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  var root = document.documentElement;
  root.dataset.theme = dark ? "dark" : "light";
  root.style.colorScheme = dark ? "dark" : "light";
  // Panel windows are transparent with rounded corners; leave them clear.
  if (!/[?&]surface=/.test(location.search)) root.style.background = dark ? "#07080c" : "#ecebf3";
})();
