// Ordvyn (Fas 2, prototyp): flera trådar per ord, fällbara, med räknare och status.
// Trådarna hittas på nyckeln sist i titeln ("Rubrik (ord:sati)"). Inget i SDO:s data ändras.
// Statusarna (väntar, granskad, beslutad, avvisad) är vanliga labels. Reglerna för vem som får
// sätta dem kontrolleras av Workern och av GitHub, inte av den här filen.

const ORD_STATUS = ["väntar", "granskad", "beslutad", "avvisad"];
// Ord som får ha stor bokstav mitt i ett förslag (CLAUDE.md: Buddha, Dhamma, Saṅgha och egennamn).
const ORD_STORA_OK = new Set(["Buddha", "Dhamma", "Saṅgha", "Sangha", "Pāli", "Pali"]);

function ordNyckel(text) {
  const t = text.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return t ? `ord:${t.slice(0, 80)}` : "";
}

function visaOrdSektion() {
  for (const s of ["vy-lista", "vy-detalj", "vy-arenden", "vy-arende", "vy-oversikt"]) $(s).hidden = true;
  $("vy-ord").hidden = false;
  markeraTyp("w");
}

// Regeln från validera.py som går att kontrollera i sidan: stor bokstav mitt i ett förslag.
// Kontrollen är hjälp, inte skydd (CLAUDE.md och Fas 2.14).
function kontrolleraForslag(forslag) {
  const fel = [];
  if (!forslag.trim()) fel.push("Skriv det föreslagna ordet.");
  const delar = forslag.trim().split(/\s+/).filter(Boolean);
  delar.forEach((del, i) => {
    if (i > 0 && /^\p{Lu}/u.test(del) && !ORD_STORA_OK.has(del)) {
      fel.push(`”${del}”: stor bokstav mitt i förslaget är bara tillåten för Buddha, Dhamma, Saṅgha och egennamn.`);
    }
  });
  if (/\d/.test(forslag)) fel.push("Siffror hör inte hemma i ett föreslaget ord.");
  return fel;
}

function statusPill(t) {
  const s = document.createElement("span");
  s.className = `pill status-${t}`;
  s.textContent = t;
  return s;
}

function sammanfattning(trådar) {
  const antal = (f) => trådar.filter(f).length;
  const delar = [`${trådar.length} ${trådar.length === 1 ? "tråd" : "trådar"}`, `${antal((t) => !t.closed)} öppna`];
  for (const s of ORD_STATUS) {
    const n = antal((t) => t.status === s);
    if (n) delar.push(`${n} ${s}`);
  }
  const obes = antal((t) => !t.closed && t.category === "Kategori 2" && !t.isAnswered);
  if (obes) delar.push(obes === 1 ? "1 obesvarad fråga" : `${obes} obesvarade frågor`);
  return delar.join(" · ");
}

// ------------------------------------------------------------ ordlista

async function visaOrdLista() {
  visaOrdSektion();
  $("ord-lista-del").hidden = false;
  $("ord-ett-del").hidden = true;
  const status = $("ord-lista-status");
  const ul = $("ord-lista");
  ul.innerHTML = "";
  if (REPON[repo].privat && !tokenRackerForRepo()) {
    sattStatus(status, "Logga in för att se orden i det privata repot.");
    return;
  }
  sattStatus(status, "Hämtar…");
  visaVantarPaMig();
  try {
    const data = await api("/words");
    sattStatus(status, data.ord.length ? `${data.ord.length} ord med trådar (${data.totalt} trådar, hämtad ${klockan()}).` : "Inga ord har trådar än. Skriv ett ord ovan för att börja.");
    for (const w of data.ord) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = `#r/${repo}/w/${w.key}`;
      a.textContent = w.key.replace(/^ord:|^kategori:/, "");
      const meta = document.createElement("span");
      meta.className = "meta";
      const st = Object.entries(w.status).map(([k, v]) => `${v} ${k}`);
      meta.textContent = [`${w.trådar} ${w.trådar === 1 ? "tråd" : "trådar"}`, `${w.oppna} öppna`, ...st, w.beslut ? `${w.beslut} beslut` : "", `💬 ${w.kommentarer}`, `senast ${relativ(w.senast)}`].filter(Boolean).join(" · ");
      li.append(a, meta);
      ul.append(li);
    }
  } catch (fel) {
    sattStatus(status, `Kunde inte hämta orden: ${fel.message}`, true);
  }
}

// ------------------------------------------------------------ ett ord

async function visaOrd(key) {
  visaOrdSektion();
  $("ord-lista-del").hidden = true;
  $("ord-ett-del").hidden = false;
  $("ord-rubrik").textContent = key.replace(/^ord:/, "Ord: ").replace(/^kategori:/, "Kategori: ");
  $("ord-nyckel").textContent = key;
  const status = $("ord-status");
  const ul = $("ord-tradar");
  ul.innerHTML = "";
  $("ord-sammanfattning").textContent = "";
  $("ord-ny-formular").hidden = true;
  $("ord-ny-knapp").hidden = !tokenRackerForRepo();
  $("ord-ny-knapp").dataset.key = key;
  if (REPON[repo].privat && !tokenRackerForRepo()) {
    sattStatus(status, "Logga in för att läsa det privata repot.");
    return;
  }
  sattStatus(status, "Hämtar…");
  try {
    const data = await api(`/word?key=${encodeURIComponent(key)}`);
    $("ord-hamtad").textContent = `Hämtad ${klockan()}`;
    const t = data.trådar;
    sattStatus(status, t.length ? "" : "Inga trådar om det här ordet än.");
    $("ord-sammanfattning").textContent = t.length ? sammanfattning(t) : "";
    t.forEach((tr, i) => ul.append(trådDetails(tr, t.length === 1 && i === 0)));
  } catch (fel) {
    sattStatus(status, `Kunde inte hämta trådarna: ${fel.message}`, true);
  }
}

function trådDetails(t, oppen) {
  const li = document.createElement("li");
  const det = document.createElement("details");
  det.className = "ord-trad";
  const sum = document.createElement("summary");
  const titel = document.createElement("strong");
  titel.textContent = t.rubrik;
  const meta = document.createElement("span");
  meta.className = "meta";
  meta.textContent = ` #${t.number} · ${t.author ?? "okänd"} · ${datum(t.createdAt)} · ${t.category ?? ""} · 💬 ${t.comments}${t.upvoteCount ? ` · ▲ ${t.upvoteCount}` : ""}`;
  sum.append(titel, meta);
  const p = document.createElement("span");
  p.className = "pills";
  if (t.status) p.append(statusPill(t.status));
  if (t.beslut && t.status !== "beslutad") {
    const b = document.createElement("span");
    b.className = "pill beslut";
    b.textContent = "beslut";
    p.append(b);
  }
  if (t.isAnswered) {
    const b = document.createElement("span");
    b.className = "pill svar";
    b.textContent = "besvarad";
    p.append(b);
  }
  if (t.closed) {
    const b = document.createElement("span");
    b.className = "pill stangd";
    b.textContent = "stängd";
    p.append(b);
  }
  if (t.locked) {
    const b = document.createElement("span");
    b.className = "pill last";
    b.textContent = "låst";
    p.append(b);
  }
  sum.append(p);
  const inre = document.createElement("div");
  inre.className = "ord-inre";
  det.append(sum, inre);
  let laddad = false;
  const ladda = async () => {
    laddad = true;
    await fyllTrad(inre, t);
  };
  det.addEventListener("toggle", () => {
    if (det.open && !laddad) ladda();
  });
  li.append(det);
  if (oppen) {
    det.open = true;
  }
  return li;
}

async function fyllTrad(inre, t) {
  inre.innerHTML = "";
  const st = document.createElement("p");
  st.className = "status";
  st.textContent = "Hämtar…";
  inre.append(st);
  try {
    const data = await api(`/discussions/${t.number}`);
    const r = data.data.repository;
    const d = r.discussion;
    if (r.viewerPermission) visaRoll(r.viewerPermission);
    inre.innerHTML = "";

    const text = document.createElement("div");
    text.className = "markdown";
    sattMarkdown(text, d.bodyHTML, d.bodyText);
    const reakt = document.createElement("div");
    reakt.className = "reaktioner";
    inre.append(text, reakt);
    byggReaktioner(reakt, d.id, d.reactionGroups, d.viewerHasReactions, Boolean(d.viewerCanReact));

    const lank = document.createElement("p");
    const a = document.createElement("a");
    a.href = `#r/${repo}/d/${t.number}`;
    a.textContent = "Öppna hela tråden (alla funktioner)";
    lank.append(a);
    inre.append(lank);

    const ul = document.createElement("ul");
    ul.className = "ord-kommentarer";
    const noder = d.comments?.nodes ?? [];
    for (const k of noder) {
      const li = document.createElement("li");
      const rubrik = document.createElement("span");
      rubrik.className = "meta";
      rubrik.textContent = `${k.author?.login ?? "okänd"} · ${datum(k.createdAt)}${k.isAnswer ? " · ✔ svar" : ""}${k.replies?.totalCount ? ` · ${k.replies.totalCount} svar` : ""}`;
      const kt = document.createElement("div");
      kt.className = "markdown";
      sattMarkdown(kt, k.bodyHTML, k.bodyText);
      li.append(rubrik, kt);
      ul.append(li);
    }
    inre.append(ul);
    if ((d.comments?.totalCount ?? 0) > noder.length) {
      const mer = document.createElement("p");
      mer.className = "status";
      mer.textContent = `Visar ${noder.length} av ${d.comments.totalCount} kommentarer. Öppna hela tråden för resten.`;
      inre.append(mer);
    }

    // Svara direkt i den här tråden
    if (tokenRackerForRepo() && !d.locked) {
      const f = document.createElement("form");
      const ta = document.createElement("textarea");
      ta.required = true;
      ta.setAttribute("aria-label", `Svar i tråd ${t.number}`);
      ta.placeholder = "Skriv ett svar…";
      const sk = document.createElement("button");
      sk.type = "submit";
      sk.textContent = "Skicka svar";
      const s2 = document.createElement("p");
      s2.className = "status";
      f.append(ta, sk, s2);
      f.addEventListener("submit", async (e) => {
        e.preventDefault();
        sk.disabled = true;
        try {
          await api(`/discussions/${t.number}/comments`, { method: "POST", body: { body: ta.value }, inloggad: true });
          await fyllTrad(inre, { ...t, comments: t.comments + 1 });
        } catch (fel) {
          sattStatus(s2, `Misslyckades: ${fel.message}`, true);
          sk.disabled = false;
        }
      });
      inre.append(f);
    } else if (d.locked) {
      const l = document.createElement("p");
      l.className = "status";
      l.textContent = "Tråden är låst.";
      inre.append(l);
    }

    // Status: bara för Write eller högre (Workern och GitHub kontrollerar det också)
    if (WRITE_ELLER_HOGRE.includes(r.viewerPermission)) {
      const rad = document.createElement("div");
      rad.className = "atgarder ord-status-rad";
      const lbl = document.createElement("span");
      lbl.textContent = "Status:";
      const anteckning = document.createElement("input");
      anteckning.type = "text";
      anteckning.placeholder = "Anteckning (valfri)";
      anteckning.setAttribute("aria-label", "Anteckning till statusbytet");
      const s3 = document.createElement("span");
      s3.className = "status";
      rad.append(lbl);
      const etikett = { "väntar": "Väntar", "granskad": "Godkänn", "avvisad": "Avvisa", "beslutad": "Besluta" };
      for (const s of ORD_STATUS) {
        if (t.status === s) continue;
        if (d.viewerDidAuthor && (s === "granskad" || s === "beslutad")) continue;
        rad.append(knapp(etikett[s], async () => {
          try {
            await api(`/discussions/${t.number}/status`, { method: "POST", body: { status: s, anteckning: anteckning.value }, inloggad: true });
            visaOrd($("ord-ny-knapp").dataset.key);
          } catch (fel) {
            sattStatus(s3, `Misslyckades: ${fel.message}`, true);
          }
        }));
      }
      rad.append(anteckning, s3);
      inre.append(rad);
      if (t.status === "granskad" || t.status === "beslutad" || t.beslut) {
        const blankett = beslutsBlankett(t, d, "");
        anteckning.addEventListener("input", () => {
          blankett.querySelector("pre").textContent = beslutsText(t, d, anteckning.value);
        });
        inre.append(blankett);
      }
      if (d.viewerDidAuthor) {
        const n = document.createElement("p");
        n.className = "status";
        n.textContent = "Du är författare till tråden och kan därför inte godkänna eller besluta den.";
        inre.append(n);
      }
    }
  } catch (fel) {
    inre.innerHTML = "";
    const e = document.createElement("p");
    e.className = "status fel";
    e.textContent = `Kunde inte hämta tråden: ${fel.message}`;
    inre.append(e);
  }
}

// ------------------------------------------------------------ ny tråd om ordet

function initOrd() {
  $("ord-ga-formular").addEventListener("submit", (e) => {
    e.preventDefault();
    const nyckel = ordNyckel($("ord-ga-text").value);
    if (!nyckel) return;
    location.hash = `#r/${repo}/w/${nyckel}`;
  });
  $("ord-uppdatera").addEventListener("click", () => visaOrd($("ord-ny-knapp").dataset.key));
  $("ord-lista-uppdatera").addEventListener("click", visaOrdLista);
  $("ord-ny-knapp").addEventListener("click", () => {
    $("ord-ny-formular").hidden = !$("ord-ny-formular").hidden;
  });
  $("ord-forslag-kryss").addEventListener("change", () => {
    $("ord-forslag-falt").hidden = !$("ord-forslag-kryss").checked;
    $("ord-forslag-text").required = $("ord-forslag-kryss").checked;
  });
  $("ord-ny-formular").addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = $("ord-ny-status");
    const key = $("ord-ny-knapp").dataset.key;
    const ärForslag = $("ord-forslag-kryss").checked;
    let text = $("ord-ny-text").value.trim();
    if (ärForslag) {
      const fel = kontrolleraForslag($("ord-forslag-text").value);
      if (fel.length) {
        sattStatus(status, fel.join(" "), true);
        return;
      }
      text = `**Förslag:** ${$("ord-forslag-text").value.trim()}\n\n${text}`;
    }
    sattStatus(status, "Skapar…");
    try {
      await api("/word", { method: "POST", body: { key, titel: $("ord-ny-titel").value, body: text, forslag: ärForslag }, inloggad: true });
      $("ord-ny-titel").value = "";
      $("ord-ny-text").value = "";
      $("ord-forslag-text").value = "";
      $("ord-ny-formular").hidden = true;
      sattStatus(status, "");
      await visaOrd(key);
    } catch (fel) {
      sattStatus(status, `Kunde inte skapa tråden: ${fel.message}`, true);
    }
  });
}

// ------------------------------------------------------------ Väntar på mig (2.7)

async function visaVantarPaMig() {
  const ruta = $("ord-vantar");
  const inn = $("ord-vantar-innehall");
  inn.innerHTML = "";
  ruta.hidden = !tokenRackerForRepo();
  if (ruta.hidden) return;
  try {
    const d = await api("/waiting", { inloggad: true });
    const grupp = (rubrik, lista, tom) => {
      const h = document.createElement("h4");
      h.textContent = `${rubrik} (${lista.length})`;
      inn.append(h);
      if (!lista.length) {
        const p = document.createElement("p");
        p.className = "status";
        p.textContent = tom;
        inn.append(p);
        return;
      }
      const ul = document.createElement("ul");
      for (const t of lista) {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = `#r/${repo}/w/${t.key}`;
        a.textContent = `${t.key.replace(/^ord:|^kategori:/, "")}: ${t.rubrik}`;
        const m = document.createElement("span");
        m.className = "meta";
        m.textContent = ` #${t.number} · ${t.author ?? "okänd"} · 💬 ${t.comments} · senast ${relativ(t.updatedAt)}`;
        li.append(a, m);
        if (t.status) li.append(" ", statusPill(t.status));
        ul.append(li);
      }
      inn.append(ul);
    };
    grupp("Mina öppna trådar", d.mina, "Du har inga öppna trådar.");
    if (WRITE_ELLER_HOGRE.includes(d.roll)) grupp("Förslag att granska", d.granska, "Inga förslag väntar på granskning.");
    if (d.roll === "ADMIN" || d.roll === "MAINTAIN") grupp("Granskade, att besluta", d.besluta, "Inget väntar på beslut.");
  } catch (fel) {
    const p = document.createElement("p");
    p.className = "status fel";
    p.textContent = `Kunde inte hämta Väntar på mig: ${fel.message}`;
    inn.append(p);
  }
}

// ------------------------------------------------------------ beslutsblankett (2.11)
// Förhandsvisning av den beslutsfil som skulle sparas. Sparas ingenstans: en människa för in filen.

function beslutsText(t, d, anteckning) {
  const idag = new Date().toLocaleDateString("sv-SE");
  const nyckel = t.key.replace(/^ord:/, "");
  return [
    "---",
    `fil: beslut/${idag}-${nyckel}.md`,
    `datum: ${idag}`,
    `beslutat_av: ${$("inloggad-som").textContent || "(ditt användarnamn)"}`,
    `tråd: ${d.url}`,
    "---",
    `# Beslut: ${t.rubrik} (${nyckel})`,
    "",
    anteckning?.trim() || "(skriv en anteckning)",
    "",
    "Underlag: se tråden. Ändrar ingen data förrän en människa för in beslutet.",
  ].join("\n");
}

function beslutsBlankett(t, d, anteckning) {
  const det = document.createElement("details");
  const sum = document.createElement("summary");
  sum.textContent = "Beslutsblankett (förhandsvisning, sparas inte)";
  const pre = document.createElement("pre");
  pre.textContent = beslutsText(t, d, anteckning);
  det.append(sum, pre);
  return det;
}
