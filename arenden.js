// Ärenden (GitHub Issues). Samma idé som diskussionerna: sidan är en andra ingång till
// GitHubs egna ärenden, och alla knappar styrs av GitHubs flaggor (viewerCan*).
// Läses och skrivs bara av inloggade (service-token har inte läsrätt till ärenden).

let arendeNr = null;
let arendeObj = null;
let arendeListCursor = null;
let arendeKommentarCursor = null;
let arendeKommentarerHamtade = 0;

const STANG_ORSAKER = [["COMPLETED", "klart"], ["NOT_PLANNED", "ej planerat"], ["DUPLICATE", "dubblett"]];

function visaArendeSektion(id) {
  for (const s of ["vy-lista", "vy-detalj", "vy-arenden", "vy-arende", "vy-oversikt"]) $(s).hidden = s !== id;
  markeraTyp("i");
}

// ------------------------------------------------------------ lista

async function visaArendeLista() {
  visaArendeSektion("vy-arenden");
  const inloggad = tokenRackerForRepo();
  $("arenden-logga-in").hidden = inloggad;
  $("arenden-innehall").hidden = !inloggad;
  if (!inloggad) return;
  await hamtaArenden();
}

async function hamtaArenden(fler = false) {
  const lista = $("arenden-lista");
  const status = $("arenden-status");
  if (!fler) {
    lista.innerHTML = "";
    arendeListCursor = null;
  }
  $("arenden-fler").hidden = true;
  sattStatus(status, "Hämtar ärenden…");
  try {
    const p = new URLSearchParams({ state: $("arenden-status-val").value });
    if ($("arenden-sort-val").value) p.set("sort", $("arenden-sort-val").value);
    if (fler && arendeListCursor) p.set("after", arendeListCursor);
    const data = await api(`/issues?${p}`);
    const r = data.data.repository;
    if (r.viewerPermission) visaRoll(r.viewerPermission);
    for (const a of r.issues.nodes) {
      const li = document.createElement("li");
      const lank = document.createElement("a");
      lank.href = `#r/${repo}/i/${a.number}`;
      lank.textContent = `#${a.number} ${a.title}`;
      const meta = document.createElement("span");
      meta.className = "meta";
      meta.textContent = `${a.author?.login ?? "okänd"} · ${datum(a.createdAt)} · 💬 ${a.comments.totalCount} · senast ${relativ(a.updatedAt)}`;
      meta.title = `Senast ändrad ${new Date(a.updatedAt).toLocaleString("sv-SE")}`;
      const markor = pills({ ...a, labels: a.labels });
      if (arNytt("i", a)) markor.prepend(nyttMarke());
      li.append(lank, meta, markor);
      lista.append(li);
    }
    const sidor = r.issues.pageInfo;
    arendeListCursor = sidor?.hasNextPage ? sidor.endCursor : null;
    $("arenden-fler").hidden = !arendeListCursor;
    $("arenden-hamtad").textContent = `Hämtad ${klockan()}`;
    sattStatus(
      status,
      r.issues.totalCount === 0 ? "Inga ärenden." : r.issues.totalCount > lista.children.length ? `Visar ${lista.children.length} av ${r.issues.totalCount} ärenden.` : ""
    );
  } catch (fel) {
    sattStatus(status, `Kunde inte hämta ärenden: ${fel.message}`, true);
  }
}

async function skapaArende(event) {
  event.preventDefault();
  const status = $("arende-skapa-status");
  sattStatus(status, "Skapar…");
  try {
    await api("/issues", {
      method: "POST",
      inloggad: true,
      body: { title: $("arende-ny-titel").value.trim(), body: $("arende-ny-text").value.trim() },
    });
    sattStatus(status, "Ärendet är skapat!");
    tomtFalt($("arende-ny-titel"));
    tomtFalt($("arende-ny-text"));
    await hamtaArenden();
  } catch (fel) {
    sattStatus(status, `Kunde inte skapa ärendet: ${fel.message}`, true);
  }
}

// ------------------------------------------------------------ detalj

async function visaArende(nummer, kommentarId = null) {
  arendeNr = nummer;
  visaArendeSektion("vy-arende");
  $("arende-redigera-formular").hidden = true;
  const status = $("arende-status");
  sattStatus($("arende-atgard-status"), "");
  if (!tokenRackerForRepo()) {
    sattStatus(status, "Logga in för att se ärenden.");
    return;
  }
  sattStatus(status, "Hämtar…");
  try {
    const data = await api(`/issues/${nummer}`);
    const r = data.data.repository;
    const a = r.issue;
    if (!a) throw new Error("hittades inte");
    arendeObj = a;
    if (r.viewerPermission) visaRoll(r.viewerPermission);
    sattStatus(status, "");
    $("arende-titel").textContent = `#${a.number} ${a.title}`;
    $("arende-meta").textContent = `${a.author?.login ?? "okänd"} · ${datum(a.createdAt)}`;
    $("arende-pills").replaceWith(Object.assign(pills(a), { id: "arende-pills" }));
    byggBanner($("arende-banner"), a);
    sattMarkdown($("arende-text"), a.bodyHTML, a.bodyText);
    markeraSedd("i", nummer);
    aterstallUtkast($("arende-kommentar-text"));
    const rm = $("arende-redigerad");
    rm.innerHTML = "";
    const marke = redigeratMarke(a, a.id);
    if (marke) rm.append(marke);
    byggReaktioner($("arende-reaktioner"), a.id, a.reactionGroups, a.viewerHasReactions, Boolean(a.viewerCanReact));
    byggLabels($("arende-labels"), a.id, a.labels?.nodes ?? [], Boolean(a.viewerCanLabel), () => visaArende(nummer));
    $("arende-github").href = a.url;
    $("arende-hjalptext").textContent = arendeHjalptext(a, r.viewerPermission);
    byggArendeAtgarder(a, r.viewerPermission);
    byggArendeKommentarer(a);
    $("arende-hamtad").textContent = `Hämtad ${klockan()}`;
    visaBehorigheter(a, r.viewerPermission, $("arende-behorigheter"));
    $("arende-kommentar-formular").hidden = false;
    $("arende-hamtad").textContent = `Hämtad ${klockan()}`;
    if (kommentarId) {
      const mal = document.getElementById(`c-${kommentarId}`);
      if (mal) {
        mal.classList.add("markerad");
        mal.scrollIntoView({ block: "center" });
      } else {
        sattStatus(status, "Kommentaren finns inte på den här sidan.");
      }
    }
  } catch (fel) {
    sattStatus(status, `Kunde inte hämta ärendet: ${fel.message}`, true);
  }
}

function arendeHjalptext(a, roll) {
  const write = WRITE_ELLER_HOGRE.includes(roll);
  const kan = ["kommentera"], kanEj = [];
  const v = (ok, t) => (ok ? kan : kanEj).push(t);
  v(a.viewerCanReact, "reagera");
  v(a.viewerCanUpdate, "redigera ärendet");
  v(a.viewerCanDelete, "radera ärendet");
  v(a.closed ? a.viewerCanReopen : a.viewerCanClose, a.closed ? "öppna ärendet igen" : "stänga ärendet");
  v(a.viewerCanLabel, "ändra labels");
  v(write, "låsa ärendet");
  return `Din roll: ${roll ?? "okänd"}. Du kan ${kan.join(", ")}.` + (kanEj.length ? ` Du kan inte ${kanEj.join(", ")}.` : "");
}

function arendeLank(nummer, kommentarId) {
  const bas = `${location.origin}${location.pathname}#r/${repo}/i/${nummer}`;
  return kommentarId ? `${bas}/c/${kommentarId}` : bas;
}

function byggArendeAtgarder(a, roll) {
  const rad = $("arende-atgarder");
  rad.innerHTML = "";
  const write = WRITE_ELLER_HOGRE.includes(roll);
  const efter = () => visaArende(a.number);
  if (a.viewerCanUpdate) rad.append(knapp("Redigera", () => {
    $("arende-redigera-titel").value = a.title;
    $("arende-redigera-text").value = a.body;
    $("arende-redigera-formular").hidden = false;
  }));
  if (a.viewerCanDelete) rad.append(bekraftaKnapp("Radera", async () => {
    try {
      await api(`/issues/${a.number}`, { method: "DELETE", inloggad: true });
      history.pushState(null, "", `#r/${repo}/i`);
      await hanteraRoutning();
    } catch (fel) {
      sattStatus($("arende-atgard-status"), `Misslyckades: ${fel.message}`, true);
    }
  }));
  if (a.viewerCanClose && !a.closed) {
    const sel = document.createElement("select");
    sel.setAttribute("aria-label", "Orsak");
    for (const [v, t] of STANG_ORSAKER) sel.append(new Option(t, v));
    rad.append(sel, knapp("Stäng ärende", () => anropa(`/issues/${a.number}/close`, "POST", { reason: sel.value }, efter)));
  }
  if (a.viewerCanReopen && a.closed) rad.append(knapp("Öppna igen", () => anropa(`/issues/${a.number}/reopen`, "POST", {}, efter)));
  if (write) {
    rad.append(knapp(a.locked ? "Lås upp" : "Lås ärende", () => anropa(`/issues/${a.number}/${a.locked ? "unlock" : "lock"}`, "POST", {}, efter)));
  }
}

function byggArendeKommentarer(a, fler = false) {
  const ul = $("arende-kommentarer");
  const noder = a.comments?.nodes ?? [];
  if (!fler) {
    ul.innerHTML = "";
    arendeKommentarerHamtade = 0;
    if (!noder.length) {
      const li = document.createElement("li");
      li.textContent = "Inga kommentarer än.";
      ul.append(li);
    }
  }
  arendeKommentarerHamtade += noder.length;
  for (const k of noder) ul.append(arendeKommentarRad(k));
  const sidor = a.comments?.pageInfo;
  arendeKommentarCursor = sidor?.hasNextPage ? sidor.endCursor : null;
  const kn = $("arende-kommentarer-fler");
  kn.hidden = !arendeKommentarCursor;
  kn.textContent = `Visa fler kommentarer (${(a.comments?.totalCount ?? 0) - arendeKommentarerHamtade} kvar)`;
}

function arendeKommentarRad(k) {
  const li = document.createElement("li");
  li.id = `c-${k.id}`;
  const meta = document.createElement("span");
  meta.className = "meta";
  meta.textContent = `${k.author?.login ?? "okänd"} · ${datum(k.createdAt)}`;
  const text = document.createElement("div");
  text.className = "markdown";
  sattMarkdown(text, k.bodyHTML, k.bodyText);
  const reaktioner = document.createElement("div");
  reaktioner.className = "reaktioner";
  byggReaktioner(reaktioner, k.id, k.reactionGroups, k.viewerHasReactions, Boolean(k.viewerCanReact));
  const rad = document.createElement("div");
  rad.className = "atgarder";
  const efter = () => visaArende(arendeNr);
  if (k.viewerCanUpdate) rad.append(knapp("Redigera", () => redigeraArendeKommentar(li, k)));
  if (k.viewerCanDelete) {
    rad.append(bekraftaKnapp("Radera", () => anropa(`/issue-comments/${encodeURIComponent(k.id)}`, "DELETE", undefined, efter)));
  }
  rad.append(knapp("Länk", () => kopieraLank(arendeLank(arendeNr, k.id), $("arende-status"))));
  rad.append(knapp("Citera", () => citera($("arende-kommentar-text"), k.author?.login, k.body)));
  const marke = redigeratMarke(k, k.id);
  li.append(meta);
  if (marke) li.append(marke);
  li.append(text, reaktioner, rad);
  doljKomponenter(k, text, rad, efter);
  return li;
}

function redigeraArendeKommentar(li, k) {
  const form = document.createElement("form");
  const ta = document.createElement("textarea");
  ta.value = k.body;
  ta.required = true;
  const spara = document.createElement("button");
  spara.type = "submit";
  spara.textContent = "Spara";
  form.append(ta, spara, knapp("Avbryt", () => form.remove()));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    anropa(`/issue-comments/${encodeURIComponent(k.id)}`, "PATCH", { body: ta.value.trim() }, () => visaArende(arendeNr));
  });
  li.append(form);
  medForhandsvisning(ta);
  ta.focus();
}

async function skickaArendeKommentar(event) {
  event.preventDefault();
  const status = $("arende-status");
  sattStatus(status, "Skickar…");
  try {
    await api(`/issues/${arendeNr}/comments`, { method: "POST", inloggad: true, body: { body: $("arende-kommentar-text").value.trim() } });
    tomtFalt($("arende-kommentar-text"));
    sattStatus(status, "Kommentaren skickad!");
    await visaArende(arendeNr);
  } catch (fel) {
    sattStatus(status, `Kunde inte skicka kommentaren: ${fel.message}`, true);
  }
}

async function sparaArendeRedigering(event) {
  event.preventDefault();
  await anropa(`/issues/${arendeNr}`, "PATCH", {
    title: $("arende-redigera-titel").value.trim(),
    body: $("arende-redigera-text").value.trim(),
  }, () => {
    $("arende-redigera-formular").hidden = true;
    return visaArende(arendeNr);
  });
}

async function hamtaFlerArendeKommentarer() {
  if (!arendeKommentarCursor) return;
  try {
    const data = await api(`/issues/${arendeNr}?commentsAfter=${encodeURIComponent(arendeKommentarCursor)}`);
    byggArendeKommentarer(data.data.repository.issue, true);
  } catch (fel) {
    sattStatus($("arende-status"), `Kunde inte hämta fler kommentarer: ${fel.message}`, true);
  }
}

function initArenden() {
  $("nytt-arende-formular").addEventListener("submit", skapaArende);
  $("arenden-status-val").addEventListener("change", () => hamtaArenden());
  $("arenden-sort-val").addEventListener("change", () => hamtaArenden());
  $("arenden-uppdatera").addEventListener("click", () => hamtaArenden());
  $("arenden-fler").addEventListener("click", () => hamtaArenden(true));
  $("arende-tillbaka").addEventListener("click", () => {
    history.pushState(null, "", `#r/${repo}/i`);
    hanteraRoutning();
  });
  $("arende-uppdatera").addEventListener("click", () => visaArende(arendeNr));
  $("arende-kopiera").addEventListener("click", () => kopieraLank(arendeLank(arendeNr), $("arende-status")));
  $("arende-kommentar-formular").addEventListener("submit", skickaArendeKommentar);
  $("arende-redigera-formular").addEventListener("submit", sparaArendeRedigering);
  $("arende-redigera-avbryt").addEventListener("click", () => ($("arende-redigera-formular").hidden = true));
  $("arende-kommentarer-fler").addEventListener("click", hamtaFlerArendeKommentarer);
  for (const id of ["arende-ny-text", "arende-kommentar-text", "arende-redigera-text"]) medForhandsvisning($(id));
}
