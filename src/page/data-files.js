  // ---------- public site: data files ----------
  // data/<name>.json comes as the script js/<name>.js (made by tools/build.mjs), which leaves it in window.QCardData:
  // a page opened straight from disk may load scripts, though not fetch files, so the site works offline that way too.
  function dataFile(name) {
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = `js/${name}.js`;
      s.onload = () => { const d = window.QCardData?.[name]; if (d) delete window.QCardData[name]; s.remove(); d ? res(d) : rej(new Error(name)); };
      s.onerror = () => { s.remove(); rej(new Error(name)); };
      document.head.append(s);
    });
  }

