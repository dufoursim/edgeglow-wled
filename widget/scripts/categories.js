/*
 * Classe les effets WLED en familles pour le menu tactile.
 * WLED ne fournit pas de catégories : on se sert
 *  1. des indicateurs de /json/fxdata (v ou f = effet audio, 2 = effet matrice 2D);
 *  2. puis de mots clés dans le nom de l'effet.
 * Un effet qui ne correspond à rien va dans « Mouvement ».
 */
(function (global) {
  "use strict";

  const CATEGORIES = [
    { key: "music", name: "Musique", swatch: "hsl(160, 85%, 55%)" },
    { key: "matrix", name: "Matrice 2D", swatch: "hsl(200, 85%, 62%)" },
    { key: "sparkle", name: "Scintillements", swatch: "hsl(50, 100%, 75%)",
      words: ["twinkle", "sparkle", "glitter", "starburst", "firework", "flash", "popcorn",
              "dissolve", "strobe", "blink", "fairy", "glow", "sparkl", "twinkl"] },
    { key: "calm", name: "Calmes", swatch: "hsl(35, 90%, 70%)",
      words: ["solid", "breathe", "fade", "blend", "spots"] },
    { key: "colors", name: "Couleurs", swatch: "conic-gradient(#f44, #fd3, #4e6, #3cf, #66f, #f4c, #f44)",
      words: ["rainbow", "color", "colour", "palette", "pride", "gradient", "plasma", "hue",
              "random", "dynamic", "phased"] },
    { key: "nature", name: "Feu et eau", swatch: "linear-gradient(135deg, #ff5a1f 50%, #1f8bff 50%)",
      words: ["fire", "flame", "flicker", "candle", "ocean", "pacifica", "lake", "drip", "rain\\b",
              "aurora", "sunrise", "lightning", "noise"] },
    { key: "motion", name: "Mouvement", swatch: "hsl(280, 85%, 66%)" },
  ];

  function flagsOf(fxdata, id) {
    const data = Array.isArray(fxdata) ? String(fxdata[id] || "") : "";
    return data.split(";")[3] || "";
  }

  function categoryFor(effect, fxdata) {
    const flags = flagsOf(fxdata, effect.id);
    if (/[vf]/.test(flags)) return "music";
    if (flags.includes("2") && !flags.includes("1")) return "matrix";
    const name = effect.name.toLowerCase();
    for (const cat of CATEGORIES) {
      if (cat.words && cat.words.some((w) => new RegExp("\\b" + w).test(name))) return cat.key;
    }
    return "motion";
  }

  // effects : [{id, name}] déjà triés. Retourne les familles non vides.
  function categorize(effects, fxdata, isMatrix) {
    const byKey = {};
    CATEGORIES.forEach((c) => { byKey[c.key] = Object.assign({}, c, { items: [] }); });
    effects.forEach((fx) => {
      const key = categoryFor(fx, fxdata);
      if (key === "matrix" && !isMatrix) return; // inutile sur une bande 1D
      byKey[key].items.push(fx);
    });
    return CATEGORIES.map((c) => byKey[c.key]).filter((c) => c.items.length > 0);
  }

  /* ---------- Palettes : classées selon leurs vraies couleurs ---------- */

  const PALETTE_FAMILIES = [
    { key: "own", name: "Tes couleurs", swatch: "conic-gradient(#ECEEF2 0 25%, #8C93A3 0 50%, #ECEEF2 0 75%, #8C93A3 0)" },
    { key: "multi", name: "Multicolores", swatch: "conic-gradient(#f44, #fd3, #4e6, #3cf, #66f, #f4c, #f44)" },
    { key: "warm", name: "Chaudes", swatch: "linear-gradient(135deg, #ff2d1f, #ffb21f)" },
    { key: "green", name: "Nature", swatch: "linear-gradient(135deg, #1f9e4a, #c8f04a)" },
    { key: "cool", name: "Froides", swatch: "linear-gradient(135deg, #1f4bff, #29e0ff)" },
    { key: "purple", name: "Violets et roses", swatch: "linear-gradient(135deg, #7a2be2, #ff5fb0)" },
    { key: "soft", name: "Douces", swatch: "linear-gradient(135deg, #f6e7d8, #cfe3f5)" },
    { key: "all", name: "Toutes les palettes", swatch: "linear-gradient(135deg, #5B6170, #2D313C)" },
  ];

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
    }
    return { h, s: max ? d / max : 0, v: max };
  }

  function familyOfStops(stops) {
    if (!Array.isArray(stops) || stops.length === 0) return "all";
    if (stops.some((x) => typeof x === "string")) return "own";
    const cols = stops.filter((x) => Array.isArray(x) && x.length >= 4).map((x) => rgbToHsv(x[1], x[2], x[3]));
    const vivid = cols.filter((c) => c.v > 0.15 && c.s > 0.25);
    if (vivid.length === 0) return "soft";
    const avgSat = cols.reduce((a, c) => a + c.s, 0) / cols.length;
    if (avgSat < 0.3) return "soft";
    // Moyenne circulaire des teintes : si elles s'annulent, la palette est multicolore.
    let x = 0, y = 0;
    vivid.forEach((c) => { x += Math.cos(c.h * Math.PI / 180); y += Math.sin(c.h * Math.PI / 180); });
    const strength = Math.sqrt(x * x + y * y) / vivid.length;
    if (strength < 0.55) return "multi";
    const hue = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    if (hue >= 330 || hue < 65) return "warm";
    if (hue < 165) return "green";
    if (hue < 265) return "cool";
    return "purple";
  }

  // Dégradé CSS d'une palette. cols = couleurs du segment pour « c1, c2, c3 ».
  function paletteGradient(stops, cols) {
    if (!Array.isArray(stops) || stops.length === 0) return "";
    const segCol = (n) => {
      const c = (cols && cols[n - 1]) || [0, 0, 0];
      let r = c[0] || 0, g = c[1] || 0, b = c[2] || 0;
      const w = c[3] || 0;
      // Bande RGBW : le canal blanc est montré comme un blanc chaud.
      if (w > 0) {
        const k = w / 255;
        r = Math.round(r + (255 - r) * k);
        g = Math.round(g + (240 - g) * k);
        b = Math.round(b + (216 - b) * k);
      }
      if (r + g + b === 0) return "rgb(58, 63, 75)"; // couleur non définie (noire)
      return "rgb(" + r + "," + g + "," + b + ")";
    };
    const parts = stops.map((x, i) => {
      if (typeof x === "string") {
        if (x === "r") return "hsl(" + Math.round((i * 97) % 360) + ", 90%, 55%)";
        const n = Number(x.replace("c", "")) || 1;
        return segCol(n);
      }
      return "rgb(" + x[1] + "," + x[2] + "," + x[3] + ") " + Math.round((x[0] / 255) * 100) + "%";
    });
    if (parts.length === 1) parts.push(parts[0]);
    return "linear-gradient(90deg, " + parts.join(", ") + ")";
  }

  // palettes : [{id, name}] ; palx : {"id": stops}
  function paletteFamilies(palettes, palx, cols) {
    const hasPalx = palx && Object.keys(palx).length > 0;
    const byKey = {};
    PALETTE_FAMILIES.forEach((f) => { byKey[f.key] = Object.assign({}, f, { items: [] }); });
    palettes.forEach((pal) => {
      const stops = hasPalx ? palx[String(pal.id)] : null;
      let key;
      if (!hasPalx) key = pal.id >= 1 && pal.id <= 5 ? "own" : "all";
      else key = pal.id === 0 ? "own" : familyOfStops(stops);
      byKey[key].items.push(Object.assign({}, pal, { gradient: stops ? paletteGradient(stops, cols) : "" }));
    });
    return PALETTE_FAMILIES.map((f) => byKey[f.key]).filter((f) => f.items.length > 0);
  }

  global.WledCategories = { categorize, paletteFamilies };
})(window);
