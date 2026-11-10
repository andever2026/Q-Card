  // ---------- verb forms ----------
  // Verb forms practice asks five plain forms of each verb. A word is a verb when its English starts with "to" and each
  // Japanese alternative ends like a verb; Nakama 1's early masu forms (飲みます) are turned back into dictionary forms first.
  const VDESC = { "Current Plain+": "plain non-past affirmative (dictionary) form", "Current Plain-": "plain non-past negative form (〜ない)", "て form": "て form", "Past Plain+": "plain past affirmative form (〜た)", "Past Plain-": "plain past negative form (〜なかった)" };
  const VFORMS = [["now", "Current Plain+"], ["nownot", "Current Plain-"], ["te", "て form"], ["past", "Past Plain+"], ["pastnot", "Past Plain-"]];
  const VROWS = ["わかさたなはまやらがざだばぱ", "いきしちにひみ・りぎじぢびぴ", "うくすつぬふむゆるぐずづぶぷ", "えけせてねへめ・れげぜでべぺ"];
  const vrow = (c, to) => { for (const r of VROWS) { const i = r.indexOf(c); if (i >= 0 && c !== "・") return VROWS[to][i]; } return ""; };
  // いる/える verbs that are u-verbs all the same, known by their kanji (要る, 知る, 切る…) or, written in kana, by the whole word.
  const U_RU_KANJI = "要知切走参煎帰入減散握限喋蹴滑照練焦茂罵覆";
  const U_RU_KANA = /(^|[をがにでへとは])(はいる|はしる|しる|まいる|しゃべる|すべる|いじる|ののしる)$/;
  // Masu stems of ru-verbs that don't end in an え-row kana: 浴び, 起き, 見, い(る), 借り, 降り, 出来, 着.
  const RU_MASU = /(^|[をがにでへとは])(あび|おき|み|い|かり|おり|でき)$|てい$|をき$/;
  function verbType(kana, kanji) {
    if (/する$/.test(kana) && (!kanji || /する$/.test(kanji))) return "suru";
    if (/(^|[をがにでへてはも])くる$/.test(kana) && (!kanji || /来る$/.test(kanji))) return "kuru";
    if (/(^|[をがにでへてはも])いく$/.test(kana) && (!kanji || /行く$/.test(kanji))) return "iku";
    if (/(^|[をがにでへてはも])ある$/.test(kana) && (!kanji || /(ある|有る|在る)$/.test(kanji))) return "aru";
    const last = kana.slice(-1), prev = kana.slice(-2, -1);
    if (!VROWS[2].includes(last)) return null;
    if (last !== "る" || !(VROWS[1].includes(prev) || VROWS[3].includes(prev))) return "u";
    // 切る is a u-verb, 切れる (kana before る) is not.
    const k = kanji.match(/([一-鿿])る$/)?.[1];
    if (k) return U_RU_KANJI.includes(k) ? "u" : "ru";
    return U_RU_KANA.test(kana) ? "u" : "ru";
  }
  function fromMasu(kana, kanji) {
    const s = kana.slice(0, -2), j = kanji.slice(0, -2);
    // します, 勉強します, べんきょうします and 〜にします are する verbs; 話します is not.
    if (s === "し" || /[をにが]し$/.test(s) || /[一-鿿]{2}し$/.test(j) || (!/[一-鿿]/.test(j) && /[んうりじぽァ-ヺー]し$/.test(s))) return [s.slice(0, -1) + "する", j && j.slice(0, -1) + "する"];
    // きます after に/へ is 来ます (クラスにきます); after を it is 着ます.
    if (/来$/.test(j) || (/(^|[にへ])き$/.test(s) && !/着$/.test(j))) return [s.slice(0, -1) + "くる", j && (/来$/.test(j) ? j + "る" : j.slice(0, -1) + "くる")];
    if (VROWS[3].includes(s.slice(-1)) || RU_MASU.test(s) || /着$/.test(j)) return [s + "る", j && j + "る"];
    const u = vrow(s.slice(-1), 2);
    // A masu stem ending in り (かえります) can only come from a u-verb, so its る is not a ru-verb's.
    return u ? [s.slice(0, -1) + u, j && (/[ぁ-ゖ]$/.test(j) ? j.slice(0, -1) + u : j + u), u === "る" ? "u" : ""] : null;
  }
  // One form of one alternative: k is the end of the word that changes (る, く, する, くる…), t the verb type.
  function conjEnd(s, t, f) {
    if (!s) return "";
    const cut = (n, add) => s.slice(0, s.length - n) + add;
    if (t === "suru") return cut(2, { now: "する", nownot: "しない", te: "して", past: "した", pastnot: "しなかった" }[f]);
    if (t === "kuru") { const kj = /来る$/.test(s); return cut(2, (kj ? "来" : "") + { now: kj ? "る" : "くる", nownot: kj ? "ない" : "こない", te: kj ? "て" : "きて", past: kj ? "た" : "きた", pastnot: kj ? "なかった" : "こなかった" }[f]); }
    // 知っている is negated as 知らない.
    if (t === "ru" && /not$/.test(f) && /(しって|知って)いる$/.test(s)) return cut(5, (s.slice(-5, -4) === "知" ? "知" : "し") + (f === "nownot" ? "らない" : "らなかった"));
    if (t === "ru") return cut(1, { now: "る", nownot: "ない", te: "て", past: "た", pastnot: "なかった" }[f]);
    if (t === "aru" && /not$/.test(f)) return cut(2, f === "nownot" ? "ない" : "なかった");
    const e = s.slice(-1);
    if (f === "now") return s;
    if (f === "nownot" || f === "pastnot") return cut(1, vrow(e, 0) + (f === "nownot" ? "ない" : "なかった"));
    const ta = t === "iku" ? "って" : "うつる".includes(e) ? "って" : "むぶぬ".includes(e) ? "んで" : e === "く" ? "いて" : e === "ぐ" ? "いで" : "して";
    return cut(1, f === "te" ? ta : ta.slice(0, -1) + (ta.endsWith("で") ? "だ" : "た"));
  }
  // The verb's dictionary forms and types, one per alternative, or null when the word isn't a verb.
  const VERB_CACHE = new Map();
  function verbOf(w) {
    const ck = w.en + "\u0001" + w.kana + "\u0001" + w.kanji;
    if (VERB_CACHE.has(ck)) return VERB_CACHE.get(ck);
    let out = null;
    if (/^\s*\(?to\)?\s(?!(the|a|an)\s)|\(to\)\s/i.test(w.en || "") && w.kana) {
      // An optional する（する）is part of the verb here: 案内（する） → 案内する.
      const fix = (s) => String(s || "").replace(/[（(](を?する)[）)]$/, "$1");
      let ka = fix(w.kana).split(/[／/]/);
      const kj0 = fix(w.kanji).split(/[／/]/).filter(Boolean);
      // One reading with several kanji spellings (かえる: 替える／変える) becomes one alternative per spelling.
      if (ka.length === 1 && kj0.length > 1) ka = kj0.map(() => ka[0]);
      const kj = kj0.length === ka.length ? kj0 : ka.map((_, i) => (i === 0 && kj0.length === 1 ? kj0[0] : ""));
      const alts = [];
      ka.forEach((a, i) => {
        let k = a.trim(), j = (kj[i] || "").trim(), hint = "";
        const bare = k.replace(/[〜～]/g, "");
        if (/ます$/.test(bare) && /[いきしちにひみりぎじぢびぴえけせてねへめれげぜでべぺ]ます$/.test(bare)) { const m = fromMasu(k, j); if (!m) return; [k, j, hint] = m; }
        // です words and ones ending in an optional part (迷惑（な）) aren't verbs.
        if (/です$/.test(k) || /[）)]$/.test(k)) return;
        let t = verbType(k.replace(/[（(][^）)]*[）)]/g, ""), j.replace(/[（(][^）)]*[）)]/g, ""));
        if (hint === "u" && t === "ru") t = "u";
        if (t) alts.push({ k, j, t });
      });
      if (alts.length) out = alts;
    }
    VERB_CACHE.set(ck, out);
    return out;
  }
  // The five questions for one verb, each a word of its own whose expected answer is that form.
  function verbItems(w) {
    const alts = verbOf(w);
    if (!alts) return [];
    return VFORMS.map(([f, label]) => {
      const kana = [...new Set(alts.map((a) => conjEnd(a.k, a.t, f)))].join("／"), kanjis = alts.map((a) => conjEnd(a.j, a.t, f));
      return { key: w.id + ":" + f, dir: "ej", vid: w.id, w: { ...w, id: w.id + "~" + f, en: `${w.en} · ${label}`, ven: w.en, vf: label, kana, kanji: kanjis.some(Boolean) ? kanjis.map((x, i) => x || conjEnd(alts[i].k, alts[i].t, f)).join("／") : "" } };
    });
  }
