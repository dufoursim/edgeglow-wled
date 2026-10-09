/*
 * Interface du widget WLED pour XENEON EDGE.
 * Lit les réglages iCUE, affiche l'état du contrôleur et envoie les commandes.
 */
(function () {
  "use strict";

  /* ================= Réglages ================= */

  const DEFAULTS = {
    wledIp: "0.0.0.0",
    displayName: "auto",
    startTab: "Couleurs / Colors",
    showEffects: true,
    showPalettes: true,
    showPresets: true,
    accentFromLed: true,
    textColor: "#ECEEF2",
    accentColor: "#FFB45A",
    backgroundColor: "#191B22",
    bgOpacity: 100,
    pollInterval: 5,
    debugMode: false,
    liveView: true,
    reactEnabled: false,
    reactSensor: "",
    reactMin: 35,
    reactMax: 80,
    nightMode: true,
    lang: "Automatique / Automatic",
  };

  let payloadSettings = {};

  // Lit une variable globale injectée par iCUE (méthode de la documentation officielle).
  function getIcueProperty(name) {
    if (Object.prototype.hasOwnProperty.call(window, name)) {
      const v = window[name];
      if (v !== undefined && v !== null && v !== "") return v;
    }
    try {
      const v = Function('return typeof ' + name + ' !== "undefined" ? ' + name + " : undefined")();
      if (v !== undefined && v !== null && v !== "") return v;
    } catch (e) { /* variable absente */ }
    return undefined;
  }

  // Ordre de lecture : variable globale injectée par iCUE (mécanisme documenté),
  // puis la valeur reçue avec l'événement, puis la valeur par défaut.
  function setting(name) {
    const g = DEV_MODE ? undefined : getIcueProperty(name);
    if (g !== undefined) return g;
    if (payloadSettings && payloadSettings[name] !== undefined && payloadSettings[name] !== null) {
      return payloadSettings[name];
    }
    return DEFAULTS[name];
  }

  function bool(v) {
    if (v === false || v === 0) return false;
    const t = String(v).trim().toLowerCase();
    return !(t === "false" || t === "0" || t === "off" || t === "no");
  }

  function normalizeIp(raw) {
    const ip = String(raw || "")
      .trim()
      .replace(/^https?:\/\//i, "")
      .replace(/\/.*$/, "")
      .replace(/[^0-9A-Za-z.:-]/g, ""); // retire guillemets, espaces et caractères invisibles
    // 0.0.0.0 est la valeur par défaut : le widget n'est pas encore configuré.
    return ip === "0.0.0.0" ? "" : ip;
  }

  // Les choix du menu iCUE sont des libellés : on les convertit en identifiants d'onglet.
  const TAB_KEYS = {
    "couleurs": "colors", "effets": "effects", "palettes": "palettes", "prereglages": "presets", "préréglages": "presets",
    "colors": "colors", "effects": "effects", "presets": "presets",
  };
  function tabKey(label) {
    // Les choix sont bilingues (« Couleurs / Colors ») : on garde la partie française.
    const key = String(label || "").split(" / ")[0].trim().toLowerCase();
    return TAB_KEYS[key] || "colors";
  }

  // Mode test : ouvrir index.html dans Chrome avec ?ip=192.168.x.x
  // iCUE peut déclarer ses variables globales avec « let » : elles existent alors dans la
  // portée globale, mais pas sur l'objet window. Function() s'exécute dans la portée
  // globale et les voit dans les deux cas.
  function hasGlobal(name) {
    try { return Function("return typeof " + name + ' !== "undefined"')(); } catch (e) { return false; }
  }
  function readGlobal(name) {
    try { return Function("return typeof " + name + ' !== "undefined" ? ' + name + " : undefined")(); } catch (e) { return undefined; }
  }
  // Écrit dans la variable globale d'iCUE si elle existe (let), sinon en crée une.
  function writeGlobal(name, value) {
    try { Function("v", name + " = v;")(value); } catch (e) { /* ignoré */ }
    try { window[name] = value; } catch (e) { /* ignoré */ }
  }

  const DEV_MODE = !hasGlobal("iCUE_initialized");
  if (DEV_MODE) {
    const params = new URLSearchParams(location.search);
    params.forEach((value, key) => { payloadSettings[key] = value; });
    if (params.has("ip")) payloadSettings.wledIp = params.get("ip");
  }

  /* ================= Outils ================= */

  const $ = (sel) => document.querySelector(sel);
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  function throttle(fn, ms) {
    let last = 0;
    let timer = null;
    let pending = null;
    return function (...args) {
      pending = args;
      const wait = ms - (Date.now() - last);
      if (wait <= 0) {
        last = Date.now();
        fn(...pending);
        pending = null;
      } else if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          last = Date.now();
          if (pending) { fn(...pending); pending = null; }
        }, wait);
      }
    };
  }

  function hsvToRgb(h, s, v) {
    const f = (n) => {
      const k = (n + h / 60) % 6;
      return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
    };
    return [f(5), f(3), f(1)];
  }

  function rgbToHue(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    if (d === 0) return 0;
    let h;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  }

  // Couleur affichable à partir d'une couleur WLED [r, g, b, w].
  // cols = les trois couleurs du segment. Si la couleur 1 est noire (effet à palette),
  // on prend la suivante; sinon un blanc chaud, pour que l'orbe allumée ne soit jamais grise.
  function displayRgb(cols) {
    const usable = (Array.isArray(cols) ? cols : []).find(
      (c) => Array.isArray(c) && (c[0] || 0) + (c[1] || 0) + (c[2] || 0) + (c[3] || 0) > 0
    );
    if (!usable) return [255, 196, 107];
    let [r = 0, g = 0, b = 0, w = 0] = usable;
    if (w > 0) {
      // Mélange le canal blanc (blanc chaud) dans l'aperçu.
      const k = w / 255;
      r = Math.round(r + (255 - r) * k);
      g = Math.round(g + (240 - g) * k);
      b = Math.round(b + (216 - b) * k);
    }
    return [r, g, b];
  }

  // Éclaircit une couleur trop sombre pour qu'elle reste lisible comme accent.
  function legibleAccent([r, g, b]) {
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (lum >= 90) return [r, g, b];
    const k = (90 - lum) / 255 + 0.25;
    return [r, g, b].map((c) => Math.round(c + (255 - c) * k));
  }

  const css = (rgb) => "rgb(" + rgb.join(",") + ")";

  /* ================= Curseur tactile (fader) ================= */

  class Fader {
    constructor(el, opts) {
      this.el = el;
      this.min = opts.min;
      this.max = opts.max;
      this.format = opts.format || ((v) => String(v));
      this.onInput = opts.onInput || function () {};
      this.onChange = opts.onChange || function () {};
      this.value = this.min;
      this.dragging = false;
      this.valueEl = el.querySelector(".fader-value");

      el.addEventListener("pointerdown", (e) => {
        this.dragging = true;
        el.setPointerCapture(e.pointerId);
        el.classList.add("is-active");
        this._fromPointer(e);
      });
      el.addEventListener("pointermove", (e) => {
        if (this.dragging) this._fromPointer(e);
      });
      const end = () => {
        if (!this.dragging) return;
        this.dragging = false;
        el.classList.remove("is-active");
        this.onChange(this.value);
      };
      el.addEventListener("pointerup", end);
      el.addEventListener("pointercancel", end);

      // Clavier (utile pour tester au bureau).
      el.addEventListener("keydown", (e) => {
        const step = Math.max(1, Math.round((this.max - this.min) / 20));
        if (e.key === "ArrowRight" || e.key === "ArrowUp") this._set(this.value + step, true);
        else if (e.key === "ArrowLeft" || e.key === "ArrowDown") this._set(this.value - step, true);
        else return;
        e.preventDefault();
        this.onChange(this.value);
      });
    }

    _fromPointer(e) {
      const rect = this.el.getBoundingClientRect();
      const ratio = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      this._set(Math.round(this.min + ratio * (this.max - this.min)), true);
    }

    _set(v, fromUser) {
      v = clamp(v, this.min, this.max);
      const changed = v !== this.value;
      this.value = v;
      this._render();
      if (fromUser && changed) this.onInput(v);
    }

    // Mise à jour venant du contrôleur : ignorée pendant que le doigt est posé.
    sync(v) {
      if (this.dragging || v === undefined || v === null) return;
      this._set(v, false);
    }

    _render() {
      const pct = ((this.value - this.min) / (this.max - this.min)) * 100;
      this.el.style.setProperty("--pct", pct + "%");
      this.el.setAttribute("aria-valuenow", String(this.value));
      if (this.valueEl) this.valueEl.textContent = this.format(this.value);
    }
  }

  /* ================= État ================= */

  const model = {
    ip: "",
    status: "idle",
    state: null,
    info: null,
    effects: [],   // [{id, name}]
    palettes: [],  // [{id, name}]
    presets: [],   // [{id, name, playlist}]
    tab: null,
  };

  const SWATCHES = [
    ["Rouge", [255, 0, 0]],
    ["Orange", [255, 80, 0]],
    ["Ambre", [255, 150, 0]],
    ["Jaune", [255, 220, 0]],
    ["Vert", [0, 255, 40]],
    ["Turquoise", [0, 255, 160]],
    ["Cyan", [0, 200, 255]],
    ["Bleu", [0, 40, 255]],
    ["Violet", [120, 0, 255]],
    ["Magenta", [255, 0, 200]],
    ["Rose", [255, 50, 110]],
    ["Blanc chaud", "warm"],
    ["Blanc", "white"],
  ];

  const els = {
    app: $("#app"),
    orb: $("#orb"),
    name: $("#name"),
    subtitle: $("#subtitle"),
    tabs: $("#tabs"),
    panels: $("#panels"),
    swatches: $("#swatches"),
    hueBar: $("#hueBar"),
    fxList: $("#fxList"),
    stateChip: $("#stateChip"),
    timerBtn: $("#timerBtn"),
    timerLeft: $("#timerLeft"),
    timerSheet: $("#timerSheet"),
    timerInfo: $("#timerInfo"),
    timerClose: $("#timerClose"),
    timerCancel: $("#timerCancel"),
    live: $("#live"),
    liveStrip: $("#liveStrip"),
    liveGlow: $("#liveGlow"),
    reactNote: $("#reactNote"),
    schedList: $("#schedList"),
    halo: $("#halo"),
    hDial: $("#hDial"),
    hArc: $("#hArc"),
    hOrb: $("#hOrb"),
    hPct: $("#hPct"),
    hName: $("#hName"),
    hState: $("#hState"),
    hFx: $("#hFx"),
    hPal: $("#hPal"),
    hLive: $("#hLive"),
    hLiveGlow: $("#hLiveGlow"),
    drawerClose: $("#drawerClose"),
    schedClock: $("#schedClock"),
    palList: $("#palList"),
    psList: $("#psList"),
    notice: $("#notice"),
    noticeTitle: $("#noticeTitle"),
    noticeText: $("#noticeText"),
    retryBtn: $("#retryBtn"),
    changeIpBtn: $("#changeIpBtn"),
    settingsBtn: $("#settingsBtn"),
    setup: $("#setup"),
    ipDisplay: $("#ipDisplay"),
    setupMsg: $("#setupMsg"),
    setupSave: $("#setupSave"),
    setupCancel: $("#setupCancel"),
    keypad: $("#keypad"),
  };

  const client = new window.WledClient({
    onState: handleState,
    onStatus: handleStatus,
    onLive: (bytes) => handleLive(bytes),
  });

  /* ================= Diagnostic ================= */

  const diagEl = document.getElementById("diag");
  const diagInfo = { size: "?", layout: "?", updates: 0, payload: "aucun" };

  // Libellé du diagnostic dans la langue de l'interface.
  const D = (fr, en) => (window.EdgeGlowI18n && window.EdgeGlowI18n.lang === "en" ? en : fr);

  function renderDiag() {
    if (!diagEl) return;
    const dbg = setting("debugMode");
    diagEl.hidden = !(dbg === true || dbg === 1 || String(dbg).toLowerCase() === "true");
    if (diagEl.hidden) return;
    const names = Object.keys(DEFAULTS);
    const lines = [
      D("Taille", "Size") + " : " + diagInfo.size + " (" + diagInfo.layout + ")",
      D("IP lue", "IP read") + " : " + (normalizeIp(setting("wledIp")) || D("(aucune)", "(none)")),
      D("Statut", "Status") + " : " + model.status + " | mode : " + client.mode,
      "Page : " + location.protocol + "//" + location.host + " | " + D("sécurisée", "secure") + " : " + window.isSecureContext,
      "WebSocket : " + (client.diag.wsUrl || "-") + " => " + (client.diag.wsEvents || "-"),
      "HTTP : " + (client.diag.httpError || "-"),
      D("État reçu", "State received") + " : " + (model.state ? D("oui", "yes") : D("non", "no")) + " | " + D("onglet", "tab") + " : " + model.tab,
      D("Listes", "Lists") + " : " + model.effects.length + D(" effets, ", " effects, ") + model.palettes.length + " palettes, " + model.presets.length + D(" préréglages", " presets"),
      D("Mises à jour iCUE", "iCUE updates") + " : " + diagInfo.updates,
      D("Horaire", "Schedule") + " : " + (typeof schedule === "undefined" ? "-" : schedule.error || (schedule.loaded ? schedule.entries.length + D(" entrée(s)", " entry(ies)") : D("non lu", "not read"))),
      "Payload : " + diagInfo.payload,
      D("Globales :", "Globals:"),
    ];
    names.forEach((n) => {
      const g = getIcueProperty(n);
      lines.push("  " + n + " = " + JSON.stringify(g) + " (" + typeof g + ")");
    });
    if (diagInfo.lastError) lines.push(D("Erreur", "Error") + " : " + diagInfo.lastError);
    diagEl.textContent = lines.join("\n");
  }

  window.addEventListener("error", (e) => { diagInfo.lastError = e.message; renderDiag(); });
  setInterval(renderDiag, 1000);

  /* ================= Helpers WLED ================= */

  function mainSegment() {
    const st = model.state;
    if (!st || !Array.isArray(st.seg) || st.seg.length === 0) return null;
    return st.seg.find((s) => s.id === st.mainseg) || st.seg[0];
  }

  function hasWhiteChannel() {
    const leds = model.info && model.info.leds;
    if (!leds) return false;
    return Boolean(leds.rgbw) || (typeof leds.lc === "number" && (leds.lc & 2) === 2);
  }

  function colorPayload(rgb) {
    return hasWhiteChannel() ? [rgb[0], rgb[1], rgb[2], 0] : rgb;
  }

  /* ================= Commandes ================= */

  const sendBri = throttle((bri) => client.send({ on: true, bri }), 90);
  /* ---------- Ambiances : trois couleurs d'un toucher ---------- */
  const MOODS = [
    ["Coucher de soleil", [255, 90, 31], [255, 46, 106], [122, 43, 255]],
    ["Océan", [0, 200, 255], [0, 102, 255], [0, 255, 194]],
    ["Forêt", [31, 191, 74], [168, 240, 74], [14, 107, 58]],
    ["Néon", [255, 46, 154], [33, 200, 255], [177, 59, 255]],
    ["Feu de camp", [255, 59, 0], [255, 176, 0], [255, 122, 0]],
    ["Aurore boréale", [18, 224, 122], [122, 92, 255], [33, 200, 255]],
    ["Bonbons", [255, 138, 216], [138, 232, 255], [255, 240, 138]],
    ["Glace", [232, 247, 255], [138, 216, 255], [74, 140, 255]],
  ];

  // Thèmes des fêtes : à l'approche d'une fête, son ambiance apparaît en premier.
  // [nom, couleur 1, 2, 3, début (mois, jour), fin (mois, jour)]
  const SEASONS = [
    ["Jour de l’An", [255, 205, 90], [235, 235, 245], [150, 120, 255], [12, 27], [1, 2]],
    ["Saint-Valentin", [255, 30, 90], [255, 140, 180], [200, 0, 60], [2, 7], [2, 14]],
    ["Saint-Patrick", [0, 200, 80], [150, 255, 120], [255, 200, 0], [3, 10], [3, 17]],
    ["Fête nationale", [0, 70, 255], [255, 255, 255], [0, 40, 200], [6, 17], [6, 24]],
    ["Fête du Canada", [255, 0, 0], [255, 255, 255], [255, 30, 30], [6, 25], [7, 1]],
    ["Halloween", [255, 100, 0], [140, 0, 255], [60, 255, 40], [10, 1], [10, 31]],
    ["Noël", [255, 0, 0], [0, 200, 60], [255, 215, 120], [12, 1], [12, 26]],
  ];

  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, month - 1, day);
  }

  function seasonNow(now) {
    const md = (now.getMonth() + 1) * 100 + now.getDate();
    for (const x of SEASONS) {
      const a = x[4][0] * 100 + x[4][1], b = x[5][0] * 100 + x[5][1];
      if (a <= b ? md >= a && md <= b : md >= a || md <= b) return x.slice(0, 4);
    }
    const e = easter(now.getFullYear()), diff = (now - e) / 864e5;
    if (diff >= -7 && diff <= 1) return ["Pâques", [255, 180, 220], [180, 230, 255], [255, 240, 150]];
    return null;
  }

  function currentMoods() {
    const s = seasonNow(new Date());
    return s ? [s].concat(MOODS.slice(0, MOODS.length - 1)) : MOODS;
  }

  function applyMood(m) {
    const col = [colorPayload(m[1]), colorPayload(m[2]), colorPayload(m[3])];
    const seg = mainSegment();
    const patch = { col, pal: palId("Color Gradient", 4) };
    // Avec un effet uni, on passe à l'effet « Palette » pour voir le dégradé des trois couleurs.
    if (seg && seg.fx === 0) patch.fx = fxId("Palette", 65);
    applyLocal({ on: true, seg: patch });
    client.send({ on: true, seg: patch });
  }

  function buildMoods() {
    const box = document.getElementById("moods");
    if (!box) return;
    box.innerHTML = "";
    const season = seasonNow(new Date());
    currentMoods().forEach((m) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "mood" + (season && m === currentMoods()[0] && m[0] === season[0] ? " is-season" : "");
      if (season && m[0] === season[0]) { b.classList.add("is-season"); b.dataset.tag = window.EdgeGlowI18n.lang === "en" ? "Season" : "Saison"; }
      b.dataset.name = m[0];
      ["--m1", "--m2", "--m3"].forEach((v, i) => b.style.setProperty(v, css(m[i + 1])));
      const n = document.createElement("span"); n.className = "mood-name"; n.textContent = m[0];
      const d = document.createElement("span"); d.className = "mood-dots";
      for (let i = 1; i <= 3; i++) { const x = document.createElement("i"); x.style.setProperty("--d", css(m[i])); d.appendChild(x); }
      b.append(n, d);
      b.addEventListener("click", () => applyMood(m));
      box.appendChild(b);
    });
  }

  function renderSolid(seg) {
    const b = document.getElementById("solidBtn");
    if (!b) return;
    b.classList.toggle("is-active", Boolean(seg) && seg.fx === 0);
    const c = seg && seg.col && seg.col[0];
    b.style.setProperty("--solid", c ? css(displayRgb([c])) : "#3A3F4B");
  }

  function renderMoods(seg) {
    renderSolid(seg);
    const cols = (seg && seg.col) || [];
    const same = (a, b) => Array.isArray(a) && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
    document.querySelectorAll("#moods .mood").forEach((b) => {
      const m = currentMoods().find((x) => x[0] === b.dataset.name);
      b.classList.toggle("is-active", Boolean(m) && same(cols[0], m[1]) && same(cols[1], m[2]) && same(cols[2], m[3]));
    });
    document.querySelectorAll("#moodNow i").forEach((x, i) => {
      const c = cols[i];
      const on = Array.isArray(c) && (c[0] || 0) + (c[1] || 0) + (c[2] || 0) + (c[3] || 0) > 0;
      x.style.setProperty("--c", on ? css(displayRgb([c])) : "#3A3F4B");
    });
  }

  // « Unie » : effet Solid, la bande entière prend la couleur 1.
  document.getElementById("solidBtn").addEventListener("click", () => {
    colorSlot = 0;
    applyLocal({ on: true, seg: { fx: 0 } });
    client.send({ on: true, seg: { fx: 0 } });
    render();
  });

  document.getElementById("whiteBtn").addEventListener("click", () => setSlotColor(hasWhiteChannel() ? [0, 0, 0, 255] : [255, 255, 255]));
  document.getElementById("warmBtn").addEventListener("click", () => setSlotColor(hasWhiteChannel() ? [255, 120, 30, 200] : [255, 170, 90]));

  /* ---------- Couleurs 1, 2 et 3 ---------- */
  document.querySelectorAll("#colorSlots button").forEach((b) => b.addEventListener("click", () => {
    colorSlot = Number(b.dataset.slot);
    render();
  }));

  const OWN_PAL_HINT = {
    "color 1": "La palette « Color 1 » utilise seulement la couleur 1.",
    "colors 1&2": "La palette « Colors 1&2 » mélange les couleurs 1 et 2.",
    "color gradient": "La palette « Color Gradient » fait un dégradé des couleurs 1, 2 et 3.",
    "colors only": "La palette « Colors Only » affiche les couleurs 1, 2 et 3 en blocs.",
  };

  // Les aperçus des palettes « Tes couleurs » suivent les couleurs 1, 2 et 3.
  let lastPalCols = "";
  function refreshOwnPalettes(seg) {
    if (!model.palx || !seg) return;
    const key = JSON.stringify(seg.col || []);
    if (key === lastPalCols) return;
    lastPalCols = key;
    const scroll = els.palList.scrollTop;
    palMenu.build(window.WledCategories.paletteFamilies(model.palettes, model.palx, seg.col));
    els.palList.scrollTop = scroll;
  }

  function renderSlots(seg) {
    refreshOwnPalettes(seg);
    renderMoods(seg);
    const cols = (seg && seg.col) || [];
    document.querySelectorAll("#colorSlots button").forEach((b) => {
      const i = Number(b.dataset.slot);
      b.classList.toggle("is-active", i === colorSlot);
      b.setAttribute("aria-checked", String(i === colorSlot));
      const c = cols[i];
      const on = Array.isArray(c) && (c[0] || 0) + (c[1] || 0) + (c[2] || 0) + (c[3] || 0) > 0;
      b.querySelector(".slot-dot").style.setProperty("--slot", on ? css(displayRgb([c])) : "#3A3F4B");
    });
    const pal = seg ? model.palettes.find((x) => x.id === seg.pal) : null;
    const hint = pal ? OWN_PAL_HINT[pal.name.toLowerCase()] : "";
    const el = document.getElementById("slotHint");
    if (el && seg && seg.fx === 0) { el.textContent = "Couleur unie : toute la bande prend la couleur 1."; return; }
    if (el) el.textContent = hint || (colorSlot === 0 ? "La couleur 1 est celle de la plupart des effets." : "Les couleurs 2 et 3 servent à certains effets et aux palettes « Tes couleurs ».");
  }
  // Les effets et les palettes « Tes couleurs » utilisent jusqu'à trois couleurs.
  let colorSlot = 0;

  function slotColors(col) {
    const seg = mainSegment();
    const cur = (seg && Array.isArray(seg.col) ? seg.col : []).map((c) => (Array.isArray(c) ? c.slice() : [0, 0, 0]));
    while (cur.length < 3) cur.push([0, 0, 0]);
    cur[colorSlot] = col;
    return cur.slice(0, 3);
  }

  // Régler la couleur 1 pendant l'effet « Palette » (posé par une ambiance) revient à une couleur unie.
  function solidPatch() {
    const seg = mainSegment();
    return colorSlot === 0 && seg && seg.fx === fxId("Palette", 65) ? { fx: 0 } : {};
  }

  function setSlotColor(col) {
    const arr = slotColors(col);
    const patch = Object.assign({ col: arr }, solidPatch());
    applyLocal({ on: true, seg: patch });
    client.send({ on: true, seg: patch });
  }

  const sendHue = throttle((rgb) => {
    const arr = slotColors(colorPayload(rgb));
    client.send({ on: true, seg: Object.assign({ col: arr }, solidPatch()) });
  }, 90);
  const sendSx = throttle((sx) => client.send({ seg: { sx } }), 120);
  const sendIx = throttle((ix) => client.send({ seg: { ix } }), 120);

  function applyLocal(patch) {
    // Mise à jour optimiste : l'écran réagit tout de suite, l'état réel arrive ensuite.
    if (!model.state) return;
    if (patch.on !== undefined) model.state.on = patch.on;
    if (patch.bri !== undefined) model.state.bri = patch.bri;
    const seg = mainSegment();
    if (seg && patch.seg) Object.assign(seg, patch.seg);
    render();
  }

  /* ================= Faders ================= */

  const briFader = new Fader($("#briFader"), {
    min: 1,
    max: 255,
    format: (v) => Math.round((v / 255) * 100) + " %",
    onInput: (v) => { applyLocal({ on: true, bri: v }); sendBri(v); },
    onChange: (v) => client.send({ on: true, bri: v }),
  });

  const sxFader = new Fader($("#sxFader"), {
    min: 0, max: 255,
    format: (v) => Math.round((v / 255) * 100) + " %",
    onInput: (v) => sendSx(v),
    onChange: (v) => client.send({ seg: { sx: v } }),
  });

  const ixFader = new Fader($("#ixFader"), {
    min: 0, max: 255,
    format: (v) => Math.round((v / 255) * 100) + " %",
    onInput: (v) => sendIx(v),
    onChange: (v) => client.send({ seg: { ix: v } }),
  });

  /* ================= Barre de teinte ================= */

  let hueDragging = false;

  function hueFromPointer(e) {
    const rect = els.hueBar.getBoundingClientRect();
    const ratio = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const hue = ratio * 360;
    els.hueBar.style.setProperty("--hue-pos", ratio * 100 + "%");
    const rgb = hsvToRgb(hue, 1, 1);
    const sp = solidPatch();
    sendHue(rgb);
    applyLocal({ on: true, seg: Object.assign({ col: slotColors(colorPayload(rgb)) }, sp) });
    return rgb;
  }

  els.hueBar.addEventListener("pointerdown", (e) => {
    hueDragging = true;
    els.hueBar.setPointerCapture(e.pointerId);
    hueFromPointer(e);
  });
  els.hueBar.addEventListener("pointermove", (e) => { if (hueDragging) hueFromPointer(e); });
  els.hueBar.addEventListener("pointerup", (e) => {
    if (!hueDragging) return;
    hueDragging = false;
    const rgb = hueFromPointer(e);
    client.send({ on: true, seg: Object.assign({ col: slotColors(colorPayload(rgb)) }, solidPatch()) });
  });
  els.hueBar.addEventListener("pointercancel", () => { hueDragging = false; });

  /* ================= Pastilles de couleur ================= */

  function buildSwatches() {
    els.swatches.innerHTML = "";
    SWATCHES.forEach(([label, value]) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "swatch";
      btn.title = label;
      btn.setAttribute("aria-label", label);
      const preview = value === "white" ? [255, 255, 255] : value === "warm" ? [255, 196, 130] : value;
      btn.style.setProperty("--swatch", css(preview));
      btn.addEventListener("click", () => {
        let col;
        if (value === "white") col = hasWhiteChannel() ? [0, 0, 0, 255] : [255, 255, 255];
        else if (value === "warm") col = hasWhiteChannel() ? [255, 120, 30, 200] : [255, 170, 90];
        else col = colorPayload(value);
        setSlotColor(col);
      });
      els.swatches.appendChild(btn);
    });
  }

  /* ================= Listes ================= */

  function buildList(ul, items, onPick, emptyText) {
    ul.innerHTML = "";
    if (items.length === 0) {
      const li = document.createElement("li");
      li.className = "list-empty";
      li.textContent = emptyText;
      ul.appendChild(li);
      return;
    }
    const frag = document.createDocumentFragment();
    items.forEach((item) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.id = String(item.id);
      if (item.gradient) {
        btn.classList.add("has-bar");
        const n = document.createElement("span");
        n.className = "item-name";
        n.textContent = item.name;
        const bar = document.createElement("span");
        bar.className = "pal-bar";
        bar.style.background = item.gradient;
        btn.append(n, bar);
      } else {
        btn.textContent = item.name;
      }
      if (item.playlist) btn.classList.add("is-playlist");
      btn.addEventListener("click", () => onPick(item));
      li.appendChild(btn);
      frag.appendChild(li);
    });
    ul.appendChild(frag);
  }

  function markActive(ul, id, scroll) {
    let activeBtn = null;
    ul.querySelectorAll("button[data-id]").forEach((btn) => {
      const on = btn.dataset.id === String(id);
      btn.classList.toggle("is-active", on);
      if (on) activeBtn = btn;
    });
    if (scroll && activeBtn) activeBtn.scrollIntoView({ block: "center" });
  }

  function cleanNames(arr) {
    if (!Array.isArray(arr)) return [];
    return arr
      .map((name, id) => ({ id, name: String(name || "").split("@")[0].replace(/^\*\s*/, "").trim() }))
      .filter((x) => x.name && x.name !== "RSVD" && x.name !== "-");
  }

  function sortByName(items, firstId) {
    return items.sort((a, b) => {
      if (a.id === firstId) return -1;
      if (b.id === firstId) return 1;
      return a.name.localeCompare(b.name, "fr", { sensitivity: "base" });
    });
  }

  async function loadLists() {
    const lists = await client.loadLists();
    model.effects = sortByName(cleanNames(lists.effects), 0);
    model.palettes = sortByName(cleanNames(lists.palettes), 0);
    model.presetNames = {};
    Object.entries(lists.presets || {}).forEach(([id, p]) => { if (p && p.n) model.presetNames[id] = p.n; });
    model.presets = Object.entries(lists.presets || {})
      .filter(([id, p]) => Number(id) > 0 && p && p.n && !/^EdgeGlow /.test(p.n))
      .map(([id, p]) => ({ id: Number(id), name: p.n, playlist: Boolean(p.playlist) }))
      .sort((a, b) => a.id - b.id);

    const isMatrix = Boolean(model.info && model.info.leds && model.info.leds.matrix);
    fxMenu.build(window.WledCategories.categorize(model.effects, lists.fxdata, isMatrix));
    resumePomo();
    loadGeo();
    resumeSky();
    renderBadge();
    const seg = mainSegment();
    model.palx = lists.palx;
    lastPalCols = JSON.stringify((seg && seg.col) || []);
    palMenu.build(window.WledCategories.paletteFamilies(model.palettes, lists.palx, seg && seg.col));


    buildList(els.psList, model.presets, (ps) => {
      if (model.state) model.state.ps = ps.id;
      client.send({ ps: ps.id });
      render();
    }, "Aucun préréglage. Crée-en dans l’interface web de WLED, puis touche Réessayer.");

    render(true);
  }

  /* ================= Menus par familles (effets et palettes) ================= */

  function plural(n, unit) {
    return n + " " + unit + (n > 1 ? "s" : "");
  }

  function createFamilyMenu(cfg) {
    const menu = { families: [], openKey: null };

    menu.build = function (families) {
      menu.families = families || [];
      cfg.grid.innerHTML = "";
      if (menu.families.length === 0) {
        const p = document.createElement("p");
        p.className = "list-empty";
        p.textContent = cfg.emptyText;
        cfg.grid.appendChild(p);
        return;
      }
      menu.families.forEach((fam) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "cat-btn";
        btn.dataset.cat = fam.key;
        const sw = document.createElement("span");
        sw.className = "cat-swatch";
        sw.style.background = fam.swatch;
        const txt = document.createElement("span");
        const n = document.createElement("span");
        n.className = "cat-name";
        n.textContent = fam.name;
        const c = document.createElement("span");
        c.className = "cat-count";
        c.textContent = plural(fam.items.length, cfg.unit);
        txt.append(n, c);
        btn.append(sw, txt);
        btn.addEventListener("click", () => menu.open(fam.key));
        cfg.grid.appendChild(btn);
      });
      if (menu.openKey) menu.open(menu.openKey);
    };

    menu.open = function (key) {
      const fam = menu.families.find((f) => f.key === key);
      if (!fam) { menu.close(); return; }
      menu.openKey = key;
      if (cfg.onOpen) cfg.onOpen(key);
      cfg.nameEl.textContent = fam.name;
      cfg.countEl.textContent = plural(fam.items.length, cfg.unit);
      buildList(cfg.list, fam.items, cfg.onPick, "Rien dans cette famille.");
      cfg.grid.hidden = true;
      cfg.view.hidden = false;
      cfg.list.scrollTop = 0;
      render(true);
    };

    menu.close = function () {
      menu.openKey = null;
      cfg.view.hidden = true;
      cfg.grid.hidden = false;
      render();
    };

    menu.familyOf = function (id) {
      return menu.families.find((f) => f.items.some((x) => x.id === id));
    };

    menu.highlight = function (id, scroll) {
      markActive(cfg.list, id, scroll);
      const fam = menu.familyOf(id);
      cfg.grid.querySelectorAll(".cat-btn").forEach((b) => {
        b.classList.toggle("is-active", Boolean(fam) && b.dataset.cat === fam.key);
      });
    };

    cfg.back.addEventListener("click", menu.close);
    return menu;
  }

  const fxMenu = createFamilyMenu({
    grid: $("#fxCats"), view: $("#fxCatView"), list: $("#fxList"),
    nameEl: $("#fxCatName"), countEl: $("#fxCatCount"), back: $("#fxBack"),
    unit: "effet", emptyText: "Liste des effets indisponible.",
    onPick: (fx) => {
      applyLocal({ on: true, seg: { fx: fx.id } });
      client.send({ on: true, seg: { fx: fx.id } });
    },
  });

  const palMenu = createFamilyMenu({
    grid: $("#palCats"), view: $("#palCatView"), list: $("#palList"),
    nameEl: $("#palCatName"), countEl: $("#palCatCount"), back: $("#palBack"),
    unit: "palette", emptyText: "Liste des palettes indisponible.",
    onOpen: (key) => { const h = document.getElementById("palHint"); if (h) h.hidden = key !== "own"; },
    onPick: (pal) => {
      applyLocal({ seg: { pal: pal.id } });
      client.send({ seg: { pal: pal.id } });
    },
  });

  /* ================= Onglets ================= */

  function visibleTabs() {
    const tabs = ["colors"];
    if (bool(setting("showEffects"))) tabs.push("effects");
    if (bool(setting("showPalettes"))) tabs.push("palettes");
    if (bool(setting("showPresets"))) tabs.push("presets");
    return tabs;
  }

  function selectTab(tab) {
    const tabs = visibleTabs();
    if (!tabs.includes(tab)) tab = tabs[0];
    model.tab = tab;
    els.tabs.querySelectorAll("button").forEach((b) => {
      b.hidden = !tabs.includes(b.dataset.tab);
      b.classList.toggle("is-active", b.dataset.tab === tab);
      b.setAttribute("aria-selected", String(b.dataset.tab === tab));
    });
    els.panels.querySelectorAll(".panel").forEach((p) => {
      p.hidden = p.dataset.panel !== tab;
    });
    els.tabs.hidden = tabs.length < 2;
    render(true);
  }

  els.tabs.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-tab]");
    if (!btn) return;
    if (btn.dataset.tab === "effects" && fxMenu.openKey) fxMenu.close();
    if (btn.dataset.tab === "palettes" && palMenu.openKey) palMenu.close();
    selectTab(btn.dataset.tab);
  });

  /* ================= Rendu ================= */

  function render(scrollLists) {
    const st = model.state;
    const seg = mainSegment();
    const on = Boolean(st && st.on);

    els.app.classList.toggle("is-on", on);
    els.app.classList.toggle("is-off", !on);
    els.stateChip.textContent = on ? "Allumé" : "Éteint";
    els.settingsBtn.hidden = Boolean(normalizeIp(setting("wledIp")));

    // Nom
    let custom = String(setting("displayName") || "").trim();
    if (custom.toLowerCase() === "auto") custom = "";
    els.name.textContent = custom || (model.info && model.info.name) || "WLED";

    // Couleur des DEL et accent
    const rgb = displayRgb(seg && seg.col);
    document.documentElement.style.setProperty("--led", css(rgb));
    if (bool(setting("accentFromLed"))) {
      document.documentElement.style.setProperty("--accent", css(legibleAccent(rgb)));
    } else {
      document.documentElement.style.setProperty("--accent", setting("accentColor"));
    }

    // Lueur proportionnelle à la luminosité
    const bri = st ? st.bri : 0;
    document.documentElement.style.setProperty("--glow", on ? (0.25 + (bri / 255) * 0.75).toFixed(2) : "0");

    if (st) briFader.sync(st.bri);
    if (seg) {
      sxFader.sync(seg.sx);
      ixFader.sync(seg.ix);
      renderSlots(seg);
      if (!hueDragging && seg.col && seg.col[colorSlot]) {
        const [r, g, b] = seg.col[colorSlot];
        if (r + g + b > 0) els.hueBar.style.setProperty("--hue-pos", (rgbToHue(r, g, b) / 360) * 100 + "%");
      }
    }

    // Sous-titre : préréglage actif, sinon effet actif
    let sub = "";
    if (model.status === "offline") sub = "Hors ligne";
    else if (model.status === "connecting" && !st) sub = "Connexion…";
    else if (st && !on) sub = "Éteint";
    else if (st && st.ps > 0) {
      const p = model.presets.find((x) => x.id === st.ps);
      sub = p ? p.name : "Préréglage " + st.ps;
    } else if (seg) {
      const fx = model.effects.find((x) => x.id === seg.fx);
      sub = fx ? fx.name : "Effet " + seg.fx;
    }
    els.subtitle.textContent = sub;

    // Mise en page Halo
    let haloTitle = "";
    if (st && st.ps > 0) {
      const p = model.presets.find((x) => x.id === st.ps);
      haloTitle = p ? p.name : "";
    }
    if (!haloTitle && seg) {
      const fx = model.effects.find((x) => x.id === seg.fx);
      haloTitle = fx ? fx.name : "";
    }
    const palObj = seg ? model.palettes.find((x) => x.id === seg.pal) : null;
    const pt = activityText();
    renderHalo({
      name: els.name.textContent,
      on,
      bri: st ? st.bri : 0,
      title: pt ? pt.title : haloTitle || (st ? "" : "Connexion…"),
      palette: pt ? null : palObj ? palObj.name : "",
      sub: pt ? pt.sub : "",
      cap: pt ? pt.cap : "",
      led: css(rgb),
    });
    renderSplash();

    // Éléments actifs dans les listes
    if (seg) {
      fxMenu.highlight(seg.fx, scrollLists && model.tab === "effects");
      palMenu.highlight(seg.pal, scrollLists && model.tab === "palettes");
    }
    if (st) markActive(els.psList, st.ps, scrollLists && model.tab === "presets");
  }

  /* ================= Écran de connexion (logo) ================= */

  function renderSplash() {
    const el = document.getElementById("splash");
    if (!el) return;
    const show = Boolean(model.ip) && !model.state && model.status !== "offline" && els.setup.hidden;
    el.hidden = !show;
    if (show) {
      const custom = String(setting("displayName") || "").trim();
      const name = custom && custom.toLowerCase() !== "auto" ? custom : model.ip;
      document.getElementById("splashText").textContent = "Connexion à " + name + "…";
    }
  }

  /* ================= Avis (configuration, hors ligne) ================= */

  function showNotice(title, text, withRetry) {
    els.noticeTitle.textContent = title;
    els.noticeText.textContent = text;
    els.retryBtn.hidden = !withRetry;
    els.notice.hidden = false;
    els.app.classList.add("has-notice");
  }

  function hideNotice() {
    els.notice.hidden = true;
    els.app.classList.remove("has-notice");
  }

  els.retryBtn.addEventListener("click", () => connect(true));

  /* ================= Événements du client ================= */

  let listsLoaded = false;

  function handleState(state, info) {
    model.state = state;
    if (info) model.info = info;
    els.app.classList.remove("is-loading");
    hideNotice();
    if (setupPending || setupAuto) {
      setupPending = false;
      closeSetup();
    }
    if (!listsLoaded) {
      listsLoaded = true;
      loadLists();
    }
    syncTimer();
    resumePomo(); // reprend un Pomodoro en cours dès la connexion
    updateLiveVisibility();
    if (reactOn() && state.on) applySensorColor();
    render();
  }

  function handleStatus(status) {
    model.status = status;
    els.app.dataset.status = status;
    updateLiveVisibility();
    if (status === "offline" && setupPending) {
      setupPending = false;
      setSetupMsg("Aucune réponse de " + model.ip + ". " + technicalDetail(), "is-error");
      els.setupSave.disabled = false;
      render();
      return;
    }
    if (status === "offline" && !els.setup.hidden) return;
    if (status === "offline") {
      showNotice(
        "Contrôleur introuvable",
        "Aucune réponse de " + model.ip + ". Vérifie que le WLED est allumé, sur le même réseau, et que l’adresse IP est exacte.",
        true
      );
    }
    render();
  }

  // Appui long sur l'orbe : ouvre la minuterie de veille.
  let orbPressTimer = null;
  let orbLongPress = false;
  els.orb.addEventListener("pointerdown", () => {
    orbLongPress = false;
    clearTimeout(orbPressTimer);
    orbPressTimer = setTimeout(() => { orbLongPress = true; openTimer(); }, 650);
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach((ev) =>
    els.orb.addEventListener(ev, () => clearTimeout(orbPressTimer))
  );
  els.orb.addEventListener("contextmenu", (e) => e.preventDefault());

  els.orb.addEventListener("click", () => {
    if (orbLongPress) { orbLongPress = false; return; }
    if (!model.state) return;
    const next = !model.state.on;
    applyLocal({ on: next });
    client.send({ on: next });
  });

  /* ================= Style ================= */

  function applyStyle() {
    const root = document.documentElement.style;
    root.setProperty("--text", setting("textColor"));
    root.setProperty("--bg", setting("backgroundColor"));
    // Opacité du fond : 100 % = fond plein, 0 % = fond invisible (seul le contenu reste).
    const raw = Number(setting("bgOpacity"));
    const opacity = clamp(isFinite(raw) ? raw : 100, 0, 100);
    root.setProperty("--transparency", 100 - opacity + "%");
  }

  /* ================= Minuterie de veille ================= */

  // WLED appelle cette fonction « veilleuse » (nl) : fondu progressif puis extinction.
  let timerEnd = 0;

  function syncTimer() {
    const nl = model.state && model.state.nl;
    if (nl && nl.on && model.state.on) {
      const rem = typeof nl.rem === "number" && nl.rem >= 0 ? nl.rem : (nl.dur || 0) * 60;
      timerEnd = Date.now() + rem * 1000;
    } else {
      timerEnd = 0;
    }
    renderTimer();
  }

  function minutesLeft() {
    if (!timerEnd) return 0;
    return Math.max(0, Math.ceil((timerEnd - Date.now()) / 60000));
  }

  function renderTimer() {
    const left = minutesLeft();
    if (typeof renderBadge === "function") renderBadge();
    const active = left > 0;
    els.timerBtn.classList.toggle("is-active", active);
    els.timerLeft.textContent = active ? String(left) : "";
    els.timerBtn.classList.toggle("has-time", active);
    els.timerCancel.hidden = !active;
    els.timerInfo.textContent = active
      ? "Extinction dans " + left + " min. Choisis une autre durée pour la remplacer."
      : "Les DEL baissent doucement puis s’éteignent.";
  }

  function openTimer(tab) {
    if (!model.state) return;
    selectSheetTab(tab === "prog" ? "prog" : "timers");
    renderTimer();
    renderSchedule();
    els.timerSheet.hidden = false;
    loadSchedule(); // relit à chaque ouverture, au cas où l'horaire a changé ailleurs
    renderBreakChoices();
    renderCountdown();
    loadCirc();
  }

  function closeTimer() {
    els.timerSheet.hidden = true;
  }

  function startTimer(minutes) {
    const nl = { on: true, dur: minutes, mode: 1, tbri: 0 };
    if (model.state) { model.state.nl = Object.assign({}, nl, { rem: minutes * 60 }); model.state.on = true; }
    client.send({ on: true, nl });
    syncTimer();
    render();
    closeTimer();
  }

  function cancelTimer() {
    if (model.state && model.state.nl) model.state.nl.on = false;
    client.send({ nl: { on: false } });
    syncTimer();
    closeTimer();
  }

  els.timerBtn.addEventListener("click", openTimer);

  // Onglets de la fenêtre Routines
  function selectSheetTab(name) {
    els.timerSheet.querySelectorAll(".sheet-tabs button").forEach((b) => b.classList.toggle("is-active", b.dataset.stab === name));
    els.timerSheet.querySelectorAll(".stab").forEach((t) => { t.hidden = t.dataset.stab !== name; });
    const title = document.getElementById("sheetTitle");
    if (title) title.textContent = name === "prog" ? "Programmation" : "Minuteries";
    els.timerSheet.scrollTop = 0;
  }
  els.timerSheet.querySelectorAll(".sheet-tabs button").forEach((b) => b.addEventListener("click", () => selectSheetTab(b.dataset.stab)));
  els.timerClose.addEventListener("click", closeTimer);
  els.timerCancel.addEventListener("click", cancelTimer);
  els.timerSheet.querySelectorAll("button[data-min]").forEach((b) => {
    b.addEventListener("click", () => startTimer(Number(b.dataset.min)));
  });
  setInterval(renderTimer, 20000);

  /* ================= Horaire programmé dans le WLED (lecture) ================= */

  const schedule = { loaded: false, loading: false, entries: [], error: "", clock: "" };
  const DAY_NAMES = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"];

  // dow : bit 0 = lundi ... bit 6 = dimanche (format de WLED).
  function formatDays(dow) {
    const d = Number(dow) & 127;
    if (d === 127) return "Tous les jours";
    if (d === 31) return "Du lundi au vendredi";
    if (d === 96) return "Samedi et dimanche";
    if (d === 0) return "Aucun jour";
    const list = DAY_NAMES.filter((_, i) => d & (1 << i));
    return list.map((x, i) => (i === 0 ? x.charAt(0).toUpperCase() + x.slice(1) : x)).join(", ");
  }

  function formatRange(e) {
    const s = e.start || {}, en = e.end || {};
    const ms = s.mon || 1, ds = s.day || 1, me = en.mon || 12, de = en.day || 31;
    if (ms === 1 && ds === 1 && me === 12 && de === 31) return "";
    const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
    return ", du " + ds + " " + MONTHS[ms - 1] + " au " + de + " " + MONTHS[me - 1];
  }

  function presetName(id) {
    const n = model.presetNames && model.presetNames[String(id)];
    return n || "Préréglage " + id;
  }

  // Avant WLED 16, le lever ET le coucher du soleil utilisaient l'heure 255 :
  // le premier rencontré était le lever, le second le coucher.
  function describeTimes(entries, info) {
    const legacy = !info || !info.vid || Number(info.vid) < 2605010;
    let seen255 = false;
    return entries.map((e) => {
      let h = Number(e.hour);
      if (legacy && h === 255) {
        if (seen255) h = 254;
        seen255 = true;
      }
      const m = Number(e.min) || 0;
      let time;
      if (h === 255 || h === 254) {
        const base = h === 255 ? "lever du soleil" : "coucher du soleil";
        if (m === 0) time = base.charAt(0).toUpperCase() + base.slice(1);
        else time = Math.abs(m) + " min " + (m > 0 ? "après le " : "avant le ") + base;
      } else if (h === 24) {
        time = "Chaque heure, à " + String(m).padStart(2, "0");
      } else {
        time = String(h).padStart(2, "0") + " h " + String(m).padStart(2, "0");
      }
      return { time, sun: h >= 254, entry: e };
    });
  }

  async function loadSchedule() {
    if (schedule.loading || !model.ip) return;
    schedule.loading = true;
    try {
      const res = await client.loadSchedule();
      // Les cases vides (sans préréglage) de WLED 0.15 ne sont pas affichées.
      schedule.entries = describeTimes(res.entries, res.info || model.info).filter((x) => Number(x.entry.macro) !== 0);
      schedule.error = "";
      const t = res.info && res.info.time;
      schedule.clock = t ? "Heure du WLED : " + String(t).split(",").pop().trim().slice(0, 5) : "";
    } catch (e) {
      schedule.error = "Impossible de lire l’horaire du WLED (" + ((e && e.message) || e) + ").";
    }
    schedule.loaded = true;
    schedule.loading = false;
    renderSchedule();
  }

  function renderSchedule() {
    els.schedClock.textContent = schedule.clock;
    els.schedList.innerHTML = "";
    const note = (text) => {
      const li = document.createElement("li");
      li.className = "sched-empty";
      li.textContent = text;
      els.schedList.appendChild(li);
    };
    if (!schedule.loaded) return note("Lecture de l’horaire…");
    if (schedule.error) return note(schedule.error);
    if (schedule.entries.length === 0) return note("Aucun horaire n’est programmé dans le WLED pour l’instant.");
    schedule.entries.forEach((x) => {
      const li = document.createElement("li");
      li.className = "sched-item" + (x.entry.en ? "" : " is-disabled");
      const time = document.createElement("span");
      time.className = "sched-time";
      time.textContent = x.sun ? "" : x.time;
      const what = document.createElement("span");
      what.className = "sched-what";
      const ps = document.createElement("span");
      ps.className = "sched-preset";
      ps.style.display = "block";
      ps.textContent = (x.sun ? x.time + " : " : "") + presetName(x.entry.macro);
      const days = document.createElement("span");
      days.className = "sched-days";
      days.textContent = formatDays(x.entry.dow) + formatRange(x.entry);
      what.append(ps, days);
      li.append(time, what);
      els.schedList.appendChild(li);
    });
  }

  /* ================= Programmer l'allumage et l'extinction ================= */

  const S = window.EdgeGlowSchedule;
  const MONTHS_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  const DAY_LETTERS = ["L", "M", "M", "J", "V", "S", "D"];
  const ed = { plan: null, busy: false, confirmRemove: false, hasExisting: false };

  const edEls = {
    root: $("#schedEditor"), body: $("#edBody"), msg: $("#edMsg"),
    save: $("#edSave"), remove: $("#edRemove"), close: $("#edClose"),
  };

  function defaultPlan() {
    return {
      // Inactifs par défaut : rien n'est programmé tant que l'utilisateur ne l'active pas.
      on: { enabled: false, type: "time", hour: 17, min: 30, offset: 0, wake: false, wakeMin: 20 },
      off: { enabled: false, type: "time", hour: 23, min: 0, offset: 0 },
      dow: 127,
      allYear: true,
      start: { mon: 11, day: 1 },
      end: { mon: 3, day: 31 },
      warning: "",
    };
  }

  function edMsg(text, cls) {
    edEls.msg.textContent = text || "";
    edEls.msg.className = "setup-msg" + (cls ? " " + cls : "");
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function stepper(value, onMinus, onPlus, label, wide) {
    const wrap = el("div", "stepper" + (wide ? " stepper-wide" : ""));
    const minus = el("button", "", "−");
    minus.type = "button";
    minus.setAttribute("aria-label", label + " : diminuer");
    minus.addEventListener("click", () => { onMinus(); renderEditor(); });
    const plus = el("button", "", "+");
    plus.type = "button";
    plus.setAttribute("aria-label", label + " : augmenter");
    plus.addEventListener("click", () => { onPlus(); renderEditor(); });
    wrap.append(minus, el("span", "stepper-value", value), plus);
    return wrap;
  }

  const wrap = (v, min, max) => (v > max ? min : v < min ? max : v);
  const pad2 = (n) => String(n).padStart(2, "0");

  function offsetText(m, type) {
    const sun = type === "sunrise" ? "lever" : "coucher";
    if (!m) return "Au " + sun + " du soleil";
    return Math.abs(m) + " min " + (m < 0 ? "avant" : "après") + " le " + sun;
  }

  function stepCard(key, title) {
    const step = ed.plan[key];
    const card = el("section", "ed-card" + (step.enabled ? "" : " is-off"));
    const row = el("div", "ed-row");
    row.append(el("span", "ed-label", title));
    const tog = el("button", "ed-toggle" + (step.enabled ? " is-on" : ""), step.enabled ? "Actif" : "Inactif");
    tog.type = "button";
    tog.addEventListener("click", () => {
      step.enabled = !step.enabled;
      const none = !ed.plan.on.enabled && !ed.plan.off.enabled;
      if (none && ed.hasExisting) edMsg("Les deux sont inactifs : Enregistrer retirera l’horaire EdgeGlow du WLED.");
      else if (none) edMsg("Aucun horaire programmé. Active l’allumage, l’extinction ou les deux pour en créer un.");
      else edMsg("Règle les heures, puis Enregistrer.");
      renderEditor();
    });
    row.append(tog);
    card.append(row);

    const chips = el("div", "ed-chips");
    [["time", "Heure"], ["sunrise", "Lever du soleil"], ["sunset", "Coucher du soleil"]].forEach(([t, label]) => {
      const b = el("button", t === step.type ? "is-active" : "", label);
      b.type = "button";
      b.addEventListener("click", () => { step.type = t; renderEditor(); });
      chips.append(b);
    });
    card.append(chips);

    if (step.type === "time") {
      const row2 = el("div", "ed-steppers");
      row2.append(
        stepper(pad2(step.hour), () => (step.hour = wrap(step.hour - 1, 0, 23)), () => (step.hour = wrap(step.hour + 1, 0, 23)), "Heure"),
        el("span", "ed-sep", ":"),
        stepper(pad2(step.min), () => (step.min = wrap(Math.ceil(step.min / 5) * 5 - 5, 0, 55)), () => (step.min = wrap(Math.floor(step.min / 5) * 5 + 5, 0, 55)), "Minutes")
      );
      card.append(row2);
    } else {
      const row2 = el("div", "ed-steppers");
      row2.append(stepper(
        (step.offset > 0 ? "+" : step.offset < 0 ? "−" : "") + Math.abs(step.offset) + " min",
        () => (step.offset = Math.max(-120, step.offset - 5)),
        () => (step.offset = Math.min(120, step.offset + 5)),
        "Décalage", true
      ));
      card.append(row2, el("p", "ed-hint", offsetText(step.offset, step.type)));
    }

    if (key === "on") {
      const wrow = el("div", "ed-row ed-wake");
      wrow.append(el("span", "ed-sublabel", "Réveil lever du soleil"));
      const wt = el("button", "ed-toggle ed-toggle-sm" + (step.wake ? " is-on is-wake" : ""), step.wake ? "Oui" : "Non");
      wt.type = "button";
      wt.addEventListener("click", () => { step.wake = !step.wake; renderEditor(); });
      wrow.append(wt);
      card.append(wrow);
      if (step.wake) {
        const r = el("div", "ed-steppers");
        r.append(stepper(step.wakeMin + " min",
          () => (step.wakeMin = Math.max(5, step.wakeMin - 5)),
          () => (step.wakeMin = Math.min(60, step.wakeMin + 5)),
          "Durée de l’aube", true));
        card.append(r, el("p", "ed-hint", "Les DEL s’allument doucement, du rouge sombre au blanc chaud, sur " + step.wakeMin + " min."));
      }
    }
    return card;
  }

  function daysCard() {
    const card = el("section", "ed-card ed-common");
    card.append(el("span", "ed-label", "Jours"));
    const days = el("div", "ed-chips ed-days");
    window.EdgeGlowI18n.dayLetters().forEach((letter, i) => {
      const on = (ed.plan.dow >> i) & 1;
      const b = el("button", on ? "is-active" : "", letter);
      b.type = "button";
      b.setAttribute("aria-label", ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"][i]);
      b.addEventListener("click", () => { ed.plan.dow ^= 1 << i; renderEditor(); });
      days.append(b);
    });
    const quick = el("div", "ed-chips");
    [[127, "Tous les jours"], [31, "Semaine"], [96, "Fin de semaine"]].forEach(([v, label]) => {
      const b = el("button", ed.plan.dow === v ? "is-active" : "", label);
      b.type = "button";
      b.addEventListener("click", () => { ed.plan.dow = v; renderEditor(); });
      quick.append(b);
    });
    card.append(days, quick);
    return card;
  }

  function periodCard() {
    const card = el("section", "ed-card ed-common");
    card.append(el("span", "ed-label", "Période"));
    const chips = el("div", "ed-chips");
    [[true, "Toute l’année"], [false, "Entre deux dates"]].forEach(([v, label]) => {
      const b = el("button", ed.plan.allYear === v ? "is-active" : "", label);
      b.type = "button";
      b.addEventListener("click", () => { ed.plan.allYear = v; renderEditor(); });
      chips.append(b);
    });
    card.append(chips);
    if (!ed.plan.allYear) {
      const grid = el("div", "ed-dates");
      [["start", "Du"], ["end", "Au"]].forEach(([k, label]) => {
        const d = ed.plan[k];
        grid.append(el("p", "ed-hint", label));
        const row = el("div", "ed-steppers");
        row.append(
          stepper(String(d.day), () => (d.day = wrap(d.day - 1, 1, 31)), () => (d.day = wrap(d.day + 1, 1, 31)), label + " jour"),
          stepper(MONTHS_SHORT[d.mon - 1], () => (d.mon = wrap(d.mon - 1, 1, 12)), () => (d.mon = wrap(d.mon + 1, 1, 12)), label + " mois", true)
        );
        grid.append(row);
      });
      card.append(grid);
    }
    return card;
  }

  function renderEditor() {
    edEls.body.innerHTML = "";
    if (!ed.plan) return;
    if (ed.plan.warning) edEls.body.append(el("p", "ed-warn", ed.plan.warning));
    edEls.body.append(stepCard("on", "Allumage"), stepCard("off", "Extinction"), daysCard(), periodCard());
    edEls.body.classList.toggle("nothing-on", !ed.plan.on.enabled && !ed.plan.off.enabled);
    edEls.remove.hidden = !ed.hasExisting;
    edEls.remove.textContent = ed.confirmRemove ? "Confirmer le retrait" : "Retirer";
    edEls.save.disabled = ed.busy;
    edEls.remove.disabled = ed.busy;
  }

  async function openEditor() {
    ed.plan = null;
    ed.busy = true;
    ed.confirmRemove = false;
    edEls.root.hidden = false;
    renderEditor();
    edMsg("Lecture de l’horaire du WLED…");
    try {
      const cur = await S.readCurrent(client);
      const plan = defaultPlan();
      const ref = cur.onEntry || cur.offEntry;
      if (cur.onEntry) plan.on = Object.assign(plan.on, S.entryToStep(cur.onEntry, cur.wake));
      else if (ref) plan.on.enabled = false;
      if (cur.offEntry) plan.off = Object.assign(plan.off, S.entryToStep(cur.offEntry));
      else if (ref) plan.off.enabled = false;
      if (ref) {
        plan.dow = Number(ref.dow) & 127;
        const st = ref.start || {}, en = ref.end || {};
        const all = (st.mon || 1) === 1 && (st.day || 1) === 1 && (en.mon || 12) === 12 && (en.day || 31) === 31;
        plan.allYear = all;
        if (!all) { plan.start = { mon: st.mon || 1, day: st.day || 1 }; plan.end = { mon: en.mon || 12, day: en.day || 31 }; }
      }
      const t = String((cur.info && cur.info.time) || "");
      const year = parseInt(t, 10);
      if (!(year >= 2020)) {
        plan.warning = "L’heure du WLED ne semble pas réglée. Active la synchronisation de l’heure (NTP) et le bon fuseau horaire dans WLED, dans Config puis Time & Macros, sinon l’horaire ne se déclenchera pas.";
      }
      ed.plan = plan;
      ed.hasExisting = Boolean(ref);
      edMsg(ref
        ? "Horaire EdgeGlow actuel. Modifie-le, puis Enregistrer."
        : "Aucun horaire programmé. Active l’allumage, l’extinction ou les deux pour en créer un.");
    } catch (e) {
      ed.plan = null;
      edMsg("Impossible de lire l’horaire du WLED (" + ((e && e.message) || e) + ").", "is-error");
    }
    ed.busy = false;
    renderEditor();
  }

  function closeEditor() {
    if (ed.busy) return;
    edEls.root.hidden = true;
  }

  async function saveEditor(remove) {
    if (ed.busy || !ed.plan) return;
    const plan = remove ? null : ed.plan;
    if (plan) {
      if (!plan.on.enabled && !plan.off.enabled) {
        // Les deux inactifs : retirer l'horaire existant, ou il n'y a simplement rien à faire.
        if (!ed.hasExisting) return edMsg("Rien à enregistrer : aucun horaire n’est actif.", "");
        return saveEditor(true);
      }
      if ((plan.dow & 127) === 0) return edMsg("Choisis au moins un jour.", "is-error");
    }
    ed.busy = true;
    renderEditor();
    edMsg(remove ? "Retrait de l’horaire…" : "Enregistrement dans le WLED… La première fois, les DEL peuvent clignoter une fois.", "is-busy");
    try {
      await S.save(client, plan, Boolean(model.state && model.state.on));
      edMsg(remove ? "Horaire EdgeGlow retiré." : "Horaire enregistré dans le WLED.", "is-ok");
      ed.busy = false;
      listsLoaded = false; // les nouveaux préréglages apparaîtront dans les noms
      loadLists();
      loadSchedule();
      setTimeout(() => { if (!ed.busy) edEls.root.hidden = true; }, 1300);
    } catch (e) {
      ed.busy = false;
      edMsg("Échec : " + ((e && e.message) || e) + ". Rien n’a été modifié dans l’horaire.", "is-error");
    }
    ed.confirmRemove = false;
    renderEditor();
  }

  edEls.close.addEventListener("click", closeEditor);
  edEls.save.addEventListener("click", () => saveEditor(false));
  edEls.remove.addEventListener("click", () => {
    if (!ed.confirmRemove) { ed.confirmRemove = true; renderEditor(); return; }
    saveEditor(true);
  });
  document.getElementById("schedEdit").addEventListener("click", openEditor);

  /* ================= Pomodoro lumineux ================= */

  // Travail : l'effet « Percent » remplit la bande en orange au fil des minutes.
  // Pause : respiration verte. Longue pause (après 4 cycles) : respiration bleue.
  // À la fin (ou sur Arrêter), l'éclairage d'avant est rétabli.
  const POMO_KEY = "edgeglow-pomodoro";
  const POMO_CYCLES = 4;
  let pomo = null;
  let pomoTimer = null;
  let pomoLastPct = -1;

  const pomoEls = {
    status: $("#pomoStatus"), idle: $("#pomoIdle"), run: $("#pomoRun"), fill: $("#pomoFill"),
    pause: $("#pomoPause"), skip: $("#pomoSkip"), stop: $("#pomoStop"),
    chip: $("#hPomo"), chipText: $("#hPomoText"), chipLabel: $("#hPomoLabel"),
  };

  function pomoSave() {
    try { pomo ? localStorage.setItem(POMO_KEY, JSON.stringify(pomo)) : localStorage.removeItem(POMO_KEY); } catch (e) { /* ignoré */ }
  }

  function fxId(name, fallback) {
    const f = model.effects.find((x) => x.name.toLowerCase() === name.toLowerCase());
    return f ? f.id : fallback;
  }
  function palId(name, fallback) {
    const p = model.palettes.find((x) => x.name.toLowerCase() === name.toLowerCase());
    return p ? p.id : fallback;
  }

  function phaseLength(p) {
    const min = p.phase === "work" ? p.work : p.phase === "long" ? p.long : p.brk;
    return min * 60000;
  }

  function pomoElapsed(p) {
    const now = p.paused ? p.pausedAt : Date.now();
    return Math.max(0, now - p.phaseStart);
  }

  function phaseLabel(p) {
    return p.phase === "work" ? "Focus" : p.phase === "long" ? "Longue pause" : "Pause";
  }

  function fmt(ms) {
    const t = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0");
  }

  function applyPomoPhase() {
    if (!pomo) return;
    const pal = palId("Color 1", 2);
    if (pomo.phase === "work") {
      pomoLastPct = 0;
      client.send({ on: true, seg: { fx: fxId("Percent", 98), pal, sx: 120, ix: 0, col: [[255, 110, 30], [26, 8, 0], [0, 0, 0]] } });
    } else {
      const col = pomo.phase === "long" ? [[40, 150, 255], [0, 0, 0], [0, 0, 0]] : [[40, 220, 120], [0, 0, 0], [0, 0, 0]];
      client.send({ on: true, seg: { fx: fxId("Breathe", 2), pal, sx: 70, col } });
    }
  }

  function nextPomoPhase() {
    if (!pomo) return;
    if (pomo.phase === "work") {
      pomo.phase = pomo.cycle >= POMO_CYCLES ? "long" : "break";
    } else if (pomo.phase === "break") {
      pomo.phase = "work";
      pomo.cycle += 1;
    } else {
      stopPomo(true);
      return;
    }
    pomo.phaseStart = Date.now();
    pomo.paused = false;
    pomoSave();
    applyPomoPhase();
    renderPomo();
  }

  let pomoTicks = 0;
  function pomoTick() {
    if (!pomo) return;
    if (++pomoTicks % 15 === 0) render(); // rafraîchit le texte de Halo (minutes restantes)
    const len = phaseLength(pomo);
    const el = pomoElapsed(pomo);
    if (!pomo.paused && el >= len) { nextPomoPhase(); return; }
    // Barre de progression sur les DEL : seulement si l'effet Percent est toujours actif
    // (si tu as choisi un autre effet entre-temps, on ne l'écrase pas).
    if (pomo.phase === "work" && !pomo.paused) {
      const pct = Math.min(100, Math.floor((el / len) * 100));
      const seg = mainSegment();
      if (pct !== pomoLastPct && seg && seg.fx === fxId("Percent", 98)) {
        pomoLastPct = pct;
        client.send({ seg: { ix: pct } });
      }
    }
    renderPomo();
  }

  async function startPomo(work, brk) {
    // Photo de l'éclairage actuel (déjà connu en direct) pour le rétablir à la fin.
    let snap = model.state && Array.isArray(model.state.seg) ? JSON.parse(JSON.stringify(model.state)) : null;
    if (!snap) {
      try { snap = await client.getJson("/json/state"); } catch (e) { snap = null; }
    }
    pomo = { work, brk, long: brk * 3, cycle: 1, phase: "work", phaseStart: Date.now(), paused: false, pausedAt: 0, snap };
    pomoSave();
    applyPomoPhase();
    clearInterval(pomoTimer);
    pomoTimer = setInterval(pomoTick, 1000);
    renderPomo();
    render();
  }

  function stopPomo(finished) {
    if (!pomo) return;
    const snap = pomo.snap;
    pomo = null;
    pomoSave();
    clearInterval(pomoTimer);
    pomoTimer = null;
    if (snap && Array.isArray(snap.seg)) {
      const segs = snap.seg.map((g) => ({ id: g.id, fx: g.fx, sx: g.sx, ix: g.ix, pal: g.pal, col: g.col, on: g.on, bri: g.bri }));
      client.send({ on: Boolean(snap.on), bri: snap.bri, seg: segs });
    }
    pomoEls.status.textContent = finished ? "Bravo, 4 cycles terminés!" : "La bande se remplit pendant le travail";
    renderPomo();
    render();
  }

  function togglePausePomo() {
    if (!pomo) return;
    if (pomo.paused) {
      pomo.phaseStart += Date.now() - pomo.pausedAt;
      pomo.paused = false;
    } else {
      pomo.paused = true;
      pomo.pausedAt = Date.now();
    }
    pomoSave();
    renderPomo();
  }

  function renderPomo() {
    const active = Boolean(pomo);
    pomoEls.idle.hidden = active;
    pomoEls.run.hidden = !active;
    pomoEls.chip.hidden = !active;
    if (!active) return;
    const len = phaseLength(pomo);
    const left = len - pomoElapsed(pomo);
    const label = phaseLabel(pomo);
    pomoEls.status.textContent = label + " : " + fmt(left) + (pomo.paused ? " (en pause)" : "") + ", cycle " + pomo.cycle + " sur " + POMO_CYCLES;
    pomoEls.fill.style.width = Math.min(100, (pomoElapsed(pomo) / len) * 100) + "%";
    pomoEls.run.classList.toggle("is-break", pomo.phase === "break");
    pomoEls.run.classList.toggle("is-long", pomo.phase === "long");
    pomoEls.pause.textContent = pomo.paused ? "Reprendre" : "Pause";
    pomoEls.chip.classList.toggle("is-break", pomo.phase === "break");
    pomoEls.chip.classList.toggle("is-long", pomo.phase === "long");
    pomoEls.chip.classList.toggle("is-paused", pomo.paused);
    pomoEls.chipLabel.textContent = pomo.phase === "work" ? "Focus " : "Pause ";
    pomoEls.chipText.textContent = fmt(left);
  }

  // Titre et sous-titre de Halo pendant un Pomodoro.
  function pomoHaloText() {
    if (!pomo) return null;
    const left = phaseLength(pomo) - pomoElapsed(pomo);
    return {
      title: phaseLabel(pomo),
      sub: "Cycle " + pomo.cycle + " sur " + POMO_CYCLES + (pomo.paused ? ", en pause" : ""),
    };
  }

  pomoEls.idle.querySelectorAll("button[data-pomo]").forEach((b) => {
    b.addEventListener("click", () => {
      const [w, br] = b.dataset.pomo.split(",").map(Number);
      startPomo(w, br);
    });
  });
  pomoEls.pause.addEventListener("click", togglePausePomo);
  pomoEls.skip.addEventListener("click", nextPomoPhase);
  pomoEls.stop.addEventListener("click", () => stopPomo(false));
  pomoEls.chip.addEventListener("click", () => openTimer());

  // Reprise après un redémarrage d'iCUE : le Pomodoro continue là où il était.
  function resumePomo() {
    if (pomo || pomoTimer) return;
    try { pomo = JSON.parse(localStorage.getItem(POMO_KEY) || "null"); } catch (e) { pomo = null; }
    if (!pomo) return;
    clearInterval(pomoTimer);
    pomoTimer = setInterval(pomoTick, 1000);
    pomoTick();
  }

  /* ================= Outils communs : photo et retour de l'éclairage ================= */

  function captureLocal() {
    return model.state && Array.isArray(model.state.seg) ? JSON.parse(JSON.stringify(model.state)) : null;
  }
  function restoreLocal(snap) {
    if (!snap || !Array.isArray(snap.seg)) return;
    const segs = snap.seg.map((g) => ({ id: g.id, fx: g.fx, sx: g.sx, ix: g.ix, pal: g.pal, col: g.col, on: g.on, bri: g.bri }));
    client.send({ on: Boolean(snap.on), bri: snap.bri, seg: segs });
  }
  function lsGet(k, d) { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v === null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignoré */ } }

  /* ================= Mode cinéma ================= */

  let cinema = lsGet("edgeglow-cinema", null); // { snap } quand actif
  const cinemaBtn = $("#cinemaBtn");

  function setCinema(on) {
    if (on && !cinema) {
      cinema = { snap: captureLocal() };
      client.send({ on: true, bri: 26, seg: { fx: 0, col: [colorPayload([255, 147, 41])] } }); // 10 %, blanc très chaud
    } else if (!on && cinema) {
      restoreLocal(cinema.snap);
      cinema = null;
    }
    lsSet("edgeglow-cinema", cinema);
    renderBadge();
    render();
  }
  cinemaBtn.addEventListener("click", () => { setCinema(!cinema); closeDrawer(); });

  /* ================= Rappel de pause ================= */

  let breakCfg = lsGet("edgeglow-break", { every: 0, last: Date.now() });
  let breakActive = null; // { snap, until } pendant la pulsation

  function renderBreakChoices() {
    $("#breakChoices").querySelectorAll("button").forEach((b) => b.classList.toggle("is-active", Number(b.dataset.every) === breakCfg.every));
    const st = $("#breakStatus");
    if (!breakCfg.every) st.textContent = "Une douce pulsation bleue te rappelle de bouger";
    else {
      const left = Math.max(0, breakCfg.last + breakCfg.every * 60000 - Date.now());
      st.textContent = "Prochain rappel dans " + Math.ceil(left / 60000) + " min";
    }
  }
  $("#breakChoices").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    breakCfg = { every: Number(b.dataset.every), last: Date.now() };
    lsSet("edgeglow-break", breakCfg);
    renderBreakChoices();
  }));

  function endBreakPulse() {
    if (!breakActive) return;
    restoreLocal(breakActive.snap);
    breakActive = null;
    renderBadge();
    render();
  }

  function breakTick() {
    if (breakActive && Date.now() >= breakActive.until) endBreakPulse();
    if (!breakCfg.every || breakActive) return;
    if (Date.now() - breakCfg.last < breakCfg.every * 60000) return;
    breakCfg.last = Date.now();
    lsSet("edgeglow-break", breakCfg);
    // Pas de rappel si les DEL sont éteintes ou si un Pomodoro ou le mode cinéma est en cours.
    const pomoOn = typeof pomo !== "undefined" && pomo;
    if (!model.state || !model.state.on || pomoOn || cinema) return;
    breakActive = { snap: captureLocal(), until: Date.now() + 20000 };
    setTimeout(render, 0);
    client.send({ seg: { fx: fxId("Breathe", 2), pal: palId("Color 1", 2), sx: 110, col: [[70, 150, 255], [0, 0, 0], [0, 0, 0]] } });
    renderBadge();
  }

  /* ================= Compte à rebours lumineux ================= */

  const CD_BAR_MIN = 60; // la bande se vide pendant la dernière heure
  let countdown = lsGet("edgeglow-countdown", null); // { target, snap, phase }
  const cdDraft = (() => {
    const d = new Date(Date.now() + 24 * 3600000);
    return { day: d.getDate(), mon: d.getMonth() + 1, hour: 20, min: 0 };
  })();

  function draftTarget() {
    const now = new Date();
    let t = new Date(now.getFullYear(), cdDraft.mon - 1, cdDraft.day, cdDraft.hour, cdDraft.min, 0);
    if (t.getTime() <= now.getTime()) t = new Date(now.getFullYear() + 1, cdDraft.mon - 1, cdDraft.day, cdDraft.hour, cdDraft.min, 0);
    return t.getTime();
  }

  function fmtLeft(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (d >= 1) return "J-" + d + (h ? " " + h + " h" : "");
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(sec).padStart(2, "0");
  }

  function renderCountdownEditor() {
    const box = $("#cdEdit");
    box.innerHTML = "";
    if (countdown) return;
    const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
    const w = (v, a, b) => (v > b ? a : v < a ? b : v);
    const mk = (val, minus, plus, label, wide) => {
      const n = document.createElement("div");
      n.className = "stepper" + (wide ? " stepper-wide" : "");
      const bm = document.createElement("button"); bm.type = "button"; bm.textContent = "−"; bm.setAttribute("aria-label", label + " : diminuer");
      const v = document.createElement("span"); v.className = "stepper-value"; v.textContent = val;
      const bp = document.createElement("button"); bp.type = "button"; bp.textContent = "+"; bp.setAttribute("aria-label", label + " : augmenter");
      bm.addEventListener("click", () => { minus(); renderCountdownEditor(); });
      bp.addEventListener("click", () => { plus(); renderCountdownEditor(); });
      n.append(bm, v, bp);
      return n;
    };
    box.append(
      mk(String(cdDraft.day), () => (cdDraft.day = w(cdDraft.day - 1, 1, 31)), () => (cdDraft.day = w(cdDraft.day + 1, 1, 31)), "Jour"),
      mk(MONTHS[cdDraft.mon - 1], () => (cdDraft.mon = w(cdDraft.mon - 1, 1, 12)), () => (cdDraft.mon = w(cdDraft.mon + 1, 1, 12)), "Mois", true),
      mk(String(cdDraft.hour).padStart(2, "0") + " h", () => (cdDraft.hour = w(cdDraft.hour - 1, 0, 23)), () => (cdDraft.hour = w(cdDraft.hour + 1, 0, 23)), "Heure", true),
      mk(String(cdDraft.min).padStart(2, "0"), () => (cdDraft.min = w(cdDraft.min - 5, 0, 55)), () => (cdDraft.min = w(cdDraft.min + 5, 0, 55)), "Minutes")
    );
  }

  function renderCountdown() {
    $("#cdStart").hidden = Boolean(countdown);
    $("#cdStop").hidden = !countdown;
    const st = $("#cdStatus");
    if (countdown) st.textContent = "Il reste " + fmtLeft(countdown.target - Date.now());
    else st.textContent = "Moment choisi : " + new Date(draftTarget()).toLocaleString(window.EdgeGlowI18n.locale(), { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
    renderCountdownEditor();
  }

  $("#cdStart").addEventListener("click", () => {
    countdown = { target: draftTarget(), snap: null, phase: "wait" };
    lsSet("edgeglow-countdown", countdown);
    renderCountdown();
    renderBadge();
  });
  $("#cdStop").addEventListener("click", () => {
    if (countdown && countdown.snap) restoreLocal(countdown.snap);
    countdown = null;
    lsSet("edgeglow-countdown", null);
    renderCountdown();
    renderBadge();
  });

  let cdLastPct = -1;
  function countdownTick() {
    if (!countdown) return;
    const left = countdown.target - Date.now();
    const pomoOn = typeof pomo !== "undefined" && pomo;
    if (countdown.phase === "wait" && left <= CD_BAR_MIN * 60000 && left > 0 && !pomoOn) {
      countdown.phase = "bar";
      countdown.snap = captureLocal();
      cdLastPct = -1;
      client.send({ on: true, seg: { fx: fxId("Percent", 98), pal: palId("Color 1", 2), sx: 120, ix: 100, col: [[199, 125, 255], [20, 6, 30], [0, 0, 0]] } });
      lsSet("edgeglow-countdown", countdown);
    }
    if (countdown.phase === "bar") {
      const pct = Math.max(0, Math.min(100, Math.ceil((left / (CD_BAR_MIN * 60000)) * 100)));
      const seg = mainSegment();
      if (pct !== cdLastPct && seg && seg.fx === fxId("Percent", 98)) { cdLastPct = pct; client.send({ seg: { ix: pct } }); }
    }
    if (left <= 0 && countdown.phase !== "party") {
      // C'est le moment : feux d'artifice pendant une minute.
      if (!countdown.snap) countdown.snap = captureLocal();
      countdown.phase = "party";
      countdown.partyEnd = Date.now() + 60000;
      client.send({ on: true, seg: { fx: fxId("Fireworks", 42), pal: palId("Party", 6), sx: 180, ix: 200 } });
      lsSet("edgeglow-countdown", countdown);
    }
    if (countdown.phase === "party" && Date.now() >= countdown.partyEnd) {
      restoreLocal(countdown.snap);
      countdown = null;
      lsSet("edgeglow-countdown", null);
    }
    renderBadge();
  }

  /* ================= Lumière circadienne ================= */

  let circ = { active: false, loaded: false, busy: false };

  function renderCirc() {
    const box = $("#circSteps");
    box.innerHTML = "";
    S.CIRC_STEPS.forEach((st) => {
      const c = "rgb(" + st.col.join(",") + ")";
      const n = document.createElement("div");
      n.className = "circ-step";
      const dot = document.createElement("span"); dot.className = "circ-dot"; dot.style.background = c; dot.style.setProperty("--glow-c", c);
      const t = document.createElement("span"); t.className = "circ-time"; t.textContent = String(st.hour).padStart(2, "0") + " h";
      const l = document.createElement("span"); l.className = "circ-label"; l.textContent = st.label;
      n.append(dot, t, l);
      box.append(n);
    });
    box.classList.toggle("is-off", !circ.active);
    const btn = $("#circToggle");
    btn.disabled = circ.busy || !circ.loaded;
    btn.textContent = circ.busy ? "Enregistrement…" : circ.active ? "Désactiver" : "Activer";
    btn.classList.toggle("btn-primary", !circ.active);
    btn.classList.toggle("btn-ghost", circ.active);
    if (!circ.busy) $("#circStatus").textContent = !circ.loaded ? "Lecture…" : circ.active ? "Active, enregistrée dans le WLED" : "Désactivée";
  }

  async function loadCirc() {
    try { const r = await S.readCircadian(client); circ.active = r.active; circ.loaded = true; }
    catch (e) { circ.loaded = false; $("#circStatus").textContent = "Lecture impossible"; }
    renderCirc();
  }

  $("#circToggle").addEventListener("click", async () => {
    if (circ.busy) return;
    circ.busy = true;
    renderCirc();
    $("#circStatus").textContent = "Enregistrement dans le WLED…";
    try {
      const r = await S.saveCircadian(client, !circ.active, Boolean(model.state && model.state.on));
      circ.active = r.active;
      circ.busy = false;
      loadSchedule();
      renderCirc();
    } catch (e) {
      circ.busy = false;
      renderCirc();
      $("#circStatus").textContent = "Échec : " + ((e && e.message) || e);
    }
  });

  /* ================= Respiration guidée ================= */

  // Cohérence cardiaque : 5 s d'inspiration (la bande s'allume), 5 s d'expiration (elle s'éteint).
  let breath = null; // { snap, end, phase }
  let breathTimer = null;

  function breathStep() {
    if (!breath) return;
    if (Date.now() >= breath.end) { stopBreath(); return; }
    breath.phase = breath.phase === "in" ? "out" : "in";
    // tt : durée de la transition en dixièmes de seconde (50 = 5 s)
    client.send({ on: true, bri: breath.phase === "in" ? 200 : 8, tt: 50 });
    els.app.classList.toggle("breath-out", breath.phase === "out");
    render();
  }

  function startBreath(minutes) {
    if (breath) return;
    breath = { snap: captureLocal(), end: Date.now() + minutes * 60000, phase: "out" };
    els.app.classList.add("is-breathing");
    client.send({ on: true, bri: 8, tt: 0, seg: { fx: 0, col: [colorPayload([70, 190, 255])] } });
    clearInterval(breathTimer);
    setTimeout(breathStep, 400);
    breathTimer = setInterval(breathStep, 5000);
    renderBreath();
    closeTimer();
  }

  function stopBreath() {
    if (!breath) return;
    clearInterval(breathTimer);
    breathTimer = null;
    restoreLocal(breath.snap);
    breath = null;
    els.app.classList.remove("is-breathing", "breath-out");
    renderBreath();
    render();
  }

  function renderBreath() {
    $("#breathIdle").hidden = Boolean(breath);
    $("#breathStop").hidden = !breath;
    $("#breathStatus").textContent = breath
      ? "Il reste " + Math.max(1, Math.ceil((breath.end - Date.now()) / 60000)) + " min"
      : "Inspire quand la bande s’allume, expire quand elle s’éteint";
  }

  $("#breathIdle").querySelectorAll("button[data-breath]").forEach((b) => b.addEventListener("click", () => startBreath(Number(b.dataset.breath))));
  $("#breathStop").addEventListener("click", stopBreath);

  /* ================= Fenêtre sur le ciel ================= */

  // La bande imite la couleur du ciel selon la hauteur du soleil chez toi (coordonnées du WLED).
  // [hauteur du soleil en degrés, couleur 1, couleur 2, couleur 3, luminosité]
  const SKY = [
    [-18, [6, 10, 35], [12, 18, 60], [25, 25, 80], 20],
    [-8, [25, 35, 110], [70, 60, 150], [150, 80, 140], 45],
    [-2, [120, 80, 170], [255, 90, 90], [255, 140, 60], 80],
    [4, [140, 170, 255], [255, 160, 100], [255, 120, 50], 120],
    [12, [140, 190, 255], [220, 220, 240], [255, 200, 140], 170],
    [30, [120, 180, 255], [180, 215, 255], [235, 245, 255], 210],
  ];
  let sky = lsGet("edgeglow-sky", null); // { snap } quand actif
  let skyTimer = null, skyFirst = true;

  function sunAltitude(date, lat, lng) {
    const rad = Math.PI / 180, d = date.valueOf() / 864e5 - 0.5 + 2440588 - 2451545;
    const M = rad * (357.5291 + 0.98560028 * d);
    const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    const L = M + C + rad * 102.9372 + Math.PI, e = rad * 23.4397;
    const dec = Math.asin(Math.sin(e) * Math.sin(L));
    const ra = Math.atan2(Math.sin(L) * Math.cos(e), Math.cos(L));
    const H = rad * (280.16 + 360.9856235 * d) - rad * -lng - ra;
    const phi = rad * lat;
    return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)) / rad;
  }

  function skyElevation(now) {
    if (geo) return sunAltitude(now, geo.lat, geo.lng);
    // Sans coordonnées : une journée approximative de 7 h à 18 h 30.
    const h = now.getHours() + now.getMinutes() / 60;
    return h >= 7 && h <= 18.5 ? 45 * Math.sin((Math.PI * (h - 7)) / 11.5) : -20;
  }

  function skyAt(elev) {
    const k = SKY.findIndex((x) => elev < x[0]);
    if (k <= 0) { const x = SKY[k === 0 ? 0 : SKY.length - 1]; return { cols: [x[1], x[2], x[3]], bri: x[4] }; }
    const a = SKY[k - 1], b = SKY[k], t = (elev - a[0]) / (b[0] - a[0]);
    const mix = (p, q) => p.map((v, i) => Math.round(v + (q[i] - v) * t));
    return { cols: [mix(a[1], b[1]), mix(a[2], b[2]), mix(a[3], b[3])], bri: Math.round(a[4] + (b[4] - a[4]) * t) };
  }

  function skyLabel(elev, hour) {
    if (elev < -8) return "Nuit";
    if (elev < -2) return "Heure bleue";
    if (elev < 4) return hour < 12 ? "Aube" : "Crépuscule";
    if (elev < 12) return "Heure dorée";
    return "Plein jour";
  }

  function skyTick() {
    if (!sky || !model.state) return;
    const seg = mainSegment();
    // Si tu as choisi un autre effet entre-temps, la fenêtre sur le ciel s'arrête d'elle-même.
    if (!skyFirst && seg && seg.fx !== fxId("Palette", 65)) { sky = null; lsSet("edgeglow-sky", null); clearInterval(skyTimer); renderBadge(); render(); return; }
    const now = new Date(), elev = skyElevation(now), c = skyAt(elev);
    sky.label = skyLabel(elev, now.getHours());
    client.send({ on: true, bri: c.bri, tt: skyFirst ? 20 : 600, seg: { fx: fxId("Palette", 65), pal: palId("Color Gradient", 4), col: c.cols.map(colorPayload) } });
    skyFirst = false;
    renderBadge();
    render();
  }

  function setSky(on) {
    if (on && !sky) {
      sky = { snap: captureLocal() };
      skyFirst = true;
      skyTick();
      clearInterval(skyTimer);
      skyTimer = setInterval(skyTick, 60000);
    } else if (!on && sky) {
      clearInterval(skyTimer);
      restoreLocal(sky.snap);
      sky = null;
    }
    lsSet("edgeglow-sky", sky);
    renderBadge();
    render();
  }

  $("#skyBtn").addEventListener("click", () => { setSky(!sky); closeDrawer(); });

  function resumeSky() {
    if (sky && !skyTimer) { skyFirst = true; skyTick(); skyTimer = setInterval(skyTick, 60000); }
  }

  /* ================= Titre de Halo pendant une activité ================= */

  function activityText() {
    if (model.demo) return { cap: "Effet", title: "Aurora", sub: "Touche pour connecter" };
    if (typeof breakActive !== "undefined" && breakActive) {
      return { cap: "Rappel", title: "Bouge un peu", sub: "Lève-toi, étire-toi, bois de l’eau" };
    }
    if (typeof countdown !== "undefined" && countdown && countdown.phase !== "wait") {
      return countdown.phase === "party"
        ? { cap: "Compte à rebours", title: "C’est le moment!", sub: "Feux d’artifice pendant une minute" }
        : { cap: "Compte à rebours", title: fmtLeft(countdown.target - Date.now()), sub: "La bande se vide jusqu’au moment choisi" };
    }
    if (typeof breath !== "undefined" && breath) {
      return { cap: "Respiration", title: breath.phase === "in" ? "Inspire" : "Expire", sub: "Il reste " + Math.max(1, Math.ceil((breath.end - Date.now()) / 60000)) + " min" };
    }
    const pt = typeof pomoHaloText === "function" ? pomoHaloText() : null;
    if (pt) return Object.assign({ cap: "Pomodoro" }, pt);
    if (typeof sky !== "undefined" && sky) return { cap: "Fenêtre sur le ciel", title: sky.label || "Ciel", sub: geo ? "Selon la position du soleil chez toi" : "Selon l’heure de la journée" };
    if (typeof cinema !== "undefined" && cinema) return { cap: "Ambiance", title: "Cinéma", sub: "10 %, blanc très chaud" };
    return null;
  }

  /* ================= Badge dans Halo ================= */

  function renderBadge() {
    const b = $("#hBadge"), t = $("#hBadgeText");
    let kind = "", text = "";
    if (model.demo) { kind = "is-demo"; text = "Démo"; }
    else if (breakActive) { kind = "is-break"; text = "Bouge un peu!"; }
    else if (countdown) { kind = "is-countdown"; text = countdown.phase === "party" ? "C’est le moment!" : fmtLeft(countdown.target - Date.now()); }
    else if (typeof minutesLeft === "function" && minutesLeft() > 0) { kind = "is-sleep"; text = (els.app.classList.contains("halo-s") ? "Arrêt " : "Arrêt dans ") + minutesLeft() + " min"; }
    else if (typeof sky !== "undefined" && sky) { kind = "is-sky"; text = "Ciel"; }
    else if (cinema) { kind = "is-cinema"; text = "Cinéma"; }
    b.hidden = !kind;
    b.className = "h-pomo h-badge " + kind;
    t.textContent = text;
    els.app.classList.toggle("badge-on", Boolean(kind));
    cinemaBtn.classList.toggle("is-active", Boolean(cinema));
    if (typeof sky !== "undefined") {
      $("#skyBtn").classList.toggle("is-active", Boolean(sky));
      $("#skySub").textContent = sky ? "Actif : " + (sky.label || "") + ". Touche pour revenir à ton éclairage" : "La bande suit la couleur du ciel, en temps réel";
    }
    $("#cinemaSub").textContent = cinema ? "Actif : touche pour revenir à ton éclairage" : "Tamise tout à 10 % en blanc chaud";
  }
  $("#hBadge").addEventListener("click", () => {
    if (model.demo) openSetup(true);
    else if (breakActive) endBreakPulse();
    else if (countdown || (typeof minutesLeft === "function" && minutesLeft() > 0)) openTimer();
    else if (typeof sky !== "undefined" && sky) setSky(false);
    else if (cinema) setCinema(false);
  });

  /* ================= Mode nuit de l'écran ================= */

  // Lever et coucher du soleil calculés à partir des coordonnées configurées dans le WLED
  // (Config, puis Time & Macros). Sans coordonnées : de 20 h à 7 h.
  let geo = null;

  function sunTimes(date, lat, lng) {
    const rad = Math.PI / 180, dayMs = 864e5, J1970 = 2440588, J2000 = 2451545;
    const d = date.valueOf() / dayMs - 0.5 + J1970 - J2000;
    const lw = rad * -lng, phi = rad * lat, e = rad * 23.4397;
    const n = Math.round(d - 0.0009 - lw / (2 * Math.PI));
    const ds = 0.0009 + lw / (2 * Math.PI) + n;
    const M = rad * (357.5291 + 0.98560028 * ds);
    const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    const L = M + C + rad * 102.9372 + Math.PI;
    const dec = Math.asin(Math.sin(e) * Math.sin(L));
    const Jnoon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
    const cosw = (Math.sin(rad * -0.833) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
    if (cosw > 1 || cosw < -1) return null;
    const w = Math.acos(cosw);
    const Jset = J2000 + 0.0009 + (w + lw) / (2 * Math.PI) + n + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
    const Jrise = Jnoon - (Jset - Jnoon);
    const toDate = (j) => new Date((j + 0.5 - J1970) * dayMs);
    return { rise: toDate(Jrise), set: toDate(Jset) };
  }

  async function loadGeo() {
    try {
      const cfg = await client.getJson("/json/cfg");
      const ntp = cfg && cfg.if && cfg.if.ntp;
      const lat = Number(ntp && ntp.lt), lng = Number(ntp && ntp.ln);
      geo = isFinite(lat) && isFinite(lng) && (lat !== 0 || lng !== 0) ? { lat, lng } : null;
    } catch (e) { geo = null; }
    nightTick();
  }

  function isNightNow() {
    const now = new Date();
    if (geo) {
      const t = sunTimes(now, geo.lat, geo.lng);
      if (t) return now < t.rise || now > t.set;
    }
    const h = now.getHours();
    return h >= 20 || h < 7;
  }

  function nightTick() {
    els.app.classList.toggle("is-night", bool(setting("nightMode")) && isNightNow());
  }

  /* ================= Boucle commune ================= */

  setInterval(() => {
    breakTick();
    countdownTick();
    nightTick();
    if (timerEnd) renderBadge();
    if (!els.timerSheet.hidden) { renderBreakChoices(); renderCountdown(); renderBreath(); }
    if (breakActive || (countdown && countdown.phase !== "wait")) render();
  }, 1000);

  /* ================= Aperçu en direct des DEL ================= */

  let liveFrame = null;
  let liveQueued = false;

  function liveWanted() {
    return bool(setting("liveView"));
  }

  function updateLiveVisibility() {
    const show = model.demo || (liveWanted() && client.liveAvailable);
    els.live.hidden = !show;
    els.app.classList.toggle("has-live", show);
    els.halo.classList.toggle("no-live", !show);
    if (client.liveWanted !== liveWanted()) client.setLive(liveWanted());
  }

  function handleLive(bytes) {
    if (bytes.length < 5 || bytes[0] !== 76) return; // 76 = "L"
    liveFrame = bytes;
    if (!liveQueued) {
      liveQueued = true;
      requestAnimationFrame(drawLive);
    }
  }

  function drawLive() {
    liveQueued = false;
    const bytes = liveFrame;
    if (!bytes || (els.live.hidden && els.halo.hidden)) return;
    const is2D = bytes[1] === 2;
    const start = is2D ? 4 : 2;
    const count = Math.floor((bytes.length - start) / 3);
    if (count <= 0) return;
    const cols = is2D ? Math.max(1, bytes[2]) : count;
    const rows = is2D ? Math.max(1, bytes[3]) : 1;

    // Dessine 1 pixel par DEL : le navigateur agrandit le canevas avec CSS.
    if (!els.halo.hidden) haloColorsFromLive(bytes, start, count);
    [els.liveStrip, els.liveGlow, els.hLive, els.hLiveGlow].forEach((canvas) => {
      if (canvas.width !== cols || canvas.height !== rows) {
        canvas.width = cols;
        canvas.height = rows;
      }
      const ctx = canvas.getContext("2d");
      const img = ctx.createImageData(cols, rows);
      for (let i = 0; i < Math.min(count, cols * rows); i++) {
        const o = start + i * 3;
        img.data[i * 4] = bytes[o];
        img.data[i * 4 + 1] = bytes[o + 1];
        img.data[i * 4 + 2] = bytes[o + 2];
        img.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    });
  }

  /* ================= Couleur selon un capteur du PC ================= */

  const react = { ready: false, sensorId: "", value: null, units: "", name: "", lastHue: null, lastSent: 0, reqId: 1000, pending: {} };

  function reactOn() {
    return bool(setting("reactEnabled")) && react.ready && Boolean(react.sensorId);
  }

  function sensorPlugin() {
    const plugins = window.plugins || readGlobal("plugins");
    return plugins && plugins.Sensorsdataprovider;
  }

  function askSensor(method, id) {
    const plugin = sensorPlugin();
    if (!plugin || typeof plugin[method] !== "function") return Promise.resolve(null);
    return new Promise((resolve) => {
      const reqId = react.reqId++;
      react.pending[reqId] = resolve;
      setTimeout(() => { if (react.pending[reqId]) { delete react.pending[reqId]; resolve(null); } }, 5000);
      plugin[method](reqId, id);
    });
  }

  function initSensors() {
    const plugin = sensorPlugin();
    if (!plugin || react.ready) return;
    react.ready = true;
    plugin.asyncResponse.connect((id, value) => {
      const done = react.pending[id];
      if (done) { delete react.pending[id]; done(value); }
    });
    plugin.sensorValueChanged.connect((id, value) => {
      if (id === react.sensorId) onSensorValue(value);
    });
    configureSensor();
  }

  async function configureSensor() {
    if (!react.ready) return;
    const id = String(setting("reactSensor") || "");
    if (id === react.sensorId) return;
    react.sensorId = id;
    react.value = null;
    react.lastHue = null;
    if (!id) { renderReact(); return; }
    const [value, units, name] = await Promise.all([
      askSensor("getSensorValue", id),
      askSensor("getSensorUnits", id),
      askSensor("getSensorName", id),
    ]);
    react.units = units || "";
    react.name = name || "Capteur";
    if (value !== null) onSensorValue(value);
    renderReact();
  }

  function onSensorValue(raw) {
    const v = parseFloat(String(raw).replace(",", "."));
    if (!isFinite(v)) return;
    react.value = v;
    if (reactOn() && model.state && model.state.on) applySensorColor();
    renderReact();
  }

  // Bleu (valeur basse) vers vert, jaune, puis rouge (valeur haute).
  function sensorHue() {
    let lo = Number(setting("reactMin"));
    let hi = Number(setting("reactMax"));
    if (!(hi > lo)) hi = lo + 1;
    const t = clamp((react.value - lo) / (hi - lo), 0, 1);
    return Math.round(220 * (1 - t));
  }

  function applySensorColor() {
    if (react.value === null) return;
    const hue = sensorHue();
    const now = Date.now();
    // Évite d'inonder le contrôleur : au plus une fois aux 2 s, et seulement si la teinte bouge.
    if (react.lastHue !== null && Math.abs(hue - react.lastHue) < 4) return;
    if (now - react.lastSent < 2000) return;
    react.lastHue = hue;
    react.lastSent = now;
    const rgb = hsvToRgb(hue, 1, 1);
    client.send({ seg: { col: [colorPayload(rgb)] } });
  }

  function renderReact() {
    const on = reactOn();
    els.reactNote.hidden = !on;
    if (on) {
      const val = react.value === null ? "…" : Math.round(react.value * 10) / 10 + " " + react.units;
      els.reactNote.textContent = "La couleur suit « " + react.name + " » (" + val + "). Désactive « Couleur selon un capteur du PC » dans les réglages pour la choisir toi-même.";
    }
  }

  writeGlobal("pluginSensorsdataproviderEvents", { onInitialized: initSensors });
  if (readGlobal("pluginSensorsdataprovider_initialized")) initSensors();

  /* ================= Mise en page Halo (tuiles S et M) ================= */

  const ARC_LEN = 804;       // circonférence du cercle (r = 128)
  const ARC_SPAN = 603;      // 270° visibles
  let haloDrag = false;
  let lastLiveColors = 0;

  function briFromPoint(e) {
    const r = els.hDial.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const a = (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI; // 0 = droite, 90 = bas
    let d = (a - 135 + 360) % 360; // 0 au début de l'anneau (en bas à gauche), sens horaire
    if (d > 270) d = d > 315 ? 0 : 270; // zone vide en bas : on colle au bout le plus proche
    return Math.max(1, Math.round((d / 270) * 255));
  }

  function insideOrb(e) {
    const r = els.hOrb.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    return Math.hypot(e.clientX - cx, e.clientY - cy) <= r.width / 2 + 6;
  }

  function setArc(bri) {
    const len = Math.round((Math.max(0, bri) / 255) * ARC_SPAN);
    els.hArc.style.strokeDasharray = len + " " + ARC_LEN;
    els.hPct.textContent = String(Math.round((bri / 255) * 100));
  }

  els.hDial.addEventListener("pointerdown", (e) => {
    if (insideOrb(e) || !model.state) return;
    haloDrag = true;
    els.hDial.classList.add("is-active");
    els.hDial.setPointerCapture(e.pointerId);
    const bri = briFromPoint(e);
    setArc(bri);
    applyLocal({ on: true, bri });
    sendBri(bri);
  });
  els.hDial.addEventListener("pointermove", (e) => {
    if (!haloDrag) return;
    const bri = briFromPoint(e);
    setArc(bri);
    applyLocal({ on: true, bri });
    sendBri(bri);
  });
  const endDrag = (e) => {
    if (!haloDrag) return;
    haloDrag = false;
    els.hDial.classList.remove("is-active");
    const bri = briFromPoint(e);
    client.send({ on: true, bri });
  };
  els.hDial.addEventListener("pointerup", endDrag);
  els.hDial.addEventListener("pointercancel", () => { haloDrag = false; els.hDial.classList.remove("is-active"); });

  // Orbe : touche = allumer ou éteindre, appui long = minuterie (comme l'orbe classique).
  let hPress = null, hLong = false;
  els.hOrb.addEventListener("pointerdown", () => {
    hLong = false;
    clearTimeout(hPress);
    hPress = setTimeout(() => { hLong = true; openTimer(); }, 650);
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => els.hOrb.addEventListener(ev, () => clearTimeout(hPress)));
  els.hOrb.addEventListener("contextmenu", (e) => e.preventDefault());
  els.hOrb.addEventListener("click", () => {
    if (hLong) { hLong = false; return; }
    if (!model.state) return;
    const next = !model.state.on;
    applyLocal({ on: next });
    client.send({ on: next });
  });

  // Tiroir des menus
  function openDrawer(tab) {
    if (tab === "effects" && fxMenu.openKey) fxMenu.close();
    if (tab === "palettes" && palMenu.openKey) palMenu.close();
    els.app.classList.add("drawer-open");
    els.drawerClose.hidden = false;
    selectTab(tab);
  }
  function closeDrawer() {
    els.app.classList.remove("drawer-open");
    els.drawerClose.hidden = true;
  }
  els.drawerClose.addEventListener("click", closeDrawer);
  els.halo.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => openDrawer(b.dataset.open)));
  // Sablier : onglet Minuteries. Calendrier : onglet Programmation.
  els.halo.querySelectorAll(".h-act").forEach((b) => b.addEventListener("click", () => openTimer(b.dataset.stab)));

  // Couleurs d'ambiance : prises dans l'aperçu en direct, sinon dans la couleur des DEL.
  function setHaloColors(c1, c2, c3) {
    els.halo.style.setProperty("--c1", c1);
    els.halo.style.setProperty("--c2", c2);
    els.halo.style.setProperty("--c3", c3);
  }

  function vivid(r, g, b) {
    const m = Math.max(r, g, b);
    if (m < 8) return null;
    const k = 255 / m; // ramène à pleine intensité pour que l'ambiance reste lisible
    return "rgb(" + Math.round(r * k) + "," + Math.round(g * k) + "," + Math.round(b * k) + ")";
  }

  function haloColorsFromLive(bytes, start, count) {
    const now = Date.now();
    if (now - lastLiveColors < 500) return;
    lastLiveColors = now;
    const pick = (f) => {
      const i = start + Math.min(count - 1, Math.floor(f * count)) * 3;
      return vivid(bytes[i], bytes[i + 1], bytes[i + 2]);
    };
    const a = pick(0.05), b = pick(0.5), c = pick(0.95);
    if (a || b || c) setHaloColors(a || b || c, b || a || c, c || b || a);
  }

  function renderHalo(info) {
    if (els.halo.hidden) return;
    els.hName.textContent = info.name;
    els.hState.textContent = info.on ? "Allumé" : model.status === "offline" ? "Hors ligne" : "Éteint";
    els.hFx.textContent = info.title || "…";
    els.hPal.textContent = info.sub ? info.sub : info.palette ? "Palette " + info.palette : "";
    els.halo.querySelector(".h-cap").textContent = info.cap || "Effet";
    els.app.classList.toggle("pomo-on", info.cap === "Pomodoro");
    if (!haloDrag) setArc(info.on ? info.bri : 0);
    if (Date.now() - lastLiveColors > 2500) setHaloColors(info.led, info.led, info.led);
    const left = minutesLeft();
    // Le compte à rebours de la veille s'affiche dans un badge clair, pas dans le bouton Routines.
    els.halo.querySelectorAll(".h-timer-left").forEach((n) => { n.textContent = ""; });

  }

  /* ================= Taille du widget ================= */

  // Adapte la mise en page selon la taille de la tuile choisie sur le XENEON EDGE.
  const ro = new ResizeObserver(([entry]) => {
    const { width: w, height: h } = entry.contentRect;
    diagInfo.size = Math.round(w) + " x " + Math.round(h);
    // Mise en page Halo choisie selon la FORME de la tuile (indépendante de la mise à l'échelle) :
    //  - halo-s : bande 840 × 344 (proportions d'environ 2,4)
    //  - halo-t : tuile M 840 × 688 (proportions d'environ 1,2)
    //  - halo-m : très longue bande, 1680 × 344 ou plus (proportions de 3,2 et plus)
    const ratio = w / h;
    const haloM = ratio >= 3.2;
    const haloS = !haloM && ratio >= 1.9;
    const haloT = ratio >= 1.0 && ratio < 1.6;
    const halo = haloM || haloS || haloT;
    els.app.classList.toggle("layout-halo", halo);
    els.app.classList.toggle("halo-m", haloM);
    els.app.classList.toggle("halo-s", haloS);
    els.app.classList.toggle("halo-t", haloT);
    els.halo.hidden = !halo;
    if (!halo) closeDrawer();
    const compact = !halo && (w < 260 || h < 300);
    const wide = halo || (!compact && ratio > 1.9);
    els.app.classList.toggle("layout-compact", compact);
    els.app.classList.toggle("layout-wide", wide);
    els.app.classList.toggle("layout-tall", !compact && !wide);
    els.app.classList.toggle("is-landscape", w / h > 1.1);
    diagInfo.layout = haloT ? "halo M (840 x 688)" : haloM ? "halo bande longue" : haloS ? "halo S" : compact ? "compact" : wide ? "large" : "vertical";
    renderDiag();
    if (model.state) render(); // la mise en page vient de changer : on réaffiche tout
  });
  ro.observe(document.body);

  /* ================= Adresse IP : réglage iCUE ou écran Enregistrer ================= */

  const STORAGE_KEY = "wled-edge-ip";
  let setupPending = false;
  let setupAuto = false; // vrai si l'écran s'est ouvert tout seul faute d'adresse
  let draftIp = "";

  function getStoredIp() {
    try { return localStorage.getItem(STORAGE_KEY) || ""; } catch (e) { return ""; }
  }
  function setStoredIp(ip) {
    try { localStorage.setItem(STORAGE_KEY, ip); } catch (e) { /* stockage indisponible */ }
  }

  // Le réglage iCUE est partagé par l'aperçu et l'écran : il a priorité.
  // L'adresse tapée sur l'écran ne sert que si le réglage iCUE est vide (0.0.0.0).
  function effectiveIp() {
    return normalizeIp(setting("wledIp")) || normalizeIp(getStoredIp());
  }

  function isValidIp(ip) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(:\d{1,5})?$/.exec(ip);
    return Boolean(m) && [m[1], m[2], m[3], m[4]].every((o) => Number(o) <= 255);
  }

  function technicalDetail() {
    const d = client.diag || {};
    const parts = ["Page " + location.protocol];
    if (d.wsEvents) parts.push("WebSocket " + d.wsEvents.replace("erreur (état 3) | fermé : ", ""));
    if (d.httpError) parts.push("HTTP " + d.httpError);
    return "Détail : " + parts.join(", ") + ".";
  }

  function setSetupMsg(text, cls) {
    els.setupMsg.textContent = text;
    els.setupMsg.className = "setup-msg" + (cls ? " " + cls : "");
  }

  function renderDraft() {
    els.ipDisplay.textContent = draftIp;
  }

  function openSetup(canCancel) {
    setupAuto = !canCancel;
    renderSetupSource();
    draftIp = model.ip || getStoredIp() || "192.168.2.";
    renderDraft();
    setSetupMsg("Touche les chiffres, puis Enregistrer.");
    els.setupCancel.hidden = !canCancel;
    els.setupSave.disabled = false;
    els.setup.hidden = false;
    hideNotice();
  }

  function closeSetup() {
    els.setup.hidden = true;
    setupAuto = false;
  }

  function pressKey(key) {
    if (setupPending) return;
    if (key === "back") draftIp = draftIp.slice(0, -1);
    else if (draftIp.length < 21) draftIp += key;
    renderDraft();
    setSetupMsg("Touche les chiffres, puis Enregistrer.");
  }

  function saveSetup() {
    const ip = normalizeIp(draftIp);
    if (!isValidIp(ip)) {
      setSetupMsg("Adresse incomplète. Exemple : 192.168.2.59", "is-error");
      return;
    }
    setStoredIp(ip);
    setupPending = true;
    els.setupSave.disabled = true;
    setSetupMsg("Connexion à " + ip + "… (jusqu’à 20 secondes)", "is-busy");
    connect(true);
  }

  els.keypad.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-key]");
    if (btn) pressKey(btn.dataset.key);
  });
  els.setupSave.addEventListener("click", saveSetup);
  els.setupCancel.addEventListener("click", () => {
    setupPending = false;
    closeSetup();
    if (model.status === "offline") handleStatus("offline");
  });
  els.settingsBtn.addEventListener("click", () => openSetup(Boolean(model.ip)));
  els.changeIpBtn.addEventListener("click", () => openSetup(true));

  // Clavier physique (pratique si tu configures depuis le PC).
  document.addEventListener("keydown", (e) => {
    if (els.setup.hidden) return;
    if (/^[0-9.:]$/.test(e.key)) pressKey(e.key);
    else if (e.key === "Backspace") pressKey("back");
    else if (e.key === "Enter") saveSetup();
    else return;
    e.preventDefault();
  });

  /* ================= Mode démo (aucune adresse configurée) ================= */

  // Sans adresse IP, le widget montre la vraie interface avec des couleurs animées.
  // L'aperçu d'iCUE est ainsi parlant, et toucher l'écran ouvre le clavier de configuration.
  let demoTimer = null;

  function startDemo() {
    if (model.demo) return;
    model.demo = true;
    model.state = {
      on: true, bri: 190, ps: -1, mainseg: 0, nl: { on: false },
      seg: [{ id: 0, fx: 38, pal: 9, sx: 128, ix: 128, col: [[255, 46, 154], [33, 200, 255], [177, 59, 255]] }],
    };
    model.info = { name: "EdgeGlow", leds: { lc: 1 } };
    if (!model.effects.length) model.effects = [{ id: 0, name: "Solid" }, { id: 38, name: "Aurora" }];
    if (!model.palettes.length) model.palettes = [{ id: 0, name: "Default" }, { id: 9, name: "Ocean" }];
    els.app.classList.remove("is-loading");
    els.app.classList.add("is-demo");
    closeSetup();
    els.live.hidden = false;
    els.app.classList.add("has-live");
    els.halo.classList.remove("no-live");
    let t = 0;
    clearInterval(demoTimer);
    demoTimer = setInterval(() => {
      // Bande lumineuse animée : un dégradé qui glisse doucement.
      const n = 60, b = new Uint8Array(2 + n * 3);
      b[0] = 76; b[1] = 1;
      for (let i = 0; i < n; i++) {
        const [r, g, bl] = hsvToRgb((t + i * 5) % 360, 0.85, 1);
        b[2 + i * 3] = r; b[3 + i * 3] = g; b[4 + i * 3] = bl;
      }
      t = (t + 2) % 360;
      handleLive(b);
    }, 80);
    renderBadge();
    render();
  }

  function stopDemo() {
    if (!model.demo) return;
    model.demo = false;
    clearInterval(demoTimer);
    demoTimer = null;
    model.state = null;
    model.info = null;
    els.app.classList.remove("is-demo");
    renderBadge();
  }

  // En démo, toucher l'interface ouvre le clavier pour entrer l'adresse.
  ["pointerdown", "click"].forEach((ev) => els.halo.addEventListener(ev, (e) => {
    if (!model.demo) return;
    e.preventDefault();
    e.stopPropagation();
    if (ev === "click") openSetup(true);
  }, true));

  /* ================= Connexion ================= */

  function connect(force) {
    const ip = effectiveIp();
    const poll = clamp(Number(setting("pollInterval")) || 5, 2, 30);

    if (!ip) {
      client.stop();
      model.ip = "";
      hideNotice();
      startDemo(); // pas d'adresse : on montre l'interface en mode démo plutôt que le clavier
      return;
    }
    if (model.demo) stopDemo();

    if (ip === model.ip && !force) {
      client.setPollInterval(poll);
      return;
    }

    model.ip = ip;
    model.state = null;
    listsLoaded = false;
    hideNotice();
    if (setupAuto && !setupPending) closeSetup(); // l'adresse vient des réglages d'iCUE
    els.app.classList.add("is-loading");
    client.start(ip, poll);
  }

  let lastStartTab = null;
  let langSetting = null;

  function applySettings(payload) {
    lastSeenIp = String(setting("wledIp"));
    diagInfo.updates++;
    diagInfo.payload = payload === undefined ? "aucun" : JSON.stringify(payload).slice(0, 400);
    if (payload && payload.settings) {
      payloadSettings = Object.assign({}, payload.settings);
    } else if (!DEV_MODE) {
      // Pas de payload : on lit les variables globales, toujours à jour.
      payloadSettings = {};
    }
    // Langue : appliquée au premier passage; un changement plus tard recharge le widget.
    const L = String(setting("lang"));
    if (langSetting === null) { langSetting = L; window.EdgeGlowI18n.start(L); }
    else if (L !== langSetting) { location.reload(); return; }
    applyStyle();
    const startTab = setting("startTab");
    if (startTab !== lastStartTab) {
      lastStartTab = startTab;
      model.tab = tabKey(startTab);
    }
    selectTab(model.tab);
    connect(false);
    updateLiveVisibility();
    configureSensor();
    renderReact();
    render();
    renderDiag();
  }

  /* ================= Surveillance des réglages ================= */

  // Filet de sécurité : si iCUE change un réglage sans prévenir le widget,
  // on le remarque quand même en relisant l'adresse toutes les 2 secondes.
  let lastSeenIp = null;
  setInterval(() => {
    if (DEV_MODE && !hasGlobal("wledIp")) return;
    const raw = String(setting("wledIp"));
    if (lastSeenIp !== null && raw !== lastSeenIp) applySettings();
    renderSetupSource();
  }, 2000);

  function renderSetupSource() {
    const el = document.getElementById("setupSource");
    if (!el) return;
    const raw = setting("wledIp");
    el.textContent = "Réglage reçu d’iCUE : " + (raw === undefined || raw === null || raw === "" ? "(vide)" : "« " + raw + " »");
  }

  /* ================= Démarrage ================= */

  buildSwatches();
  buildMoods();

  writeGlobal("icueEvents", {
    onICUEInitialized: function (payload) {
      model.tab = null;
      applySettings(payload);
    },
    onDataUpdated: function (payload) {
      applySettings(payload);
    },
  });

  if (DEV_MODE || readGlobal("iCUE_initialized")) {
    applySettings();
  }
})();
