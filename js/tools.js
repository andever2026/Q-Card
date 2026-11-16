/* Q-Card, built by tools/build.mjs from src/ (edit those, not this file). Includes Q-Card code (AGPL-3.0). */
(()=>{function $(t,e,n){let a=c=>String(c).replace(/[\\()]/g,d=>"\\"+d),i=n.map(({x:c,y:d,size:g,text:F})=>`BT /F1 ${g} Tf ${c.toFixed(2)} ${d.toFixed(2)} Td (${a(F)}) Tj ET`).join(`
`),r=["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R] /Count 1 >>",`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${t} ${e}] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,`<< /Length ${i.length} >>
stream
${i}
endstream`,"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"],s=`%PDF-1.4
`,L=r.map((c,d)=>{let g=s.length;return s+=`${d+1} 0 obj
${c}
endobj
`,g}),k=s.length;return s+=`xref
0 ${r.length+1}
0000000000 65535 f 
${L.map(c=>`${String(c).padStart(10,"0")} 00000 n 
`).join("")}`,s+=`trailer
<< /Size ${r.length+1} /Root 1 0 R >>
startxref
${k}
%%EOF
`,new Blob([s],{type:"application/pdf"})}function j(t){document.getElementById("printSheet").innerHTML=t,print()}function S(t,e){let n=/\.json$/i.test(t)?"application/json":"application/octet-stream",a=URL.createObjectURL(e instanceof Blob?e:new Blob([e],{type:n})),i=Object.assign(document.createElement("a"),{href:a,download:t});document.body.append(i),i.click(),i.remove(),setTimeout(()=>URL.revokeObjectURL(a),1e4)}var T=["a","i","u","e","o","ka","ki","ku","ke","ko","sa","shi","su","se","so","ta","chi","tsu","te","to","na","ni","nu","ne","no","ha","hi","fu","he","ho","ma","mi","mu","me","mo","ya","yu","yo","ra","ri","ru","re","ro","wa","wo","n"],b=792,u=612,l=.3*72,p=.12*72,o=3,m=6,v=6,h=(b-2*l-(o-1)*p)/o,f=(u-2*l-(o-1)*p)/o,M=h/m,P=f/Math.ceil(T.length/m),E=t=>{t=t.slice();for(let e=t.length-1;e>0;e--){let n=Math.floor(Math.random()*(e+1));[t[e],t[n]]=[t[n],t[e]]}return t};function y(){let t=[];for(let e=0;e<o*o;e++){let n=l+e%o*(h+p),a=u-l-Math.floor(e/o)*(f+p);E(T).forEach((i,r)=>t.push({x:n+r%m*M+2,y:a-Math.floor(r/m)*P-7,size:v,text:i}))}return t}function w(t,e){let n=Array.from({length:o*o},(i,r)=>`<rect class="edge" x="${l+r%o*(h+p)}" y="${l+Math.floor(r/o)*(f+p)}" width="${h}" height="${f}"/>`).join(""),a=t.map(({x:i,y:r,text:s})=>`<text x="${i.toFixed(2)}" y="${(u-r).toFixed(2)}">${s}</text>`).join("");return`<svg class="${e}" viewBox="0 0 ${b} ${u}" role="img" aria-label="Romaji sheet: 9 panels of the 46 basic kana in random order">${n}<g font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${v}">${a}</g></svg>`}var x={id:"romaji-sheet",name:"Romaji sheet",about:"Nine panels of the 46 basic kana as romaji, each in a new random order. Print, cut along the gaps, and write the kana in each box: one panel a day, or hand them out.",mount(t){let e=y();t.innerHTML=`<div class="tactions"><button class="btn" type="button" data-new>New sheet</button><button class="btn" type="button" data-print>Print</button>
      <button class="btn primary" type="button" data-newprint>New sheet and print</button><button class="btn" type="button" data-pdf>Download PDF</button></div>
      <div class="sheet"></div>`;let n=()=>t.querySelector(".sheet").innerHTML=w(e,"preview"),a=()=>j(w(e,"printed"));t.querySelector("[data-new]").onclick=()=>{e=y(),n()},t.querySelector("[data-print]").onclick=a,t.querySelector("[data-newprint]").onclick=()=>{e=y(),n(),a()},t.querySelector("[data-pdf]").onclick=()=>S(`romaji-sheet-${new Date().toLocaleDateString("en-CA")}.pdf`,$(b,u,e)),n()}};var O=[x],R=document.getElementById("toolList");R.innerHTML="";for(let t of O){let e=Object.assign(document.createElement("section"),{className:"panel tool",id:t.id});e.innerHTML=`<h2>${t.name}</h2><p class="muted small">${t.about}</p><div class="toolbody"></div>`,R.append(e),t.mount(e.querySelector(".toolbody"))}})();
