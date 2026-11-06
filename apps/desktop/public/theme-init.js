(function () {
  var theme = "system";
  try {
    theme = JSON.parse(localStorage.getItem("hopilo.theme") || "{}").theme || "system";
  } catch (e) {}
  var dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  var root = document.documentElement;
  root.dataset.theme = dark ? "dark" : "light";
  root.style.colorScheme = dark ? "dark" : "light";
  var match = location.search.match(/[?&]surface=([^&]+)/);
  if (match) {
    root.dataset.surface = match[1];
  } else {
    root.style.background = dark ? "#07080c" : "#ecebf3";
  }
})();
