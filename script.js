const WORKER_URL = "https://sdo-diskussioner.svenska-dhamma-ord.workers.dev";
const REPON = { "1": { privat: false }, "1-privat": { privat: true } };
const STANDARD_REPO = "1";
const WRITE_ELLER_HOGRE = ["WRITE", "MAINTAIN", "ADMIN"];

let repo = STANDARD_REPO;
let aktuelltNummer = null;
let svararPaKommentarId = null;
let aktuellDiskussion = null;
let aktuellRoll = null; // viewerPermission i aktuellt repo, från GitHub

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------ token

function hamtaToken() {
  return sessionStorage.getItem("github_token");
}
function hamtaScope() {
  return (sessionStorage.getItem("github_scope") ?? "").split(/[,\s]+/).filter(Boolean);
}
function sparaToken(token, scope) {
  sessionStorage.setItem("github_token", token);
  sessionStorage.setItem("github_scope", scope ?? "");
}
function rensaToken() {
  sessionStorage.removeItem("github_token");
  sessionStorage.removeItem("github_scope");
}
// Privata repon kräver scopet "repo". public_repo räcker inte.
function tokenRackerForRepo() {
  if (!hamtaToken()) return false;
  return REPON[repo].privat ? hamtaScope().includes("repo") : true;
}

function lasTokenFranUrl() {
  if (!location.hash.startsWith("#token=")) return null;
  const params = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, "", location.pathname + location.search);
  return {
    token: params.get("token"),
    scope: params.get("scope"),
    repo: params.get("repo"),
  };
}

// ------------------------------------------------------------ API

async function api(sokvag, { method = "GET", body, inloggad = false } = {}) {
  const url = new URL(WORKER_URL + sokvag);
  url.searchParams.set("repo", repo);
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  // Inloggad token skickas alltid när den finns och duger: då svarar GitHub
  // med viewerCan*-fälten. Privata repon går bara att läsa med token.
  if (hamtaToken() && (inloggad || tokenRackerForRepo())) {
    headers.Authorization = `Bearer ${hamtaToken()}`;
  }
  const svar = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await svar.json();
  } catch {
    /* tomt svar */
  }
  if (svar.status === 401 && hamtaToken()) {
    rensaToken();
    uppdateraInloggning();
  }
  if (!svar.ok || data?.errors || data?.error) {
    throw new Error(data?.errors?.[0]?.message ?? data?.error ?? `HTTP ${svar.status}`);
  }
  return data;
}

function sattStatus(el, text, fel = false) {
  el.textContent = text;
  el.classList.toggle("error", fel);
}

function datum(iso) {
  return new Date(iso).toLocaleDateString("sv-SE");
}

// ------------------------------------------------------------ inloggning

async function uppdateraInloggning() {
  const inloggad = tokenRackerForRepo();
  const harNagonToken = Boolean(hamtaToken());
  $("inloggning").hidden = inloggad;
  $("inloggad-rad").hidden = !harNagonToken;
  $("ny-diskussion-formular").hidden = !inloggad;
  $("kommentar-formular").hidden = !inloggad;
  $("logga-in-for-kommentar").hidden = inloggad;
  $("uppdatera-rad-lista").hidden = !inloggad;
  $("filter-mina").hidden = !inloggad;
  $("uppdatera-rad-detalj").hidden = !inloggad;

  const text = $("inloggning-text");
  if (REPON[repo].privat && harNagonToken && !inloggad) {
    text.textContent =
      "Du är inloggad, men utan rätt att läsa privata repon (scope repo). Logga in igen för det här repot.";
  } else if (REPON[repo].privat) {
    text.textContent = "Det här repot är privat. Logga in med ett GitHub-konto som har fått åtkomst.";
  } else {
    text.textContent = "";
  }

  if (harNagonToken) {
    try {
      const svar = await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${hamtaToken()}` },
      });
      if (!svar.ok) throw new Error("ogiltig token");
      $("inloggad-som").textContent = (await svar.json()).login;
    } catch {
      rensaToken();
      uppdateraInloggning();
    }
  }
}

// Ingen automatisk hämtning. Inloggade uppdaterar själva med knappen Uppdatera;
// den som inte är inloggad laddar om sidan om hen vill se nytt.
// Var fel och besked visas: i ärendevyn om den är öppen, annars i trådvyn.
function statusYta() {
  return $("vy-arende").hidden ? $("atgard-status") : $("arende-atgard-status");
}

// "nyss", "5 min sedan", "3 tim sedan", "2 d sedan", annars datum. Hela tiden visas som tooltip.
function relativ(iso) {
  const sek = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (sek < 60) return "nyss";
  if (sek < 3600) return `${Math.floor(sek / 60)} min sedan`;
  if (sek < 86400) return `${Math.floor(sek / 3600)} tim sedan`;
  if (sek < 7 * 86400) return `${Math.floor(sek / 86400)} d sedan`;
  return datum(iso);
}

function klockan(iso) {
  return (iso ? new Date(iso) : new Date()).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
}

function visaRoll(roll) {
  aktuellRoll = roll ?? null;
  $("exportera-allt").hidden = !WRITE_ELLER_HOGRE.includes(aktuellRoll);
  $("inloggad-roll").textContent = roll ?? "?";
}

// ------------------------------------------------------------ kategorier

async function hamtaKategorier() {
  const val = $("ny-kategori");
  val.innerHTML = "";
  if (!tokenRackerForRepo()) return;
  try {
    const data = await api("/categories");
    let kategorier = data.data.repository.discussionCategories.nodes;
    visaRoll(data.data.repository.viewerPermission);
    const mina = kategorier.filter((k) => /^Kategori \d$/.test(k.name));
    if (mina.length) kategorier = mina;
    for (const k of kategorier) {
      const o = document.createElement("option");
      o.value = k.id;
      o.textContent = k.isAnswerable ? `${k.name} (fråga och svar)` : k.name;
      val.append(o);
    }
  } catch (fel) {
    sattStatus($("skapa-status"), `Kunde inte hämta kategorier: ${fel.message}`, true);
  }
}

// ------------------------------------------------------------ markdown (bodyHTML från GitHub)

// GitHub renderar och rensar redan texten (bodyHTML). Vi bygger ändå om den med en
// tillåtelselista: okända taggar tas bort men texten behålls, och bara https/http-länkar
// och bilder släpps igenom. Inget script eller eventattribut kan följa med.
const TILLATNA_TAGGAR = new Set([
  "P", "BR", "STRONG", "EM", "B", "I", "DEL", "S", "CODE", "PRE", "BLOCKQUOTE", "UL", "OL",
  "LI", "H1", "H2", "H3", "H4", "H5", "H6", "A", "HR", "TABLE", "THEAD", "TBODY", "TR", "TH",
  "TD", "DETAILS", "SUMMARY", "SPAN", "DIV", "SUP", "SUB", "IMG", "KBD",
]);
const BORTTAGNA_TAGGAR = new Set([
  "SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "FORM", "INPUT", "BUTTON", "TEXTAREA",
  "SELECT", "LINK", "META", "SVG", "MATH", "BASE", "NOSCRIPT", "TEMPLATE",
]);

function sakerUrl(varde, tillatMailto) {
  try {
    const u = new URL(varde, "https://github.com/");
    const ok = ["https:", "http:", ...(tillatMailto ? ["mailto:"] : [])];
    return ok.includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

function rensaNod(kalla, mal) {
  for (const barn of [...kalla.childNodes]) {
    if (barn.nodeType === 3) {
      mal.append(document.createTextNode(barn.nodeValue));
      continue;
    }
    if (barn.nodeType !== 1) continue;
    const tagg = barn.tagName;
    if (BORTTAGNA_TAGGAR.has(tagg)) continue;
    if (!TILLATNA_TAGGAR.has(tagg)) {
      rensaNod(barn, mal); // okänd tagg (till exempel g-emoji): behåll bara innehållet
      continue;
    }
    const ny = document.createElement(tagg.toLowerCase());
    if (tagg === "A") {
      const href = sakerUrl(barn.getAttribute("href") ?? "", true);
      if (href) {
        ny.href = href;
        ny.rel = "noopener noreferrer nofollow";
        ny.target = "_blank";
      }
    } else if (tagg === "IMG") {
      const src = sakerUrl(barn.getAttribute("src") ?? "", false);
      if (!src) continue;
      ny.src = src;
      ny.alt = barn.getAttribute("alt") ?? "";
      ny.loading = "lazy";
    }
    rensaNod(barn, ny);
    mal.append(ny);
  }
}

function sattMarkdown(el, html, reservText) {
  el.textContent = "";
  if (!html) {
    el.textContent = reservText ?? "";
    return;
  }
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    rensaNod(doc.body, el);
  } catch {
    el.textContent = reservText ?? "";
  }
}

// ------------------------------------------------------------ reaktioner

const EMOJI = {
  THUMBS_UP: "👍", THUMBS_DOWN: "👎", LAUGH: "😄", HOORAY: "🎉",
  CONFUSED: "😕", HEART: "❤️", ROCKET: "🚀", EYES: "👀",
};

// Räknare kommer från GitHub (reactionGroups). Inloggade med viewerCanReact kan lägga till
// och ta bort sina egna; andra ser bara de som har någon reaktion.
function byggReaktioner(mal, subjektId, grupper, egna, kan) {
  for (const gammal of mal.querySelectorAll(".reaktion")) gammal.remove();
  const frag = document.createDocumentFragment();
  const harReagerat = Object.fromEntries((egna ?? []).map((g) => [g.content, g.viewerHasReacted]));
  const antal = Object.fromEntries((grupper ?? []).map((g) => [g.content, g.reactors.totalCount]));
  for (const innehall of Object.keys(EMOJI)) {
    const n = antal[innehall] ?? 0;
    if (!kan && n === 0) continue;
    const b = document.createElement("button");
    b.type = "button";
    b.disabled = !kan;
    b.className = `reaktion ${harReagerat[innehall] ? "aktiv" : ""} ${n === 0 ? "noll" : ""}`.trim();
    b.textContent = `${EMOJI[innehall]} ${n}`;
    b.setAttribute("aria-pressed", String(Boolean(harReagerat[innehall])));
    const grupp = (grupper ?? []).find((g) => g.content === innehall);
    const namn = (grupp?.reactors?.nodes ?? []).map((u) => u.login).filter(Boolean);
    if (n > 0) b.title = namn.join(", ") + (n > namn.length ? ` och ${n - namn.length} till` : "");
    b.addEventListener("click", async () => {
      b.disabled = true;
      try {
        const data = await api("/react", {
          method: "POST",
          inloggad: true,
          body: { id: subjektId, content: innehall, on: !harReagerat[innehall] },
        });
        const subjekt = (data.data.addReaction ?? data.data.removeReaction).subject;
        byggReaktioner(
          mal,
          subjektId,
          subjekt.reactionGroups,
          subjekt.reactionGroups.map((g) => ({ content: g.content, viewerHasReacted: g.viewerHasReacted })),
          kan
        );
      } catch (fel) {
        b.disabled = false;
        sattStatus(statusYta(), `Kunde inte reagera: ${fel.message}`, true);
      }
    });
    frag.append(b);
  }
  mal.prepend(frag);
}

// ------------------------------------------------------------ hjälptext och länkar

// Byggs av GitHubs flaggor (inte en egen lista): vad du får och inte får göra i just den här tråden.
function hjalptext(d, roll) {
  if (!d.viewerCanReact && d.viewerCanUpdate === undefined) return "";
  const write = WRITE_ELLER_HOGRE.includes(roll);
  const kan = [], kanEj = [];
  const v = (ok, text) => (ok ? kan : kanEj).push(text);
  v(true, "kommentera");
  v(d.viewerCanReact, "reagera");
  v(d.viewerCanUpdate, "redigera tråden");
  v(d.viewerCanDelete, "radera tråden");
  v(d.closed ? d.viewerCanReopen : d.viewerCanClose, d.closed ? "öppna tråden igen" : "stänga tråden");
  v(write, "låsa tråden");
  v(d.viewerCanLabel && write, "märka som beslut");
  return `Din roll: ${roll ?? "okänd"}. Du kan ${kan.join(", ")}.` +
    (kanEj.length ? ` Du kan inte ${kanEj.join(", ")}.` : "");
}

function trådLank(nummer, kommentarId) {
  const bas = `${location.origin}${location.pathname}#r/${repo}/d/${nummer}`;
  return kommentarId ? `${bas}/c/${kommentarId}` : bas;
}

async function kopieraLank(text, statusEl) {
  try {
    await navigator.clipboard.writeText(text);
    sattStatus(statusEl, "Länken är kopierad.");
  } catch {
    sattStatus(statusEl, `Kopiera länken: ${text}`);
  }
}

// ------------------------------------------------------------ gemensamma delar (diskussioner och ärenden)

// Förhandsgranska: GitHub renderar texten (samma som i tråden) via Workern.
function medForhandsvisning(textarea) {
  if (!textarea || textarea.dataset.forhand) return;
  textarea.dataset.forhand = "1";
  medVerktyg(textarea);
  const ruta = document.createElement("div");
  ruta.className = "markdown forhandsvisning";
  ruta.hidden = true;
  const kn = knapp("Förhandsgranska", async () => {
    if (!ruta.hidden) {
      ruta.hidden = true;
      kn.textContent = "Förhandsgranska";
      return;
    }
    const text = textarea.value.trim();
    if (!text) {
      ruta.textContent = "(ingen text än)";
      ruta.hidden = false;
      return;
    }
    kn.disabled = true;
    try {
      const data = await api("/markdown", { method: "POST", inloggad: true, body: { text } });
      sattMarkdown(ruta, data.html, text);
    } catch (fel) {
      ruta.textContent = `Kunde inte förhandsgranska: ${fel.message}`;
    } finally {
      kn.disabled = false;
      ruta.hidden = false;
      kn.textContent = "Dölj förhandsvisning";
    }
  });
  textarea.after(kn, ruta);
}

function upprostaKnapp(id, antal, harUpprostat, kan) {
  if (!kan && !antal) return null;
  let n = antal ?? 0;
  let har = Boolean(harUpprostat);
  const ritaOm = () => {
    b.textContent = `▲ ${n}`;
    b.className = har ? "upprost aktiv" : "upprost";
    b.setAttribute("aria-pressed", String(har));
  };
  const b = knapp("", async () => {
    b.disabled = true;
    try {
      const data = await api("/upvote", { method: "POST", inloggad: true, body: { id, on: !har } });
      const s2 = (data.data.addUpvote ?? data.data.removeUpvote).subject;
      n = s2.upvoteCount;
      har = s2.viewerHasUpvoted;
      ritaOm();
    } catch (fel) {
      sattStatus(statusYta(), `Kunde inte rösta: ${fel.message}`, true);
    } finally {
      b.disabled = !kan;
    }
  });
  b.disabled = !kan;
  b.title = "Upprösta";
  ritaOm();
  return b;
}

// "redigerad 27 nov av X" med en knapp som visar historiken (GitHubs `userContentEdits`).
function redigeratMarke(objekt, id) {
  if (!objekt.lastEditedAt) return null;
  const rad = document.createElement("span");
  rad.className = "meta";
  rad.append(`redigerad ${datum(objekt.lastEditedAt)}${objekt.editor ? " av " + objekt.editor.login : ""} `);
  const lista = document.createElement("ul");
  lista.className = "historik";
  lista.hidden = true;
  const kn = knapp("Historik", async () => {
    if (!lista.hidden) {
      lista.hidden = true;
      return;
    }
    kn.disabled = true;
    try {
      const data = await api(`/history?id=${encodeURIComponent(id)}`);
      lista.innerHTML = "";
      for (const e of data.data.edits) {
        const li = document.createElement("li");
        const rubrik = document.createElement("span");
        rubrik.className = "meta";
        rubrik.textContent = `${datum(e.editedAt)} ${klockan(e.editedAt)} · ${e.editor?.login ?? "okänd"}`;
        const pre = document.createElement("pre");
        pre.textContent = e.diff ?? "";
        li.append(rubrik, pre);
        lista.append(li);
      }
      if (!data.data.edits.length) lista.textContent = "Ingen historik.";
      lista.hidden = false;
    } catch (fel) {
      lista.textContent = `Kunde inte hämta historiken: ${fel.message}`;
      lista.hidden = false;
    } finally {
      kn.disabled = false;
    }
  });
  kn.className = "liten";
  rad.append(kn);
  const hela = document.createElement("div");
  hela.append(rad, lista);
  return hela;
}

// GitHub kräver OAuth-scopet repo (eller gist) för att dölja kommentarer, även i publika repon
// (provat 27 november). Inloggningen mot det publika repot ger bara public_repo, så knapparna
// visas först när man loggat in via det privata repot.
function kanDolja() {
  return hamtaScope().includes("repo");
}

const DOLJ_ORSAKER = [
  ["OFF_TOPIC", "off-topic"], ["SPAM", "skräp"], ["ABUSE", "kränkande"], ["OUTDATED", "föråldrad"],
  ["DUPLICATE", "dubblett"], ["RESOLVED", "löst"], ["LOW_QUALITY", "låg kvalitet"],
];

// Dolda kommentarer visas hopfällda. Modererare (viewerCanMinimize) kan dölja och visa.
function doljKomponenter(k, textEl, rad, efter) {
  if (k.isMinimized) {
    const notis = document.createElement("div");
    notis.className = "status";
    notis.textContent = `Dold kommentar (${k.minimizedReason ?? "dold"}). `;
    const visa = knapp("Visa ändå", () => {
      textEl.hidden = !textEl.hidden;
      visa.textContent = textEl.hidden ? "Visa ändå" : "Dölj igen";
    });
    visa.className = "liten";
    notis.append(visa);
    textEl.hidden = true;
    textEl.before(notis);
    if (k.viewerCanUnminimize && kanDolja()) {
      rad.append(knapp("Visa för alla", () => anropa("/minimize", "POST", { id: k.id, on: false }, efter)));
    }
  } else if (k.viewerCanMinimize && kanDolja()) {
    const sel = document.createElement("select");
    sel.setAttribute("aria-label", "Orsak till att dölja");
    for (const [v, t] of DOLJ_ORSAKER) sel.append(new Option(t, v));
    rad.append(sel, knapp("Dölj", () => anropa("/minimize", "POST", { id: k.id, on: true, classifier: sel.value }, efter)));
  }
}

// Anropar Workern, visar fel i åtgärdsraden och kör sedan `efter`.
async function anropa(sokvag, metod, body, efter) {
  const status = statusYta();
  sattStatus(status, "Arbetar…");
  try {
    await api(sokvag, { method: metod, body, inloggad: true });
    sattStatus(status, "");
    await efter();
  } catch (fel) {
    sattStatus(status, `Misslyckades: ${fel.message}`, true);
  }
}

// Labels: visas som märken, med × och en väljare för dem som får märka (viewerCanLabel).
// Att sätta ”beslut” kräver Write i Workern, precis som knappen Märk som beslut.
function byggLabels(mal, objektId, labels, kanMarka, efter) {
  mal.innerHTML = "";
  for (const l of labels) {
    const m = document.createElement("span");
    m.className = "pill";
    m.append(l.name);
    if (kanMarka) {
      const x = knapp("×", () => anropa("/labels", "POST", { id: objektId, remove: [l.name] }, efter));
      x.className = "liten";
      x.setAttribute("aria-label", `Ta bort ${l.name}`);
      m.append(x);
    }
    mal.append(m);
  }
  if (kanMarka) {
    const plus = knapp("＋ Label", async () => {
      plus.disabled = true;
      try {
        const data = await api("/labels");
        const finns = new Set(labels.map((l) => l.name));
        const sel = document.createElement("select");
        sel.setAttribute("aria-label", "Label att lägga till");
        for (const l of data.data.repository.labels.nodes) if (!finns.has(l.name)) sel.append(new Option(l.name, l.name));
        plus.replaceWith(sel, knapp("Lägg till", () => anropa("/labels", "POST", { id: objektId, add: [sel.value] }, efter)));
      } catch (fel) {
        plus.disabled = false;
        sattStatus(statusYta(), `Kunde inte hämta labels: ${fel.message}`, true);
      }
    });
    mal.append(plus);
  }
}

// ------------------------------------------------------------ lista

let listaCursor = null;
let filter = { q: "", kategori: "", status: "", sort: "", obesvarade: false, mina: false };

function lasFilter() {
  filter = {
    q: $("sok-text").value.trim(),
    kategori: $("filter-kategori").value,
    status: $("filter-status").value,
    sort: $("filter-sort").value,
    obesvarade: $("filter-obesvarade").checked,
    mina: false,
  };
}

function nollstallFilter() {
  filter = { q: "", kategori: "", status: "", sort: "", obesvarade: false, mina: false };
  $("sok-text").value = "";
  $("filter-kategori").value = "";
  $("filter-status").value = "";
  $("filter-sort").value = "";
  $("filter-obesvarade").checked = false;
}

function listSokvag(efter) {
  const p = new URLSearchParams();
  if (filter.q || filter.mina) {
    if (filter.q) p.set("q", filter.q);
    if (filter.mina) p.set("mine", "1");
    return `/search?${p}`;
  }
  if (efter) p.set("after", efter);
  if (filter.kategori) p.set("category", filter.kategori);
  if (filter.status) p.set("state", filter.status);
  if (filter.sort) p.set("sort", filter.sort);
  if (filter.obesvarade) p.set("answered", "0");
  const q = p.toString();
  return q ? `/?${q}` : "/";
}

let kategorierIFilter = null; // repo som filtrets kategorier hämtats för

async function fyllFilterKategorier() {
  if (kategorierIFilter === repo) return;
  if (REPON[repo].privat && !tokenRackerForRepo()) return;
  try {
    const data = await api("/categories");
    const val = $("filter-kategori");
    val.length = 1;
    for (const k of data.data.repository.discussionCategories.nodes) val.append(new Option(k.name, k.id));
    kategorierIFilter = repo;
  } catch (fel) {
    sattStatus($("status"), `Kunde inte hämta kategorier: ${fel.message}`, true);
  }
}

async function hamtaDiskussioner(fler = false) {
  const status = $("status");
  const lista = $("lista");
  if (!fler) {
    lista.innerHTML = "";
    listaCursor = null;
  }
  $("lista-fler").hidden = true;

  if (REPON[repo].privat && !tokenRackerForRepo()) {
    sattStatus(status, "Logga in för att läsa det privata repot.");
    return;
  }
  sattStatus(status, "Hämtar diskussioner…");
  try {
    const data = await api(listSokvag(fler ? listaCursor : null));
    // Sökning ger data.search, vanlig lista data.repository.discussions
    const r = data.data.repository ?? { discussions: { nodes: data.data.search.nodes, totalCount: data.data.search.discussionCount } };
    if (r.viewerPermission) visaRoll(r.viewerPermission);
    const diskussioner = r.discussions.nodes;
    if (diskussioner.length === 0 && !fler) {
      sattStatus(status, filter.q || filter.mina ? "Inga träffar." : "Inga diskussioner hittades.");
      $("hamtad-lista").textContent = `Hämtad ${klockan()}`;
      return;
    }
    const utanFilter = !filter.q && !filter.mina && !filter.kategori && !filter.status && !filter.sort && !filter.obesvarade;
    const fasta = new Set(utanFilter && !fler ? (r.pinnedDiscussions?.nodes ?? []).map((n) => n.discussion?.number) : []);
    const fastaRader = [];
    for (const d of diskussioner) {
      const li = document.createElement("li");
      const lank = document.createElement("a");
      lank.href = `#r/${repo}/d/${d.number}`;
      lank.textContent = d.title;
      const meta = document.createElement("span");
      meta.className = "meta";
      meta.textContent = `${d.author?.login ?? "okänd"} · ${datum(d.createdAt)} · ${d.category?.name ?? ""} · 💬 ${d.comments?.totalCount ?? 0}${d.upvoteCount ? ` · ▲ ${d.upvoteCount}` : ""} · senast ${relativ(d.updatedAt)}`;
      meta.title = `Senast ändrad ${new Date(d.updatedAt).toLocaleString("sv-SE")}`;
      const markor = pills(d);
      if (fasta.has(d.number)) {
        const p = document.createElement("span");
        p.className = "pill fast";
        p.textContent = "📌 fäst";
        markor.prepend(p);
        fastaRader.push(li);
      }
      if (arNytt("d", d)) markor.prepend(nyttMarke());
      li.append(lank, meta, markor);
      lista.append(li);
    }
    for (const li of fastaRader.reverse()) lista.prepend(li); // fästa trådar överst, som på GitHub
    $("hamtad-lista").textContent = `Hämtad ${klockan()}`;
    const sidor = r.discussions.pageInfo;
    listaCursor = sidor?.hasNextPage ? sidor.endCursor : null;
    $("lista-fler").hidden = !listaCursor;
    sattStatus(
      status,
      r.discussions.totalCount > lista.children.length
        ? `Visar ${lista.children.length} av ${r.discussions.totalCount} diskussioner.`
        : ""
    );
  } catch (fel) {
    sattStatus(status, `Kunde inte hämta diskussioner: ${fel.message}`, true);
    console.error(fel);
  }
}

function pills(d) {
  const p = document.createElement("span");
  p.className = "pills";
  const lagg = (text, klass) => {
    const s = document.createElement("span");
    s.className = `pill ${klass ?? ""}`;
    s.textContent = text;
    p.append(s);
  };
  if ((d.labels?.nodes ?? []).some((l) => l.name === "beslut")) lagg("beslut", "beslut");
  if (d.isAnswered) lagg("besvarad", "svar");
  if (d.closed) lagg(d.stateReason ? `stängd (${d.stateReason.toLowerCase()})` : "stängd", "stangd");
  if (d.locked) lagg("låst", "last");
  return p;
}

// ------------------------------------------------------------ detalj

function knapp(text, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = text;
  b.addEventListener("click", onClick);
  return b;
}

// Radering bekräftas med ett andra klick (inga webbläsardialoger).
function bekraftaKnapp(text, onConfirm) {
  const b = knapp(text, () => {
    if (b.dataset.armerad !== "1") {
      b.dataset.armerad = "1";
      b.textContent = "Klicka igen för att radera";
      setTimeout(() => {
        b.dataset.armerad = "";
        b.textContent = text;
      }, 4000);
      return;
    }
    onConfirm();
  });
  return b;
}

async function visaDetalj(nummer, kommentarId = null) {
  aktuelltNummer = nummer;
  avbrytSvar();
  $("redigera-formular").hidden = true;
  $("vy-lista").hidden = true;
  $("vy-arenden").hidden = true;
  $("vy-arende").hidden = true;
  $("vy-oversikt").hidden = true;
  $("vy-detalj").hidden = false;
  markeraTyp("d");

  const status = $("detalj-status");
  sattStatus(status, "Hämtar…");
  sattStatus(statusYta(), "");

  if (REPON[repo].privat && !tokenRackerForRepo()) {
    sattStatus(status, "Logga in för att läsa det privata repot.");
    return;
  }

  try {
    const data = await api(`/discussions/${nummer}`);
    const r = data.data.repository;
    const d = r.discussion;
    if (!d) throw new Error("hittades inte");
    aktuellDiskussion = d;
    if (r.viewerPermission) visaRoll(r.viewerPermission);

    sattStatus(status, "");
    $("detalj-titel").textContent = d.title;
    $("detalj-meta").textContent = `${d.author?.login ?? "okänd"} · ${datum(d.createdAt)} · ${d.category?.name ?? ""}`;
    const pillsEl = $("detalj-pills");
    pillsEl.replaceWith(Object.assign(pills(d), { id: "detalj-pills" }));
    sattMarkdown($("detalj-text"), d.bodyHTML, d.bodyText);
    markeraSedd("d", nummer);
    aterstallUtkast($("kommentar-text"));
    byggSvarsruta(d);
    byggBanner($("detalj-banner"), d);
    byggOmrostning(d);
    $("skapa-arende").hidden = !tokenRackerForRepo();
    byggReaktioner($("detalj-reaktioner"), d.id, d.reactionGroups, d.viewerHasReactions, Boolean(d.viewerCanReact));
    for (const gammal of $("detalj-reaktioner").querySelectorAll(".upprost")) gammal.remove();
    const upp = upprostaKnapp(d.id, d.upvoteCount, d.viewerHasUpvoted, Boolean(d.viewerCanUpvote));
    if (upp) $("detalj-reaktioner").append(upp);
    const rm = $("detalj-redigerad");
    rm.innerHTML = "";
    const marke = redigeratMarke(d, d.id);
    if (marke) rm.append(marke);
    byggLabels($("detalj-labels"), d.id, d.labels?.nodes ?? [], Boolean(d.viewerCanLabel), () => visaDetalj(nummer));
    $("oppna-github").href = d.url;
    $("hjalptext").textContent = hjalptext(d, r.viewerPermission);
    $("hamtad-detalj").textContent = `Hämtad ${klockan()}`;

    byggAtgarder(d, r.viewerPermission);
    byggKommentarer(d);
    $("kommentar-formular").hidden = !tokenRackerForRepo();
    visaBehorigheter(d, r.viewerPermission);
    if (kommentarId) {
      const mal = document.getElementById(`c-${kommentarId}`);
      if (mal) {
        mal.classList.add("markerad");
        mal.scrollIntoView({ block: "center" });
      } else {
        sattStatus(status, "Kommentaren finns inte på den här sidan (den kan vara raderad eller ligga bland fler kommentarer).");
      }
    }
  } catch (fel) {
    sattStatus(status, `Kunde inte hämta diskussionen: ${fel.message}`, true);
    console.error(fel);
  }
}

// Knapparna styrs av GitHubs egna fält (viewerCan*). Två undantag där GitHub
// inte har något viewerCan-fält: "Märk som beslut" (Write eller högre, enligt
// uppdraget) och "Lås" (GitHub kräver Write).
function byggAtgarder(d, roll) {
  const rad = $("detalj-atgarder");
  rad.innerHTML = "";
  const harWrite = WRITE_ELLER_HOGRE.includes(roll);
  const arBeslut = (d.labels?.nodes ?? []).some((l) => l.name === "beslut");

  if (d.viewerCanUpdate) rad.append(knapp("Redigera", startaRedigering));
  if (d.viewerCanUpdate) {
    const bk = knapp("Byt kategori", async () => {
      bk.disabled = true;
      try {
        const data = await api("/categories");
        const sel = document.createElement("select");
        sel.setAttribute("aria-label", "Ny kategori");
        for (const k of data.data.repository.discussionCategories.nodes) {
          if (k.name !== d.category?.name) sel.append(new Option(k.name, k.id));
        }
        bk.replaceWith(sel, knapp("Flytta", () => anropa(`/discussions/${d.number}`, "PATCH", { categoryId: sel.value }, () => visaDetalj(d.number))));
      } catch (fel) {
        bk.disabled = false;
        sattStatus(statusYta(), `Kunde inte hämta kategorier: ${fel.message}`, true);
      }
    });
    rad.append(bk);
  }
  if (d.viewerCanDelete) rad.append(bekraftaKnapp("Radera", raderaDiskussion));
  if (d.viewerCanClose && !d.closed) {
    const orsak = document.createElement("select");
    orsak.id = "stang-orsak";
    orsak.setAttribute("aria-label", "Orsak");
    for (const [v, t] of [["RESOLVED", "löst"], ["OUTDATED", "föråldrad"], ["DUPLICATE", "dubblett"]]) {
      orsak.append(new Option(t, v));
    }
    rad.append(orsak, knapp("Stäng tråd", () => stangTrad(orsak.value)));
  }
  if (d.viewerCanReopen && d.closed) rad.append(knapp("Öppna igen", () => atgard("reopen")));
  if (harWrite && !d.locked) rad.append(knapp("Lås tråd", () => atgard("lock")));
  if (harWrite && d.locked) rad.append(knapp("Lås upp", () => atgard("unlock")));
  if (d.viewerCanLabel && harWrite && !arBeslut) {
    rad.append(knapp("Märk som beslut", markeraSomBeslut));
  }
}

let kommentarCursor = null;
let hamtadeKommentarer = 0;

// Svaret på en fråga visas överst, med en länk till kommentaren.
function byggSvarsruta(d) {
  const ruta = $("detalj-svar");
  ruta.hidden = true;
  ruta.innerHTML = "";
  if (!d.answer) return;
  const rubrik = document.createElement("strong");
  rubrik.textContent = `✔ Svar av ${d.answer.author?.login ?? "okänd"}`;
  const text = document.createElement("div");
  text.className = "markdown";
  sattMarkdown(text, d.answer.bodyHTML, d.answer.bodyText);
  ruta.append(rubrik, text);
  const mal = () => document.getElementById(`c-${d.answer.id}`);
  const hit = knapp("Gå till svaret", () => {
    const m = mal();
    if (m) {
      m.classList.add("markerad");
      m.scrollIntoView({ block: "center" });
    } else {
      sattStatus($("detalj-status"), "Svaret ligger bland kommentarer som inte är hämtade än.");
    }
  });
  ruta.append(hit);
  ruta.hidden = false;
}

function byggKommentarer(d, fler = false) {
  const ul = $("detalj-kommentarer");
  const noder = [...(d.comments?.nodes ?? [])];
  if (!fler && $("kommentar-ordning").value === "nyast") noder.reverse();
  if (!fler) {
    ul.innerHTML = "";
    hamtadeKommentarer = 0;
    if (noder.length === 0) {
      const li = document.createElement("li");
      li.textContent = "Inga kommentarer än.";
      ul.append(li);
    }
  }
  hamtadeKommentarer += noder.length;
  for (const k of noder) {
    const li = kommentarRad(k, true);
    const svar = k.replies?.nodes ?? [];
    if (svar.length) {
      const sub = document.createElement("ul");
      sub.className = "svar";
      for (const s of svar) sub.append(kommentarRad(s, false, k.id));
      li.append(sub);
      laggTillFlerSvar(li, sub, k);
      const vik = knapp(`Dölj svar (${k.replies.totalCount ?? svar.length})`, () => {
        const dold = sub.hidden = !sub.hidden;
        vik.textContent = dold ? `Visa svar (${k.replies.totalCount ?? svar.length})` : `Dölj svar (${k.replies.totalCount ?? svar.length})`;
      });
      vik.className = "liten vik";
      li.querySelector(".atgarder")?.append(vik);
    }
    ul.append(li);
  }
  const sidor = d.comments?.pageInfo;
  kommentarCursor = sidor?.hasNextPage ? sidor.endCursor : null;
  const kn = $("kommentarer-fler");
  kn.hidden = !kommentarCursor;
  kn.textContent = `Visa fler kommentarer (${(d.comments?.totalCount ?? 0) - hamtadeKommentarer} kvar)`;
}

async function hamtaFlerKommentarer() {
  if (!kommentarCursor) return;
  const status = $("detalj-status");
  try {
    const data = await api(
      `/discussions/${aktuelltNummer}?commentsAfter=${encodeURIComponent(kommentarCursor)}`
    );
    byggKommentarer(data.data.repository.discussion, true);
  } catch (fel) {
    sattStatus(status, `Kunde inte hämta fler kommentarer: ${fel.message}`, true);
  }
}

// Fler svar under en kommentar (GitHub ger de första 30 direkt).
function laggTillFlerSvar(li, sub, k) {
  let cursor = k.replies.pageInfo?.hasNextPage ? k.replies.pageInfo.endCursor : null;
  let hamtade = k.replies.nodes.length;
  if (!cursor) return;
  const kn = knapp("", async () => {
    try {
      const data = await api(`/comments/${encodeURIComponent(k.id)}/replies?after=${encodeURIComponent(cursor)}`);
      const r = data.data.replies;
      for (const s of r.nodes) sub.append(kommentarRad(s, false, k.id));
      hamtade += r.nodes.length;
      cursor = r.pageInfo.hasNextPage ? r.pageInfo.endCursor : null;
      if (cursor) uppdatera(r.totalCount);
      else kn.remove();
    } catch (fel) {
      sattStatus($("detalj-status"), `Kunde inte hämta fler svar: ${fel.message}`, true);
    }
  });
  const uppdatera = (total) => {
    kn.textContent = `Visa fler svar (${total - hamtade} kvar)`;
  };
  uppdatera(k.replies.totalCount);
  li.append(kn);
}

function kommentarRad(k, toppniva, foralderId) {
  let kommentarEfter = null;
  const li = document.createElement("li");
  li.id = `c-${k.id}`;
  if (k.isAnswer) li.className = "svar-markerat";
  const meta = document.createElement("span");
  meta.className = "meta";
  meta.textContent = `${k.author?.login ?? "okänd"} · ${datum(k.createdAt)}${k.isAnswer ? " · markerat som svar" : ""}`;
  const text = document.createElement("div");
  text.className = "markdown";
  if (k.deletedAt) text.textContent = "(borttagen)";
  else sattMarkdown(text, k.bodyHTML, k.bodyText);
  const rad = document.createElement("div");
  rad.className = "atgarder";

  if (hamtaToken() && tokenRackerForRepo() && !k.deletedAt) {
    rad.append(
      knapp("Svara", () => svaraPaKommentar(foralderId ?? k.id, k.author?.login))
    );
  }
  if (hamtaToken() && tokenRackerForRepo() && !k.deletedAt) {
    rad.append(knapp("Citera", () => citera($("kommentar-text"), k.author?.login, k.body)));
  }
  if (k.viewerCanMarkAsAnswer && !k.isAnswer) {
    rad.append(knapp("Markera som svar", () => kommentarAtgard(k.id, "answer")));
  }
  if (k.viewerCanUnmarkAsAnswer && k.isAnswer) {
    rad.append(knapp("Ta bort svarsmarkering", () => kommentarAtgard(k.id, "unanswer")));
  }
  if (k.viewerCanUpdate) {
    rad.append(knapp("Redigera", () => redigeraKommentar(li, k)));
  }
  if (k.viewerCanDelete) {
    rad.append(bekraftaKnapp("Radera", () => raderaKommentar(k.id)));
  }
  const reaktioner = document.createElement("div");
  reaktioner.className = "reaktioner";
  if (!k.deletedAt) {
    byggReaktioner(reaktioner, k.id, k.reactionGroups, k.viewerHasReactions, Boolean(k.viewerCanReact));
    const upp = upprostaKnapp(k.id, k.upvoteCount, k.viewerHasUpvoted, Boolean(k.viewerCanUpvote));
    if (upp) reaktioner.append(upp);
    kommentarEfter = () => visaDetalj(aktuelltNummer);
    rad.append(knapp("Länk", () => kopieraLank(trådLank(aktuelltNummer, k.id), $("detalj-status"))));
  }
  const marke = k.deletedAt ? null : redigeratMarke(k, k.id);
  li.append(meta);
  if (marke) li.append(marke);
  li.append(text, reaktioner, rad);
  if (!k.deletedAt) doljKomponenter(k, text, rad, kommentarEfter);
  return li;
}

function visaBehorigheter(d, roll, mal = $("behorigheter")) {
  // Flaggor (sant eller falskt) per objekt. Reaktionslistan visas kort som "vilka du själv lagt".
  const flaggorFran = (objekt) => {
    const f = {};
    for (const [nyckel, varde] of Object.entries(objekt)) {
      if (!nyckel.startsWith("viewer")) continue;
      if (nyckel === "viewerHasReactions") {
        f.viewerHarReagerat = (varde ?? []).filter((g) => g.viewerHasReacted).map((g) => g.content);
      } else {
        f[nyckel] = varde;
      }
    }
    return f;
  };
  const kommentarer = [];
  const samla = (k) => kommentarer.push({ forfattare: k.author?.login ?? null, ...flaggorFran(k) });
  for (const k of d.comments?.nodes ?? []) {
    samla(k);
    for (const s of k.replies?.nodes ?? []) samla(s);
  }
  mal.textContent = JSON.stringify(
    { viewerPermission: roll ?? "(ej inloggad)", discussion: flaggorFran(d), kommentarer },
    null,
    2
  );
}

// ------------------------------------------------------------ åtgärder

async function kor(fn, statusEl = statusYta()) {
  sattStatus(statusEl, "Arbetar…");
  try {
    await fn();
    sattStatus(statusEl, "");
    await visaDetalj(aktuelltNummer);
  } catch (fel) {
    sattStatus(statusEl, `Misslyckades: ${fel.message}`, true);
    console.error(fel);
  }
}

function markeraSomBeslut() {
  return kor(() => api(`/discussions/${aktuelltNummer}/beslut`, { method: "POST" }));
}

function atgard(namn) {
  return kor(() => api(`/discussions/${aktuelltNummer}/${namn}`, { method: "POST" }));
}

function stangTrad(orsak) {
  return kor(() =>
    api(`/discussions/${aktuelltNummer}/close`, { method: "POST", body: { reason: orsak } })
  );
}

async function raderaDiskussion() {
  const status = statusYta();
  sattStatus(status, "Arbetar…");
  try {
    await api(`/discussions/${aktuelltNummer}`, { method: "DELETE" });
    history.pushState(null, "", `#r/${repo}`);
    await hanteraRoutning();
  } catch (fel) {
    sattStatus(status, `Misslyckades: ${fel.message}`, true);
    console.error(fel);
  }
}

function startaRedigering() {
  $("redigera-titel").value = aktuellDiskussion.title;
  $("redigera-text").value = aktuellDiskussion.body;
  $("redigera-formular").hidden = false;
}

async function sparaRedigering(event) {
  event.preventDefault();
  await kor(async () => {
    await api(`/discussions/${aktuelltNummer}`, {
      method: "PATCH",
      body: { title: $("redigera-titel").value.trim(), body: $("redigera-text").value.trim() },
    });
    $("redigera-formular").hidden = true;
  });
}

function kommentarAtgard(id, namn) {
  return kor(() => api(`/comments/${encodeURIComponent(id)}/${namn}`, { method: "POST" }));
}

function raderaKommentar(id) {
  return kor(() => api(`/comments/${encodeURIComponent(id)}`, { method: "DELETE" }));
}

function redigeraKommentar(li, k) {
  const form = document.createElement("form");
  const ta = document.createElement("textarea");
  ta.value = k.body;
  ta.required = true;
  setTimeout(() => medForhandsvisning(ta), 0);
  const spara = document.createElement("button");
  spara.type = "submit";
  spara.textContent = "Spara";
  const avbryt = knapp("Avbryt", () => form.remove());
  form.append(ta, spara, avbryt);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    kor(() =>
      api(`/comments/${encodeURIComponent(k.id)}`, {
        method: "PATCH",
        body: { body: ta.value.trim() },
      })
    );
  });
  li.append(form);
  ta.focus();
}

// ------------------------------------------------------------ svara, kommentera, skapa

function svaraPaKommentar(kommentarId, forfattare) {
  svararPaKommentarId = kommentarId;
  const svararPa = $("svarar-pa");
  svararPa.hidden = false;
  svararPa.firstChild.textContent = `Svarar på kommentar av ${forfattare ?? "okänd"} `;
  $("kommentar-text").focus();
}

function avbrytSvar() {
  svararPaKommentarId = null;
  $("svarar-pa").hidden = true;
}

async function skickaKommentar(event) {
  event.preventDefault();
  const status = $("kommentar-status");
  sattStatus(status, "Skickar…");
  try {
    await api(`/discussions/${aktuelltNummer}/comments`, {
      method: "POST",
      inloggad: true,
      body: { body: $("kommentar-text").value.trim(), replyToId: svararPaKommentarId },
    });
    sattStatus(status, "Kommentaren skickad!");
    tomtFalt($("kommentar-text"));
    avbrytSvar();
    await visaDetalj(aktuelltNummer);
  } catch (fel) {
    sattStatus(status, `Kunde inte skicka kommentaren: ${fel.message}`, true);
    console.error(fel);
  }
}

async function skapaDiskussion(event) {
  event.preventDefault();
  const status = $("skapa-status");
  sattStatus(status, "Skapar…");
  try {
    await api("/discussions", {
      method: "POST",
      inloggad: true,
      body: {
        categoryId: $("ny-kategori").value,
        title: $("ny-titel").value.trim(),
        body: $("ny-text").value.trim(),
      },
    });
    sattStatus(status, "Diskussionen skapad!");
    tomtFalt($("ny-titel"));
    tomtFalt($("ny-text"));
    await hamtaDiskussioner();
  } catch (fel) {
    sattStatus(status, `Kunde inte skapa diskussionen: ${fel.message}`, true);
    console.error(fel);
  }
}

// ------------------------------------------------------------ routning

function visaListVy() {
  $("vy-detalj").hidden = true;
  $("vy-arenden").hidden = true;
  $("vy-arende").hidden = true;
  $("vy-oversikt").hidden = true;
  $("vy-lista").hidden = false;
  markeraTyp("d");
}

function markeraTyp(typ) {
  for (const a of document.querySelectorAll("#typ-val a")) {
    a.classList.toggle("aktiv", a.dataset.typ === typ);
    a.href = a.dataset.typ === "i" ? `#r/${repo}/i` : a.dataset.typ === "o" ? `#r/${repo}/o` : a.dataset.typ === "w" ? `#r/${repo}/w` : `#r/${repo}`;
  }
}

// Filter och sökning ligger i adressen efter ?, till exempel #r/1?q=ord&status=open.
function hashUtanFraga() {
  return location.hash.split("?")[0];
}
function hashFraga() {
  return new URLSearchParams(location.hash.includes("?") ? location.hash.split("?")[1] : "");
}

function lasRoute() {
  // #r/<repo>            lista
  // #r/<repo>/d/<n>      detalj
  // #d/<n>               (gammal form, standardrepot)
  let m = hashUtanFraga().match(/^#r\/([\w-]+)\/o$/);
  if (m && REPON[m[1]]) return { repo: m[1], typ: "o", nummer: null, kommentar: null };
  m = hashUtanFraga().match(/^#r\/([\w-]+)\/w(?:\/((?:ord|kategori):[a-z0-9-]{1,80}))?$/);
  if (m && REPON[m[1]]) return { repo: m[1], typ: "w", nummer: null, kommentar: null, nyckel: m[2] ?? null };
  m = hashUtanFraga().match(/^#r\/([\w-]+)\/i(?:\/(\d+)(?:\/c\/([\w-]+))?)?$/);
  if (m && REPON[m[1]]) {
    return { repo: m[1], typ: "i", nummer: m[2] ? Number(m[2]) : null, kommentar: m[3] ?? null };
  }
  m = hashUtanFraga().match(/^#r\/([\w-]+)(?:\/d\/(\d+)(?:\/c\/([\w-]+))?)?$/);
  if (m && REPON[m[1]]) {
    return { repo: m[1], typ: "d", nummer: m[2] ? Number(m[2]) : null, kommentar: m[3] ?? null };
  }
  m = hashUtanFraga().match(/^#d\/(\d+)$/);
  if (m) return { repo: STANDARD_REPO, typ: "d", nummer: Number(m[1]) };
  return { repo: repo, typ: "d", nummer: null };
}

async function hanteraRoutning() {
  const route = lasRoute();
  const bytteRepo = route.repo !== repo;
  repo = route.repo;
  for (const a of document.querySelectorAll("#repo-val a")) {
    a.classList.toggle("aktiv", a.dataset.repo === repo);
  }
  if (bytteRepo) {
    visaRoll(null);
    nollstallFilter();
    kategorierIFilter = null;
    $("filter-kategori").length = 1;
  }
  await uppdateraInloggning();
  $("vy-ord").hidden = true;
  if (route.typ === "w") {
    if (route.nyckel) visaOrd(route.nyckel);
    else visaOrdLista();
  } else if (route.typ === "o") {
    visaOversikt();
  } else if (route.typ === "i") {
    if (route.nummer) visaArende(route.nummer, route.kommentar ?? null);
    else visaArendeLista();
  } else if (route.nummer) {
    visaDetalj(route.nummer, route.kommentar ?? null);
  } else {
    visaListVy();
    hamtaKategorier();
    await tillampaFilterFranAdress();
    hamtaDiskussioner();
  }
}

function filterTillAdress() {
  const p = new URLSearchParams();
  if (filter.q) p.set("q", filter.q);
  if (filter.mina) p.set("mina", "1");
  if (filter.kategori) p.set("kat", filter.kategori);
  if (filter.status) p.set("status", filter.status);
  if (filter.sort) p.set("sort", filter.sort);
  if (filter.obesvarade) p.set("obes", "1");
  const q = p.toString();
  return `#r/${repo}${q ? `?${q}` : ""}`;
}

async function tillampaFilterFranAdress() {
  const p = hashFraga();
  const harFilter = [...p.keys()].length > 0;
  nollstallFilter();
  if (!harFilter) return;
  $("filter-ruta").open = true;
  if (p.get("kat")) await fyllFilterKategorier();
  $("sok-text").value = p.get("q") ?? "";
  $("filter-kategori").value = p.get("kat") ?? "";
  $("filter-status").value = p.get("status") ?? "";
  $("filter-sort").value = p.get("sort") ?? "";
  $("filter-obesvarade").checked = p.get("obes") === "1";
  lasFilter();
  filter.mina = p.get("mina") === "1";
}

// Sätter adressen efter filtret. Är den redan lika hämtas listan direkt, annars gör hashchange det.
function valjFilter() {
  const mal = filterTillAdress();
  if (location.hash === mal) hamtaDiskussioner();
  else location.hash = mal;
}

function init() {
  const franUrl = lasTokenFranUrl();
  if (franUrl?.token) {
    sparaToken(franUrl.token, franUrl.scope);
    const mal = REPON[franUrl.repo] ? franUrl.repo : STANDARD_REPO;
    history.replaceState(null, "", `${location.pathname}${location.search}#r/${mal}`);
  }

  $("logga-in-knapp").addEventListener("click", () => {
    const tillbaka = location.origin + location.pathname;
    location.href = `${WORKER_URL}/login?repo=${encodeURIComponent(repo)}&return=${encodeURIComponent(tillbaka)}`;
  });
  $("logga-ut-knapp").addEventListener("click", () => {
    rensaToken();
    visaRoll(null);
    hanteraRoutning();
  });
  $("ny-diskussion-formular").addEventListener("submit", skapaDiskussion);
  $("tillbaka-knapp").addEventListener("click", () => {
    history.pushState(null, "", `#r/${repo}`);
    hanteraRoutning();
  });
  $("kommentar-formular").addEventListener("submit", skickaKommentar);
  $("lista-fler").addEventListener("click", () => hamtaDiskussioner(true));
  $("filter-ruta").addEventListener("toggle", () => {
    if ($("filter-ruta").open) fyllFilterKategorier();
  });
  $("filter-formular").addEventListener("submit", (e) => {
    e.preventDefault();
    lasFilter();
    valjFilter();
  });
  $("filter-rensa").addEventListener("click", () => {
    nollstallFilter();
    valjFilter();
  });
  $("filter-mina").addEventListener("click", () => {
    nollstallFilter();
    filter.mina = true;
    valjFilter();
  });
  $("kopiera-lank").addEventListener("click", () =>
    kopieraLank(trådLank(aktuelltNummer), $("detalj-status"))
  );
  $("uppdatera-lista").addEventListener("click", () => hamtaDiskussioner());
  $("uppdatera-detalj").addEventListener("click", () => visaDetalj(aktuelltNummer));
  $("kommentarer-fler").addEventListener("click", hamtaFlerKommentarer);
  $("avbryt-svar-knapp").addEventListener("click", avbrytSvar);
  $("redigera-formular").addEventListener("submit", sparaRedigering);
  $("redigera-avbryt").addEventListener("click", () => {
    $("redigera-formular").hidden = true;
  });
  for (const id of ["ny-text", "kommentar-text", "redigera-text"]) medForhandsvisning($(id));
  initArenden();
  initOrd();
  initExtra();
  window.addEventListener("hashchange", hanteraRoutning);

  hanteraRoutning();
}

init();
