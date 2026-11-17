  // A copy of a list in random order: the questions of a practice (practice.js), and the romaji of a printed sheet
  // (study-tools/romaji-sheet.js, which includes this file too).
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
