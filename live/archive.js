(() => {
  const labels = {storico:"Storico senza 0-0",xg:"xG",segna:"Segna sempre",subisce:"Subisce sempre",mai00:"Mai 0-0"};
  let selectedDate = null, seq = 0;
  const score = s => { const m = String(s || "").match(/(\d+)\s*[-:]\s*(\d+)/); return m ? [Number(m[1]),Number(m[2])] : null; };
  const pct = (n,d) => d ? (100*n/d).toFixed(1)+"%" : "—";
  const dateLabel = d => { const p=String(d||"").split("-"); return p.length===3 ? p[2]+"/"+p[1]+"/"+p[0] : d; };
  const el = (tag, cls, value, parent) => { const n=document.createElement(tag); if(cls)n.className=cls; if(value!==undefined)n.textContent=value; if(parent)parent.appendChild(n); return n; };
  async function json(url) { const r=await fetch(url+"?t="+Date.now(),{cache:"no-store"}); if(!r.ok)throw new Error("HTTP "+r.status); return r.json(); }
  function setupArchiveTab() {
    const tabs=document.querySelector(".tabs"), main=document.querySelector("main");
    if(!tabs||!main||document.querySelector('.tab[data-t="archivio"]')) return;
    const btn=document.createElement("button");
    btn.className="tab day"; btn.dataset.t="archivio"; btn.textContent="📚 Archivio giornaliero";
    tabs.appendChild(btn);
    const panel=document.createElement("section"); panel.className="panel"; panel.id="p-archivio"; main.appendChild(panel);
    btn.addEventListener("click",()=>{
      history.replaceState(null,"", "#archivio");
      document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("on",x===btn));
      document.querySelectorAll(".panel").forEach(p=>p.classList.toggle("on",p.id==="p-archivio"));
      renderArchive(window.__archiveDay, window.__archiveSignals || []);
    });
  }
  window.renderArchive = async function(day, signals) {
    const root=document.getElementById("p-archivio"); if(!root)return;
    const request=++seq;
    try {
      const idx=await json("data/archive/index.json");
      const dates=Array.isArray(idx.dates)?idx.dates:[];
      if(!selectedDate)selectedDate=(day&&day.date)||dates[0];
      if(!dates.includes(selectedDate))selectedDate=dates[0];
      if(!selectedDate)throw new Error("Archivio vuoto");
      const doc=await json("data/archive/"+selectedDate+".json");
      if(request!==seq)return;
      draw(root,doc,dates,signals||[],idx);
    } catch(err) {
      if(request!==seq)return;
      root.textContent="Archivio completo in inizializzazione. La prima esecuzione automatica sta preparando i dati.";
    }
  };
  function draw(root,doc,dates,signals,idx) {
    root.replaceChildren();
    const matches=doc.matches||[];
    const finished=matches.filter(m=>m.finished&&score(m.score));
    const finalOver=finished.filter(m=>score(m.score).reduce((a,b)=>a+b,0)>0).length;
    const ht=matches.filter(m=>score(m.ht_score));
    const htOver=ht.filter(m=>score(m.ht_score).reduce((a,b)=>a+b,0)>0).length;
    const live=matches.filter(m=>m.status==="in_corso").length;
    const future=matches.filter(m=>m.status==="programmata").length;
    const zeroFinal=finished.length-finalOver, zeroHt=ht.length-htOver;
    const top=el("div","dmeta",undefined,root);
    el("b","", "📚 Archivio completo di tutte le partite",top);
    el("div","", "Giornata "+dateLabel(doc.date)+" · aggiornato "+(doc.generated_at||idx.updated_at||"—")+". Le partite vengono aggiornate automaticamente e conservate per data.",top);
    const picker=el("div","",undefined,root); picker.style.cssText="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 14px";
    el("label","", "Scegli giornata:",picker).style.fontWeight="700";
    const select=el("select","",undefined,picker); select.id="archive-date"; select.style.cssText="background:#000;color:#fff;border:1px solid #555;border-radius:8px;padding:10px;font-size:17px;max-width:100%";
    dates.forEach(d=>{const o=el("option","",dateLabel(d),select);o.value=d;o.selected=d===doc.date;});
    select.addEventListener("change",()=>{selectedDate=select.value;window.renderArchive({date:selectedDate},signals);});
    const sum=el("div","sum",undefined,root);
    const stat=(v,l)=>{const b=el("div","box",undefined,sum);el("div","v",v,b);el("div","l",l,b);};
    stat(String(matches.length),"Tutte le partite");
    stat(finalOver+"/"+finished.length+" · "+pct(finalOver,finished.length),"Over 0,5 finale");
    stat(htOver+"/"+ht.length+" · "+pct(htOver,ht.length),"Over 0,5 primo tempo");
    stat(live+" / "+future,"In corso / future");
    const note=el("div","rules",undefined,root);
    note.appendChild(document.createTextNode("Finali: "+finished.length+" · Over 0,5: "+finalOver+" ("+pct(finalOver,finished.length)+") · 0-0: "+zeroFinal));
    el("br","",undefined,note);
    note.appendChild(document.createTextNode("Primo tempo: intervallo disponibile per "+ht.length+" partite · Over 0,5 1T: "+htOver+" ("+pct(htOver,ht.length)+") · 0-0 1T: "+zeroHt+". Gli intervalli non disponibili sono esclusi dal calcolo."));
    const sigMap={}; signals.forEach(s=>{const k=String(s.matchId);(sigMap[k]||(sigMap[k]=[])).push(s);});
    let last=null;
    matches.forEach(m=>{
      if(m.kickoff!==last){el("div","ko","🕒 "+(m.kickoff||"Orario non disponibile"),root);last=m.kickoff;}
      const ss=sigMap[String(m.matchId)]||[];
      const card=el("div","dm"+(ss.length?" hit":""),undefined,root);
      const a=el("a","",String(m.home||"Casa")+" – "+String(m.away||"Ospite"),el("div","m",undefined,card));
      a.href=m.url||"#";a.target="_blank";a.rel="noopener";a.style.cssText="color:#fff;text-decoration:none";
      const status=m.status==="terminata"?"Terminata":m.status==="in_corso"?"In corso":m.status==="annullata"?"Annullata":"Da giocare";
      el("div","d",(m.league||"Campionato non disponibile")+" ("+(m.country||"")+") · "+status,card);
      const hts=score(m.ht_score), fin=score(m.final||m.score);
      const result=m.finished?(m.final||m.score||"FT"):m.status==="in_corso"?(m.score||"In corso"):status;
      const rc=m.finished?(fin&&fin[0]+fin[1]>0?"won":"lost"):m.status==="in_corso"?"pending":"void";
      el("div","r","⏱️ Intervallo: "+(m.ht_score||"non disponibile")+" · 🏁 Risultato: "+result,card).classList.add(rc);
      if(ss.length)el("div","gotsig","🚨 Segnale live: "+ss.map(s=>labels[s.type]||s.type).join(" + ")+(ss[0].final?" · "+ss[0].final:""),card);
    });
  }
  setupArchiveTab();
  if(location.hash==="#archivio") { const b=document.querySelector('.tab[data-t="archivio"]'); if(b)b.click(); }
})();