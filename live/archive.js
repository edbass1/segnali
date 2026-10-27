document.addEventListener("DOMContentLoaded", function () {
  var tab = document.querySelector('.tab[data-t="oggi"]');
  if (tab) tab.textContent = "📚 Archivio giornaliero";
  window.renderDay = function (day, signals) {
    var el = document.getElementById("p-oggi");
    if (!el) return;
    var date = day && day.date ? day.date : "";
    fetch("data/archive/" + date + ".json?t=" + Date.now(), {cache:"no-store"})
      .then(function (r) { if (!r.ok) throw new Error("missing"); return r.json(); })
      .then(function (doc) {
        var matches = doc.matches || [];
        var finished = matches.filter(function (m) { return m.finished && m.score; });
        var over = finished.filter(function (m) { var s = m.score.match(/(\d+)-(\d+)/); return s && Number(s[1])+Number(s[2]) > 0; }).length;
        var ht = matches.filter(function (m) { return !!m.ht_score; });
        var hto = ht.filter(function (m) { var s = m.ht_score.match(/(\d+)-(\d+)/); return s && Number(s[1])+Number(s[2]) > 0; }).length;
        el.textContent = "Archivio " + doc.date + " — partite: " + matches.length + " — Over 0,5 finale: " + over + "/" + finished.length + " (" + (finished.length ? (100*over/finished.length).toFixed(1) : "—") + "%) — Over 0,5 1T: " + hto + "/" + ht.length + " (" + (ht.length ? (100*hto/ht.length).toFixed(1) : "—") + "%).";
      })
      .catch(function () { el.textContent = "Archivio completo in fase di inizializzazione: aggiorna la pagina tra qualche minuto."; });
  };
});