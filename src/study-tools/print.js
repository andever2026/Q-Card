// Printing one sheet: the sheet's markup goes into #printSheet, the only thing the page shows when printed
// (see the print styles for #tools in page/styles.css), and the browser's print window opens.
export function printSheet(html) {
  document.getElementById("printSheet").innerHTML = html;
  print();
}
