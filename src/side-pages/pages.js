// Every side page (ai/, privacy/): the colours and light or dark picked in the site's Settings. Loaded in <head>, so the
// colours are right before anything shows. Without it the pages still read fine.
(() => {
  //#include theme/apply.js
  const recolour = () => colours.apply(...colours.saved());
  recolour();
  addEventListener("storage", recolour); // changed in Settings in another tab
  document.documentElement.classList.add("js");
  // Opened from disk, a link to the site's folder would list its files, so it names the page.
  if (location.protocol === "file:") addEventListener("DOMContentLoaded", () => document.querySelectorAll('a[href="../"]').forEach((a) => (a.href = "../index.html")));
})();
