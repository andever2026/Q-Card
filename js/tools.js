/* Q-Card, built by tools/build.mjs from src/ (edit those, not this file). Includes Q-Card code (AGPL-3.0). */
(()=>{function $(e,t,n){let o=c=>String(c).replace(/[\\()]/g,p=>"\\"+p),i=n.map(({x:c,y:p,size:g,text:F})=>`BT /F1 ${g} Tf ${c.toFixed(2)} ${p.toFixed(2)} Td (${o(F)}) Tj ET`).join(`
`),r=["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R] /Count 1 >>",`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${e} ${t}] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,`<< /Length ${i.length} >>
stream
${i}
endstream`,"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"],s=`%PDF-1.4
`,R=r.map((c,p)=>{let g=s.length;return s+=`${p+1} 0 obj
${c}
endobj
`,g}),k=s.length;return s+=`xref
0 ${r.length+1}
0000000000 65535 f 
${R.map(c=>`${String(c).padStart(10,"0")} 00000 n 
`).join("")}`,s+=`trailer
<< /Size ${r.length+1} /Root 1 0 R >>
startxref
${k}
%%EOF
`,new Blob([s],{type:"application/pdf"})}function j(e){document.getElementById("printSheet").innerHTML=e,print()}function S(e,t){let n=/\.json$/i.test(e)?"application/json":"application/octet-stream",o=URL.createObjectURL(t instanceof Blob?t:new Blob([t],{type:n})),i=Object.assign(document.createElement("a"),{href:o,download:e});document.body.append(i),i.click(),i.remove(),setTimeout(()=>URL.revokeObjectURL(o),1e4)}var T=["a","i","u","e","o","ka","ki","ku","ke","ko","sa","shi","su","se","so","ta","chi","tsu","te","to","na","ni","nu","ne","no","ha","hi","fu","he","ho","ma","mi","mu","me","mo","ya","yu","yo","ra","ri","ru","re","ro","wa","wo","n"],b=792,u=612,l=.3*72,d=.12*72,a=3,m=6,v=6,h=(b-2*l-(a-1)*d)/a,f=(u-2*l-(a-1)*d)/a,L=h/m,M=f/Math.ceil(T.length/m);function P(e){let t=e.slice();for(let n=t.length-1;n>0;n--){let o=Math.floor(Math.random()*(n+1));[t[n],t[o]]=[t[o],t[n]]}return t}function y(){let e=[];for(let t=0;t<a*a;t++){let n=l+t%a*(h+d),o=u-l-Math.floor(t/a)*(f+d);P(T).forEach((i,r)=>e.push({x:n+r%m*L+2,y:o-Math.floor(r/m)*M-7,size:v,text:i}))}return e}function w(e,t){let n=Array.from({length:a*a},(i,r)=>`<rect class="edge" x="${l+r%a*(h+d)}" y="${l+Math.floor(r/a)*(f+d)}" width="${h}" height="${f}"/>`).join(""),o=e.map(({x:i,y:r,text:s})=>`<text x="${i.toFixed(2)}" y="${(u-r).toFixed(2)}">${s}</text>`).join("");return`<svg class="${t}" viewBox="0 0 ${b} ${u}" role="img" aria-label="Romaji sheet: 9 panels of the 46 basic kana in random order">${n}<g font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${v}">${o}</g></svg>`}var x={id:"romaji-sheet",name:"Romaji sheet",about:"Nine panels of the 46 basic kana as romaji, each in a new random order. Print, cut along the gaps, and write the kana in each box: one panel a day, or hand them out.",mount(e){let t=y();e.innerHTML=`<div class="tactions"><button class="btn" type="button" data-new>New sheet</button><button class="btn" type="button" data-print>Print</button>
      <button class="btn primary" type="button" data-newprint>New sheet and print</button><button class="btn" type="button" data-pdf>Download PDF</button></div>
      <div class="sheet"></div>`;let n=()=>e.querySelector(".sheet").innerHTML=w(t,"preview"),o=()=>j(w(t,"printed"));e.querySelector("[data-new]").onclick=()=>{t=y(),n()},e.querySelector("[data-print]").onclick=o,e.querySelector("[data-newprint]").onclick=()=>{t=y(),n(),o()},e.querySelector("[data-pdf]").onclick=()=>S(`romaji-sheet-${new Date().toLocaleDateString("en-CA")}.pdf`,$(b,u,t)),n()}};var E=[x],O=document.getElementById("tools");for(let e of E){let t=Object.assign(document.createElement("section"),{className:"tool",id:e.id});t.innerHTML=`<h2>${e.name}</h2><p class="muted small">${e.about}</p><div class="toolbody"></div>`,O.append(t),e.mount(t.querySelector(".toolbody"))}})();
