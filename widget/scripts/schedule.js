/*
 * Horaire EdgeGlow : allumage et extinction programmés DANS le WLED.
 *
 * Le calendrier de WLED lance des préréglages. EdgeGlow utilise donc deux préréglages
 * à lui, « EdgeGlow Allumer » et « EdgeGlow Éteindre », et deux entrées d'horaire.
 *
 * Deux formats selon la version de WLED :
 *  - WLED 16 et plus : la liste envoyée remplace tout. Lever = 255, coucher = 254.
 *  - WLED 0.15 et moins : 10 cases fixes (8 ordinaires, lever, coucher), jamais vidées
 *    d'elles-mêmes. On écrit les 10 cases, en deux passes (voir buildWrites).
 */
(function (global) {
  "use strict";

  const NAME_ON = "EdgeGlow Allumer";
  const NAME_OFF = "EdgeGlow Éteindre";
  const NAME_WAKE = "EdgeGlow Réveil";
  const SUNRISE = 255;
  const SUNSET = 254;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function isV16(info) {
    return Number(info && info.vid) >= 2605010;
  }

  // Avant WLED 16, lever et coucher valent tous deux 255 : le 1er est le lever, le 2e le coucher.
  function normalize(entries, v16) {
    let seen = false;
    return (entries || []).map((e) => {
      let h = Number(e.hour) || 0;
      if (!v16 && h === 255) {
        if (seen) h = SUNSET;
        seen = true;
      }
      return Object.assign({}, e, { hour: h });
    });
  }

  function full(e) {
    const st = e.start || {}, en = e.end || {};
    return {
      en: e.en ? 1 : 0,
      hour: Number(e.hour) || 0,
      min: Number(e.min) || 0,
      macro: Number(e.macro) || 0,
      dow: (e.dow === undefined ? 127 : Number(e.dow)) & 127,
      start: { mon: Number(st.mon) || 1, day: Number(st.day) || 1 },
      end: { mon: Number(en.mon) || 12, day: Number(en.day) || 31 },
    };
  }

  function emptySlot() {
    return { en: 0, hour: 0, min: 0, macro: 0, dow: 0, start: { mon: 1, day: 1 }, end: { mon: 12, day: 31 } };
  }

  function emptySun() {
    return { en: 0, hour: 255, min: 0, macro: 0, dow: 0 };
  }

  // others : horaires existants qui ne sont pas à EdgeGlow (déjà normalisés).
  // ours   : les entrées EdgeGlow à écrire (heure normalisée : 255 lever, 254 coucher).
  // Retourne { writes: [corps JSON pour /json/cfg, ...] } ou { error: "..." }.
  function buildWrites(others, ours, v16) {
    const all = others.concat(ours).map(full);

    if (v16) {
      if (all.length > 16) return { error: "Le WLED a déjà trop d’horaires (16 au maximum)." };
      return { writes: [{ timers: { ins: all } }] };
    }

    const regular = all.filter((e) => e.hour <= 24);
    const sunrise = all.filter((e) => e.hour === SUNRISE);
    const sunset = all.filter((e) => e.hour === SUNSET);
    if (regular.length > 8) {
      return { error: "Cette version de WLED accepte au plus 8 horaires à heure fixe, et ils sont déjà tous utilisés." };
    }
    if (sunrise.length > 1) {
      return { error: "Le lever du soleil est déjà utilisé par un autre horaire dans WLED. Choisis une heure fixe." };
    }
    if (sunset.length > 1) {
      return { error: "Le coucher du soleil est déjà utilisé par un autre horaire dans WLED. Choisis une heure fixe." };
    }

    const slots = regular.slice();
    while (slots.length < 8) slots.push(emptySlot());
    const sun = (e) => {
      if (!e) return emptySun();
      return { en: e.en, hour: 255, min: e.min, macro: e.macro, dow: e.dow };
    };

    // Passe 1 : remet toutes les cases à zéro. WLED 0.15 n'applique les jours que s'ils
    // diffèrent de la valeur précédente : partir de zéro garantit une lecture correcte.
    const pass1 = { timers: { ins: slots.map(() => emptySlot()).concat([emptySun(), emptySun()]) } };
    // Passe 2 : les vraies valeurs, dans l'ordre des cases (8 ordinaires, lever, coucher).
    const pass2 = { timers: { ins: slots.concat([sun(sunrise[0]), sun(sunset[0])]) } };
    return { writes: [pass1, pass2] };
  }

  // Transforme une étape de l'éditeur ({enabled, type, hour, min, offset}) en entrée WLED.
  function stepToEntry(step, presetId, common) {
    if (!step || !step.enabled) return null;
    const e = {
      en: 1,
      macro: presetId,
      dow: common.dow,
      start: common.allYear ? { mon: 1, day: 1 } : common.start,
      end: common.allYear ? { mon: 12, day: 31 } : common.end,
    };
    if (step.type === "sunrise" || step.type === "sunset") {
      e.hour = step.type === "sunrise" ? SUNRISE : SUNSET;
      e.min = Math.max(-120, Math.min(120, Number(step.offset) || 0));
    } else {
      e.hour = Math.max(0, Math.min(23, Number(step.hour) || 0));
      e.min = Math.max(0, Math.min(59, Number(step.min) || 0));
    }
    return e;
  }

  // Lit une entrée WLED existante pour préremplir l'éditeur.
  // wake : { id, minutes } du préréglage de réveil, s'il existe.
  function entryToStep(e, wake) {
    if (!e) return null;
    const h = Number(e.hour);
    const isWake = Boolean(wake && wake.id && Number(e.macro) === wake.id);
    const extra = { wake: isWake, wakeMin: isWake ? wake.minutes : 20 };
    if (h === SUNRISE || h === SUNSET) {
      return Object.assign({ enabled: Boolean(e.en), type: h === SUNRISE ? "sunrise" : "sunset", hour: 18, min: 0, offset: Number(e.min) || 0 }, extra);
    }
    return Object.assign({ enabled: Boolean(e.en), type: "time", hour: h, min: Number(e.min) || 0, offset: 0 }, extra);
  }

  function findPresetIds(presets) {
    let on = 0, off = 0, wake = 0;
    Object.keys(presets || {}).forEach((k) => {
      const p = presets[k];
      if (!p || !p.n) return;
      if (p.n === NAME_ON && !on) on = Number(k);
      if (p.n === NAME_OFF && !off) off = Number(k);
      if (p.n === NAME_WAKE && !wake) wake = Number(k);
    });
    return { on, off, wake };
  }

  // Photo de l'état actuel, pour le rétablir après la création des préréglages.
  async function snapshot(client) {
    try { return await client.getJson("/json/state"); } catch (e) { return null; }
  }

  async function restore(client, snap, wasOn, keepNl) {
    // Arrête une éventuelle veilleuse lancée par la création (WLED rétablit alors l'effet).
    if (!keepNl) {
      await client.postJson("/json/state", { nl: { on: false } });
      await sleep(300);
    }
    if (!snap) { await client.postJson("/json/state", { on: Boolean(wasOn) }); return; }
    const segs = (snap.seg || []).map((g) => ({
      id: g.id, fx: g.fx, sx: g.sx, ix: g.ix, pal: g.pal, col: g.col, on: g.on, bri: g.bri,
    }));
    await client.postJson("/json/state", { on: Boolean(snap.on), bri: snap.bri, tt: 0, seg: segs });
  }

  function freePresetId(presets, taken) {
    for (let id = 250; id >= 1; id--) {
      if (taken.has(id)) continue;
      const p = presets[String(id)];
      if (!p || Object.keys(p).length === 0) return id;
    }
    return 0;
  }

  // Crée les deux préréglages EdgeGlow s'ils n'existent pas encore.
  // WLED applique la commande au moment de la créer : on remet ensuite l'état d'origine.
  async function ensurePresets(client, wasOn, wakeMinutes) {
    const snap = await snapshot(client);
    const presets = await client.getJson("/presets.json");
    const ids = findPresetIds(presets);
    const taken = new Set(Object.keys(presets || {}).map(Number).filter((n) => {
      const p = presets[String(n)];
      return p && Object.keys(p).length > 0;
    }));
    let created = false;
    if (!ids.off) {
      ids.off = freePresetId(presets, taken);
      if (!ids.off) throw new Error("plus aucune place libre pour un préréglage");
      taken.add(ids.off);
      await client.postJson("/json/state", { psave: ids.off, n: NAME_OFF, o: true, on: false });
      created = true;
      await sleep(700);
    }
    if (!ids.on) {
      ids.on = freePresetId(presets, taken);
      if (!ids.on) throw new Error("plus aucune place libre pour un préréglage");
      taken.add(ids.on);
      await client.postJson("/json/state", { psave: ids.on, n: NAME_ON, o: true, on: true });
      created = true;
      await sleep(700);
    }
    if (wakeMinutes) {
      // Réveil : on éteint d'abord, puis la veilleuse « lever du soleil » (mode 3) démarre.
      // Partir d'un état éteint garantit une aube, jamais un coucher de soleil.
      const dur = Math.max(5, Math.min(60, Math.round(wakeMinutes)));
      const cur = presets[String(ids.wake)];
      const same = cur && cur.nl && Number(cur.nl.dur) === dur && Number(cur.nl.mode) === 3;
      if (!same) {
        if (!ids.wake) {
          ids.wake = freePresetId(presets, taken);
          if (!ids.wake) throw new Error("plus aucune place libre pour un préréglage");
          taken.add(ids.wake);
        }
        await client.postJson("/json/state", { psave: ids.wake, n: NAME_WAKE, o: true, on: false, nl: { on: true, dur, mode: 3 } });
        created = true;
        await sleep(700);
      }
    }
    if (created) await restore(client, snap, wasOn);
    return { on: ids.on, off: ids.off, wake: ids.wake, created };
  }

  // Lit l'horaire actuel du WLED et repère les entrées EdgeGlow.
  async function readCurrent(client) {
    const [cfg, info, presets] = await Promise.all([
      client.getJson("/json/cfg"),
      client.getJson("/json/info"),
      client.getJson("/presets.json").catch(() => ({})),
    ]);
    const v16 = isV16(info);
    const entries = normalize((cfg && cfg.timers && cfg.timers.ins) || [], v16);
    const ids = findPresetIds(presets);
    const isOn = (e) => (ids.on && Number(e.macro) === ids.on) || (ids.wake && Number(e.macro) === ids.wake);
    const mine = (e) => isOn(e) || (ids.off && Number(e.macro) === ids.off);
    const wp = ids.wake ? presets[String(ids.wake)] : null;
    const wake = { id: ids.wake, minutes: (wp && wp.nl && Number(wp.nl.dur)) || 20 };
    return {
      v16,
      info,
      ids,
      // Une entrée sans préréglage (macro 0) ne fait rien : ce sont des cases vides.
      others: entries.filter((e) => !mine(e) && Number(e.macro) !== 0),
      wake,
      onEntry: entries.find(isOn) || null,
      offEntry: entries.find((e) => ids.off && Number(e.macro) === ids.off) || null,
    };
  }

  // Enregistre l'horaire EdgeGlow (ou le retire si plan est null).
  async function save(client, plan, wasOn) {
    let ids = { on: 0, off: 0, created: false };
    const wakeMin = plan && plan.on && plan.on.enabled && plan.on.wake ? plan.on.wakeMin || 20 : 0;
    if (plan) ids = await ensurePresets(client, wasOn, wakeMin);
    const current = await readCurrent(client);
    if (!plan) ids = Object.assign({}, current.ids, { created: false });

    const ours = [];
    if (plan) {
      const common = { dow: plan.dow, allYear: plan.allYear, start: plan.start, end: plan.end };
      const a = stepToEntry(plan.on, plan.on.wake ? ids.wake : ids.on, common);
      const b = stepToEntry(plan.off, ids.off, common);
      if (a) ours.push(a);
      if (b) ours.push(b);
    }
    const built = buildWrites(current.others, ours, current.v16);
    if (built.error) throw new Error(built.error);
    for (const body of built.writes) {
      await client.postJson("/json/cfg", body);
      await sleep(400);
    }

    // Vérification : on relit et on compare.
    const after = await readCurrent(client);
    if (plan) {
      const ok = (!plan.on.enabled || after.onEntry) && (!plan.off.enabled || after.offEntry);
      if (!ok) throw new Error("le WLED n’a pas conservé l’horaire");
    }
    return { created: ids.created, v16: current.v16 };
  }


  /* ---------- Lumière circadienne ---------- */

  // Cinq étapes fixes. Chaque préréglage ne change que la couleur (jamais l'allumage),
  // avec une transition de 10 minutes : si les DEL sont éteintes, elles restent éteintes.
  const NAME_CIRC = "EdgeGlow Circadien";
  const CIRC_STEPS = [
    { hour: 7, min: 0, label: "Matin", kelvin: 4500, col: [255, 214, 170] },
    { hour: 12, min: 0, label: "Midi", kelvin: 5500, col: [255, 236, 224] },
    { hour: 17, min: 0, label: "Fin d’après-midi", kelvin: 3500, col: [255, 196, 137] },
    { hour: 20, min: 0, label: "Soirée", kelvin: 2700, col: [255, 166, 87] },
    { hour: 22, min: 0, label: "Nuit", kelvin: 2000, col: [255, 137, 14] },
  ];
  const CIRC_TT = 6000; // 6000 × 100 ms = 10 minutes

  function circIds(presets) {
    return CIRC_STEPS.map((_, i) => {
      const name = NAME_CIRC + " " + (i + 1);
      const k = Object.keys(presets || {}).find((id) => presets[id] && presets[id].n === name);
      return k ? Number(k) : 0;
    });
  }

  async function readCircadian(client) {
    const [cfg, info, presets] = await Promise.all([
      client.getJson("/json/cfg"), client.getJson("/json/info"), client.getJson("/presets.json").catch(() => ({})),
    ]);
    const ids = circIds(presets);
    const entries = normalize((cfg && cfg.timers && cfg.timers.ins) || [], isV16(info));
    const active = ids.every((id) => id && entries.some((e) => Number(e.macro) === id && e.en));
    return { active, ids, steps: CIRC_STEPS };
  }

  async function saveCircadian(client, enable, wasOn) {
    const presets = await client.getJson("/presets.json");
    const ids = circIds(presets);
    if (enable) {
      const snap = await snapshot(client);
      const taken = new Set(Object.keys(presets || {}).map(Number).filter((n) => {
        const p = presets[String(n)];
        return p && Object.keys(p).length > 0;
      }));
      let created = false;
      for (let i = 0; i < CIRC_STEPS.length; i++) {
        if (ids[i]) continue;
        ids[i] = freePresetId(presets, taken);
        if (!ids[i]) throw new Error("plus aucune place libre pour un préréglage");
        taken.add(ids[i]);
        await client.postJson("/json/state", {
          psave: ids[i], n: NAME_CIRC + " " + (i + 1), o: true,
          tt: CIRC_TT, seg: { fx: 0, col: [CIRC_STEPS[i].col] },
        });
        created = true;
        await sleep(600);
      }
      if (created) await restore(client, snap, wasOn, true);
    }
    const [cfg, info] = await Promise.all([client.getJson("/json/cfg"), client.getJson("/json/info")]);
    const v16 = isV16(info);
    const entries = normalize((cfg && cfg.timers && cfg.timers.ins) || [], v16);
    const mineSet = new Set(ids.filter(Boolean));
    const others = entries.filter((e) => !mineSet.has(Number(e.macro)) && Number(e.macro) !== 0);
    const ours = enable
      ? CIRC_STEPS.map((st, i) => ({ en: 1, hour: st.hour, min: st.min, macro: ids[i], dow: 127, start: { mon: 1, day: 1 }, end: { mon: 12, day: 31 } }))
      : [];
    const built = buildWrites(others, ours, v16);
    if (built.error) throw new Error(built.error);
    for (const body of built.writes) {
      await client.postJson("/json/cfg", body);
      await sleep(400);
    }
    const after = await readCircadian(client);
    if (after.active !== Boolean(enable)) throw new Error("le WLED n’a pas conservé l’horaire");
    return after;
  }

  global.EdgeGlowSchedule = {
    NAME_ON, NAME_OFF, NAME_WAKE, SUNRISE, SUNSET,
    isV16, normalize, buildWrites, stepToEntry, entryToStep, findPresetIds, freePresetId,
    readCurrent, save, readCircadian, saveCircadian, CIRC_STEPS,
  };
})(typeof window !== "undefined" ? window : globalThis);
