// Fler funktioner som bygger på samma idé: GitHub är sanningen, sidan är en andra ingång.
// Nytt sedan sist, utkast, omnämnanden, export, översikt och tangentbordsgenvägar.

// ------------------------------------------------------------ lagring i webbläsaren (får saknas)

function lagraLas(nyckel) {
  try {
    return localStorage.getItem(nyckel);
  } catch {
    return null;
  }
}
function lagraSkriv(nyckel, varde) {
  try {
    if (varde === null) localStorage.removeItem(nyckel);
    else localStorage.setItem(nyckel, varde);
  } catch {
    /* privat läge eller blockerad lagring: funktionen utebliver */
  }
}

// ------------------------------------------------------------ nytt sedan sist

// Bara i den här webbläsaren. ”Nytt” betyder ändrat efter att du senast öppnade tråden,
// eller (om du aldrig öppnat den) efter ditt första besök här.
function seddNyckel(typ, nummer) {
  return `sdo-sedd|${repo}|${typ}|${nummer}`;
}
function baslinje() {
  const nyckel = `sdo-bas|${repo}`;
  let b = lagraLas(nyckel);
  if (!b) {
    b = new Date().toISOString();
    lagraSkriv(nyckel, b);
  }
  return b;
}
function markeraSedd(typ, nummer) {
  lagraSkriv(seddNyckel(typ, nummer), new Date().toISOString());
}
function arNytt(typ, objekt) {
  if (!objekt.updatedAt) return false;
  const sedd = lagraLas(seddNyckel(typ, objekt.number)) ?? baslinje();
  return new Date(objekt.updatedAt) > new Date(sedd);
}
function markeraAllaLasta() {
  lagraSkriv(`sdo-bas|${repo}`, new Date().toISOString());
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k?.startsWith(`sdo-sedd|${repo}|`)) lagraSkriv(k, null);
  }
}
function nyttMarke() {
  const s = document.createElement("span");
  s.className = "pill ny";
  s.textContent = "● nytt";
  return s;
}

// ------------------------------------------------------------ utkast

function utkastNyckel(el) {
  const kontext = el.id === "kommentar-text" ? aktuelltNummer : el.id === "arende-kommentar-text" ? arendeNr : "";
  return `sdo-utkast|${repo}|${el.id}|${kontext ?? ""}`;
}
function medUtkast(el) {
  if (!el || el.dataset.utkast) return;
  el.dataset.utkast = "1";
  el.addEventListener("input", () => lagraSkriv(utkastNyckel(el), el.value ? el.value : null));
}
function aterstallUtkast(el) {
  if (!el || el.value) return;
  const sparat = lagraLas(utkastNyckel(el));
  if (sparat) {
    el.value = sparat;
    el.title = "Sparat utkast från den här webbläsaren";
  }
}
function tomtFalt(el) {
  el.value = "";
  lagraSkriv(utkastNyckel(el), null);
}

// ------------------------------------------------------------ omnämnanden (@namn)

let omnamnbara = null; // { repo, anvandare: [{login, name}] }

async function hamtaOmnamnbara() {
  if (omnamnbara?.repo === repo) return omnamnbara.anvandare;
  if (!tokenRackerForRepo()) return [];
  try {
    const data = await api("/mentionable");
    omnamnbara = { repo, anvandare: data.data.repository.mentionableUsers.nodes };
    return omnamnbara.anvandare;
  } catch {
    return [];
  }
}

function medOmnamnanden(el) {
  if (!el || el.dataset.omnamn) return;
  el.dataset.omnamn = "1";
  const lista = document.createElement("ul");
  lista.className = "forslag";
  lista.hidden = true;
  lista.setAttribute("role", "listbox");
  el.after(lista);
  let valda = [];
  let index = 0;

  const dolj = () => {
    lista.hidden = true;
    valda = [];
  };
  const valj = (u) => {
    const fore = el.value.slice(0, el.selectionStart).replace(/@[A-Za-z0-9-]*$/, `@${u.login} `);
    const efter = el.value.slice(el.selectionStart);
    el.value = fore + efter;
    el.setSelectionRange(fore.length, fore.length);
    el.dispatchEvent(new Event("input"));
    dolj();
    el.focus();
  };
  const rita = () => {
    lista.innerHTML = "";
    valda.forEach((u, i) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(i === index));
      li.className = i === index ? "vald" : "";
      li.textContent = u.name ? `@${u.login} · ${u.name}` : `@${u.login}`;
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        valj(u);
      });
      lista.append(li);
    });
    lista.hidden = valda.length === 0;
  };

  el.addEventListener("input", async () => {
    const fore = el.value.slice(0, el.selectionStart);
    const m = /(?:^|\s)@([A-Za-z0-9-]{0,39})$/.exec(fore);
    if (!m) return dolj();
    const fras = m[1].toLowerCase();
    const alla = await hamtaOmnamnbara();
    valda = alla
      .filter((u) => u.login.toLowerCase().includes(fras) || (u.name ?? "").toLowerCase().includes(fras))
      .slice(0, 6);
    index = 0;
    rita();
  });
  el.addEventListener("keydown", (e) => {
    if (lista.hidden) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      index = (index + (e.key === "ArrowDown" ? 1 : valda.length - 1)) % valda.length;
      rita();
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      valj(valda[index]);
    } else if (e.key === "Escape") {
      dolj();
    }
  });
  el.addEventListener("blur", () => setTimeout(dolj, 150));
}

// ------------------------------------------------------------ export

function ladda(filnamn, text, typ) {
  const url = URL.createObjectURL(new Blob([text], { type: typ }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filnamn;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function dagens() {
  return new Date().toISOString().slice(0, 10);
}

// En tråd som Markdown-fil (det som hunnit hämtas: de första kommentarerna och svaren).
function traadSomMarkdown(d) {
  const rad = [`# ${d.title}`, "", `*${d.author?.login ?? "okänd"}, ${datum(d.createdAt)}, ${d.category?.name ?? ""}. ${d.url}*`, "", d.body ?? "", ""];
  const kommentar = (k, indrag) => {
    const pre = indrag ? "> " : "";
    rad.push(`${pre}**${k.author?.login ?? "okänd"}**, ${datum(k.createdAt)}${k.isAnswer ? " (markerat som svar)" : ""}`, `${pre}`);
    for (const r of (k.body ?? "").split("\n")) rad.push(`${pre}${r}`);
    rad.push("");
  };
  if ((d.comments?.nodes ?? []).length) rad.push("## Kommentarer", "");
  for (const k of d.comments?.nodes ?? []) {
    kommentar(k, false);
    for (const s of k.replies?.nodes ?? []) kommentar(s, true);
  }
  return rad.join("\n");
}

async function exporteraAllt() {
  const status = $("status");
  sattStatus(status, "Hämtar allt för säkerhetskopian…");
  try {
    const data = await api("/export", { inloggad: true });
    const fil = `sdo-${repo}-${dagens()}.json`;
    ladda(fil, JSON.stringify(data.data, null, 2), "application/json");
    sattStatus(
      status,
      `Sparade ${fil}: ${data.data.discussions.length} trådar och ${data.data.issues.length} ärenden${data.data.kompletta ? "" : " (inte alla: gränsen nåddes)"}.`
    );
  } catch (fel) {
    sattStatus(status, `Kunde inte göra säkerhetskopian: ${fel.message}`, true);
  }
}

// ------------------------------------------------------------ översikt

function visaOversiktSektion() {
  for (const s of ["vy-lista", "vy-detalj", "vy-arenden", "vy-arende"]) $(s).hidden = true;
  $("vy-oversikt").hidden = false;
  markeraTyp("o");
}

async function visaOversikt() {
  visaOversiktSektion();
  const status = $("oversikt-status");
  const inn = $("oversikt-innehall");
  inn.innerHTML = "";
  if (REPON[repo].privat && !tokenRackerForRepo()) {
    sattStatus(status, "Logga in för att se översikten för det privata repot.");
    return;
  }
  sattStatus(status, "Hämtar…");
  try {
    const data = (await api("/stats")).data;
    if (data.roll) visaRoll(data.roll);
    sattStatus(status, "");
    const bar = (rubrik, rader) => {
      const sek = document.createElement("section");
      const h = document.createElement("h3");
      h.textContent = rubrik;
      sek.append(h);
      const max = Math.max(1, ...rader.map((r) => r[1]));
      for (const [namn, antal, extra] of rader) {
        const rad = document.createElement("div");
        rad.className = "stapelrad";
        const t = document.createElement("span");
        t.textContent = namn;
        const stapel = document.createElement("span");
        stapel.className = "stapel";
        const fyll = document.createElement("span");
        fyll.style.width = `${(antal / max) * 100}%`;
        stapel.append(fyll);
        const n = document.createElement("span");
        n.textContent = extra ? `${antal} (${extra})` : String(antal);
        rad.append(t, stapel, n);
        sek.append(rad);
      }
      inn.append(sek);
    };
    const t = data.trådar;
    bar("Trådar", [["Alla", t.alla], ["Öppna", t.oppna], ["Stängda", t.stangda], ["Besvarade frågor", t.besvarade], ["Obesvarade frågor", t.obesvarade]]);
    bar("Per kategori", data.kategorier.filter((k) => k.antal > 0).map((k) => [k.namn, k.antal]));
    if (data.arenden) bar("Ärenden", [["Öppna", data.arenden.oppna], ["Stängda", data.arenden.stangda]]);
    else {
      const p = document.createElement("p");
      p.className = "status";
      p.textContent = "Logga in för att se antal ärenden.";
      inn.append(p);
    }
    bar("Flitigast (bland de 100 senast aktiva trådarna)", data.forfattare.map((f) => [f.namn, f.trådar, `${f.kommentarer} kommentarer`]));
  } catch (fel) {
    sattStatus(status, `Kunde inte hämta översikten: ${fel.message}`, true);
  }
}

// ------------------------------------------------------------ tangentbord och skärmläsare

function initExtra() {
  for (const el of document.querySelectorAll(".status")) {
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
  }
  for (const id of ["ny-titel", "ny-text", "kommentar-text", "arende-ny-titel", "arende-ny-text", "arende-kommentar-text"]) {
    medUtkast($(id));
    aterstallUtkast($(id));
  }
  for (const id of ["ny-text", "kommentar-text", "redigera-text", "arende-ny-text", "arende-kommentar-text", "arende-redigera-text"]) {
    medOmnamnanden($(id));
  }
  $("markera-lasta").addEventListener("click", () => {
    markeraAllaLasta();
    hamtaDiskussioner();
  });
  $("exportera-allt").addEventListener("click", exporteraAllt);
  $("exportera-trad").addEventListener("click", () => {
    if (!aktuellDiskussion) return;
    ladda(`trad-${repo}-${aktuellDiskussion.number}.md`, traadSomMarkdown(aktuellDiskussion), "text/markdown");
  });
  $("oversikt-uppdatera").addEventListener("click", visaOversikt);
  $("kommentar-ordning").addEventListener("change", () => {
    lagraSkriv("sdo-ordning", $("kommentar-ordning").value);
    if (aktuellDiskussion) byggKommentarer(aktuellDiskussion);
  });
  $("kommentar-ordning").value = lagraLas("sdo-ordning") ?? "aldst";

  document.addEventListener("keydown", (e) => {
    const t = e.target;
    if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable) return;
    if (e.key === "/" && !$("vy-lista").hidden) {
      e.preventDefault();
      $("filter-ruta").open = true;
      $("sok-text").focus();
    } else if (e.key === "u") {
      const knapp = [...document.querySelectorAll("#uppdatera-lista, #uppdatera-detalj, #arenden-uppdatera, #arende-uppdatera, #oversikt-uppdatera")].find((k) => k.offsetParent);
      knapp?.click();
    } else if (e.key === "?") {
      $("genvagar").hidden = !$("genvagar").hidden;
    } else if (e.key === "Escape") {
      $("genvagar").hidden = true;
    }
  });
}
