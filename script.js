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
function klockan() {
  return new Date().toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
}

function visaRoll(roll) {
  aktuellRoll = roll ?? null;
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
  mal.innerHTML = "";
  const harReagerat = Object.fromEntries((egna ?? []).map((g) => [g.content, g.viewerHasReacted]));
  const antal = Object.fromEntries((grupper ?? []).map((g) => [g.content, g.reactors.totalCount]));
  for (const innehall of Object.keys(EMOJI)) {
    const n = antal[innehall] ?? 0;
    if (!kan && n === 0) continue;
    const b = document.createElement("button");
    b.type = "button";
    b.disabled = !kan;
    b.className = `${harReagerat[innehall] ? "aktiv" : ""} ${n === 0 ? "noll" : ""}`.trim();
    b.textContent = `${EMOJI[innehall]} ${n}`;
    b.setAttribute("aria-pressed", String(Boolean(harReagerat[innehall])));
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
        sattStatus($("atgard-status"), `Kunde inte reagera: ${fel.message}`, true);
      }
    });
    mal.append(b);
  }
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
    for (const d of diskussioner) {
      const li = document.createElement("li");
      const lank = document.createElement("a");
      lank.href = `#r/${repo}/d/${d.number}`;
      lank.textContent = d.title;
      const meta = document.createElement("span");
      meta.className = "meta";
      meta.textContent = `${d.author?.login ?? "okänd"} · ${datum(d.createdAt)} · ${d.category?.name ?? ""}`;
      li.append(lank, meta, pills(d));
      lista.append(li);
    }
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
  $("vy-detalj").hidden = false;

  const status = $("detalj-status");
  sattStatus(status, "Hämtar…");
  sattStatus($("atgard-status"), "");

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
    byggReaktioner($("detalj-reaktioner"), d.id, d.reactionGroups, d.viewerHasReactions, Boolean(d.viewerCanReact));
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

function byggKommentarer(d, fler = false) {
  const ul = $("detalj-kommentarer");
  const noder = d.comments?.nodes ?? [];
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
    rad.append(knapp("Länk", () => kopieraLank(trådLank(aktuelltNummer, k.id), $("detalj-status"))));
  }
  li.append(meta, text, reaktioner, rad);
  return li;
}

function visaBehorigheter(d, roll) {
  const flaggor = {};
  for (const [nyckel, varde] of Object.entries(d)) {
    if (nyckel.startsWith("viewer")) flaggor[nyckel] = varde;
  }
  const kommentarer = [];
  const samla = (k) => {
    const f = { forfattare: k.author?.login ?? null };
    for (const [nyckel, varde] of Object.entries(k)) {
      if (nyckel.startsWith("viewer")) f[nyckel] = varde;
    }
    kommentarer.push(f);
  };
  for (const k of d.comments?.nodes ?? []) {
    samla(k);
    for (const s of k.replies?.nodes ?? []) samla(s);
  }
  $("behorigheter").textContent = JSON.stringify(
    { viewerPermission: roll ?? "(ej inloggad)", discussion: flaggor, kommentarer },
    null,
    2
  );
}

// ------------------------------------------------------------ åtgärder

async function kor(fn, statusEl = $("atgard-status")) {
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
  const status = $("atgard-status");
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
    $("kommentar-text").value = "";
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
    $("ny-titel").value = "";
    $("ny-text").value = "";
    await hamtaDiskussioner();
  } catch (fel) {
    sattStatus(status, `Kunde inte skapa diskussionen: ${fel.message}`, true);
    console.error(fel);
  }
}

// ------------------------------------------------------------ routning

function visaListVy() {
  $("vy-detalj").hidden = true;
  $("vy-lista").hidden = false;
}

function lasRoute() {
  // #r/<repo>            lista
  // #r/<repo>/d/<n>      detalj
  // #d/<n>               (gammal form, standardrepot)
  let m = location.hash.match(/^#r\/([\w-]+)(?:\/d\/(\d+)(?:\/c\/([\w-]+))?)?$/);
  if (m && REPON[m[1]]) {
    return { repo: m[1], nummer: m[2] ? Number(m[2]) : null, kommentar: m[3] ?? null };
  }
  m = location.hash.match(/^#d\/(\d+)$/);
  if (m) return { repo: STANDARD_REPO, nummer: Number(m[1]) };
  return { repo: repo, nummer: null };
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
  if (route.nummer) {
    visaDetalj(route.nummer, route.kommentar ?? null);
  } else {
    visaListVy();
    hamtaKategorier();
    hamtaDiskussioner();
  }
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
    hamtaDiskussioner();
  });
  $("filter-rensa").addEventListener("click", () => {
    nollstallFilter();
    hamtaDiskussioner();
  });
  $("filter-mina").addEventListener("click", () => {
    nollstallFilter();
    filter.mina = true;
    hamtaDiskussioner();
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
  window.addEventListener("hashchange", hanteraRoutning);

  hanteraRoutning();
}

init();
