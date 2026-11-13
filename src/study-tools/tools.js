// The Study tools page (study-tools/): one card per tool. A tool is a file in this folder exporting
// { id, name, about, mount(box) }; adding it to TOOLS puts its card on the page. Bundled into js/tools.js by tools/build.mjs.
import { romajiSheet } from "./romaji-sheet.js";

const TOOLS = [romajiSheet];
const list = document.getElementById("tools");
for (const t of TOOLS) {
  const card = Object.assign(document.createElement("section"), { className: "tool", id: t.id });
  card.innerHTML = `<h2>${t.name}</h2><p class="muted small">${t.about}</p><div class="toolbody"></div>`;
  list.append(card);
  t.mount(card.querySelector(".toolbody"));
}
