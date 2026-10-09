/*
 * Traduction de l'interface d'EdgeGlow.
 *
 * Le code du widget écrit ses textes en français. Ce module les traduit au moment de
 * l'affichage, grâce à un dictionnaire et à quelques règles pour les phrases variables
 * (« Connexion à Bureau… », « Cycle 2 sur 4 », etc.). Un MutationObserver surveille la
 * page : tout texte affiché ou modifié est traduit aussitôt.
 *
 * Langue : réglage « Langue » d'iCUE (Automatique, Francais, English).
 * En automatique, on suit la langue de Windows (navigator.language).
 */
(function (global) {
  "use strict";

  const EN = {
    // Général
    "Allumé": "On", "Éteint": "Off", "Hors ligne": "Offline", "Connexion…": "Connecting…",
    "Allumer ou éteindre": "Turn on or off", "Fermer": "Close", "Annuler": "Cancel", "Enregistrer": "Save",
    "Réessayer": "Retry", "Retirer": "Remove", "Confirmer le retrait": "Confirm removal",
    "Effacer": "Delete", "Actif": "On", "Inactif": "Off", "Oui": "Yes", "Non": "No",
    "Luminosité": "Brightness", "Vitesse": "Speed", "Intensité": "Intensity", "Teinte": "Hue",
    "Effet": "Effect", "Pomodoro": "Pomodoro", "Ambiance": "Mood", "Rappel": "Reminder",
    "Couleurs": "Colors", "Effets": "Effects", "Palettes": "Palettes", "Préréglages": "Presets",
    "Routines": "Routines", "Retour aux familles": "Back to families",
    "Contrôleur introuvable": "Controller not found", "Changer l’adresse": "Change address",
    "Changer l’adresse du contrôleur": "Change controller address",
    "Liste des effets indisponible.": "Effect list unavailable.",
    "Liste des palettes indisponible.": "Palette list unavailable.",
    "Rien dans cette famille.": "Nothing in this family.",
    "Aucun préréglage. Crée-en dans l’interface web de WLED, puis touche Réessayer.": "No presets yet. Create some in the WLED web interface, then tap Retry.",

    // Configuration
    "Adresse IP du WLED": "WLED IP address",
    "Touche les chiffres, puis Enregistrer.": "Tap the digits, then Save.",
    "Astuce : entre plutôt l’adresse dans les réglages du widget, dans iCUE (groupe Connexion). L’aperçu d’iCUE et l’écran l’auront tous les deux.": "Tip: enter the address in the widget settings in iCUE instead (Connexion group). Both the iCUE preview and the screen will get it.",
    "Adresse incomplète. Exemple : 192.168.2.59": "Incomplete address. Example: 192.168.2.59",

    // Familles d'effets et de palettes
    "Musique": "Music", "Matrice 2D": "2D matrix", "Scintillements": "Sparkles", "Calmes": "Calm",
    "Feu et eau": "Fire and water", "Mouvement": "Motion",
    "Tes couleurs": "Your colors", "Multicolores": "Multicolor", "Chaudes": "Warm", "Nature": "Nature",
    "Froides": "Cool", "Violets et roses": "Purples and pinks", "Douces": "Soft", "Toutes les palettes": "All palettes",
    "Ces palettes utilisent tes couleurs 1, 2 et 3. Règle-les dans l’onglet Couleurs, avec les boutons Couleur 1, 2 et 3.": "These palettes use your colors 1, 2 and 3. Set them in the Colors tab with the Color 1, 2 and 3 buttons.",

    // Couleurs et ambiances
    "Ambiances : trois couleurs d’un toucher": "Moods: three colors in one tap",
    "En cours": "Current", "Ajuster une couleur": "Adjust a color",
    "Couleur 1": "Color 1", "Couleur 2": "Color 2", "Couleur 3": "Color 3",
    "Couleur à modifier": "Color to edit", "Couleur unie": "Solid color", "Unie": "Solid",
    "Blanc": "White", "Blanc chaud": "Warm white",
    "Coucher de soleil": "Sunset", "Océan": "Ocean", "Forêt": "Forest", "Néon": "Neon",
    "Feu de camp": "Campfire", "Aurore boréale": "Northern lights", "Bonbons": "Candy", "Glace": "Ice",
    "La couleur 1 est celle de la plupart des effets.": "Color 1 is used by most effects.",
    "Les couleurs 2 et 3 servent à certains effets et aux palettes « Tes couleurs ».": "Colors 2 and 3 are used by some effects and by the “Your colors” palettes.",
    "La palette « Color 1 » utilise seulement la couleur 1.": "The “Color 1” palette only uses color 1.",
    "La palette « Colors 1&2 » mélange les couleurs 1 et 2.": "The “Colors 1&2” palette blends colors 1 and 2.",
    "La palette « Color Gradient » fait un dégradé des couleurs 1, 2 et 3.": "The “Color Gradient” palette blends colors 1, 2 and 3.",
    "La palette « Colors Only » affiche les couleurs 1, 2 et 3 en blocs.": "The “Colors Only” palette shows colors 1, 2 and 3 as blocks.",
    "Couleur unie : toute la bande prend la couleur 1.": "Solid color: the whole strip uses color 1.",

    // Préréglages et ambiances rapides
    "Mode cinéma": "Cinema mode", "Cinéma": "Cinema",
    "Tamise tout à 10 % en blanc chaud": "Dims everything to 10% warm white",
    "Actif : touche pour revenir à ton éclairage": "On: tap to restore your lighting",
    "10 %, blanc très chaud": "10%, very warm white",

    // Routines : minuteries
    "Minuteries": "Timers", "Programmation": "Scheduling",
    "Minuterie de veille": "Sleep timer",
    "Les DEL baissent doucement puis s’éteignent.": "The LEDs dim slowly, then turn off.",
    "Annuler la minuterie": "Cancel the timer",
    "Pomodoro lumineux": "Light Pomodoro",
    "La bande se remplit pendant le travail": "The strip fills up while you work",
    "25 min + 5 min": "25 min + 5 min", "50 min + 10 min": "50 min + 10 min",
    "Pause": "Pause", "Reprendre": "Resume", "Passer": "Skip", "Arrêter": "Stop",
    "Focus": "Focus", "Longue pause": "Long break",
    "Bravo, 4 cycles terminés!": "Well done, 4 cycles completed!",
    "Rappel de pause": "Break reminder",
    "Une douce pulsation bleue te rappelle de bouger": "A soft blue pulse reminds you to move",
    "Bouge un peu": "Time to move", "Bouge un peu!": "Time to move!",
    "Lève-toi, étire-toi, bois de l’eau": "Stand up, stretch, drink some water",
    "Compte à rebours": "Countdown", "Démarrer": "Start",
    "La bande se vide pendant la dernière heure": "The strip empties during the last hour",
    "La bande se vide jusqu’au moment choisi": "The strip empties until the chosen moment",
    "C’est le moment!": "It’s time!", "Feux d’artifice pendant une minute": "Fireworks for one minute",

    // Routines : programmation
    "Horaire du WLED": "WLED schedule", "Programmer l’horaire": "Set the schedule",
    "Aucun horaire n’est programmé dans le WLED pour l’instant.": "No schedule is set in WLED yet.",
    "Lecture de l’horaire…": "Reading the schedule…", "Lecture de l’horaire du WLED…": "Reading the WLED schedule…",
    "Lumière circadienne": "Circadian lighting", "Activer": "Turn on", "Désactiver": "Turn off",
    "Désactivée": "Off", "Active, enregistrée dans le WLED": "On, saved in WLED", "Lecture…": "Reading…",
    "Lecture impossible": "Could not read", "Enregistrement…": "Saving…", "Enregistrement dans le WLED…": "Saving to WLED…",
    "Matin": "Morning", "Midi": "Noon", "Fin d’après-midi": "Late afternoon", "Soirée": "Evening", "Nuit": "Night",
    "Allumage et extinction": "On and off",
    "Enregistré dans le WLED : fonctionne même si ton PC est éteint.": "Saved in WLED: works even when your PC is off.",
    "Allumage": "Turn on", "Extinction": "Turn off", "Heure": "Time",
    "Lever du soleil": "Sunrise", "Coucher du soleil": "Sunset",
    "Réveil lever du soleil": "Sunrise alarm", "Durée de l’aube": "Dawn length", "Décalage": "Offset",
    "Jours": "Days", "Tous les jours": "Every day", "Semaine": "Weekdays", "Fin de semaine": "Weekend",
    "Du lundi au vendredi": "Monday to Friday", "Samedi et dimanche": "Saturday and Sunday", "Aucun jour": "No days",
    "Période": "Period", "Toute l’année": "All year", "Entre deux dates": "Between two dates", "Du": "From", "Au": "To",
    "Règle les heures, puis Enregistrer.": "Set the times, then Save.",
    "Horaire EdgeGlow actuel. Modifie-le, puis Enregistrer.": "Current EdgeGlow schedule. Edit it, then Save.",
    "Aucun horaire programmé. Active l’allumage, l’extinction ou les deux pour en créer un.": "No schedule yet. Turn on the on time, the off time or both to create one.",
    "Rien à enregistrer : aucun horaire n’est actif.": "Nothing to save: no schedule is on.",
    "Les deux sont inactifs : Enregistrer retirera l’horaire EdgeGlow du WLED.": "Both are off: Save will remove the EdgeGlow schedule from WLED.",
    "Active au moins l’allumage ou l’extinction.": "Turn on at least the on or the off time.",
    "Choisis au moins un jour.": "Choose at least one day.",
    "Retrait de l’horaire…": "Removing the schedule…",
    "Enregistrement dans le WLED… La première fois, les DEL peuvent clignoter une fois.": "Saving to WLED… The first time, the LEDs may blink once.",
    "Horaire enregistré dans le WLED.": "Schedule saved in WLED.", "Horaire EdgeGlow retiré.": "EdgeGlow schedule removed.",
    "L’heure du WLED ne semble pas réglée. Active la synchronisation de l’heure (NTP) et le bon fuseau horaire dans WLED, dans Config puis Time & Macros, sinon l’horaire ne se déclenchera pas.": "The WLED clock does not seem to be set. Turn on time sync (NTP) and the right time zone in WLED, under Config then Time & Macros, or the schedule will not trigger.",
    "lundi": "Monday", "mardi": "Tuesday", "mercredi": "Wednesday", "jeudi": "Thursday", "vendredi": "Friday", "samedi": "Saturday", "dimanche": "Sunday",
    "Prochain rappel": "Next reminder",
    "Minutes": "Minutes", "Jour": "Day", "Mois": "Month", "Du jour": "From day", "Du mois": "From month", "Au jour": "To day", "Au mois": "To month",

    // Connexion
    "Ajoute ton contrôleur": "Add your controller",
    "Démo": "Demo",
    "Respiration guidée": "Guided breathing", "Respiration": "Breathing", "Inspire": "Breathe in", "Expire": "Breathe out",
    "Inspire quand la bande s’allume, expire quand elle s’éteint": "Breathe in as the strip lights up, out as it fades",
    "Arrêter la respiration": "Stop breathing exercise", "3 min": "3 min", "5 min": "5 min",
    "Fenêtre sur le ciel": "Window to the sky", "La bande suit la couleur du ciel, en temps réel": "The strip follows the color of the sky, in real time",
    "Ciel": "Sky", "Nuit": "Night", "Heure bleue": "Blue hour", "Aube": "Dawn", "Crépuscule": "Dusk", "Heure dorée": "Golden hour", "Plein jour": "Daylight",
    "Saison": "Season", "Selon la position du soleil chez toi": "Based on the sun’s position where you are", "Selon l’heure de la journée": "Based on the time of day", "Jour de l’An": "New Year", "Saint-Valentin": "Valentine’s Day", "Saint-Patrick": "St. Patrick’s Day",
    "Fête nationale": "Saint-Jean-Baptiste", "Fête du Canada": "Canada Day", "Halloween": "Halloween", "Noël": "Christmas", "Pâques": "Easter", "Touche pour connecter": "Tap to connect",
  };

  const MONTHS = { "janv.": "Jan", "févr.": "Feb", "mars": "Mar", "avr.": "Apr", "mai": "May", "juin": "Jun", "juil.": "Jul", "août": "Aug", "sept.": "Sep", "oct.": "Oct", "nov.": "Nov", "déc.": "Dec" };
  const DAYS = { lun: "Mon", mar: "Tue", mer: "Wed", jeu: "Thu", ven: "Fri", sam: "Sat", dim: "Sun" };
  const tr = (s) => EN[s] || s;
  const month = (m) => MONTHS[m] || m;
  const sunWord = (w) => (w === "lever" ? "sunrise" : "sunset");

  // Règles pour les phrases variables : [expression, remplacement].
  const RULES = [
    [/^Connexion à (.+)… \(jusqu’à 20 secondes\)$/, (m) => "Connecting to " + m[1] + "… (up to 20 seconds)"],
    [/^Connexion à (.+)…$/, (m) => "Connecting to " + m[1] + "…"],
    [/^Aucune réponse de (.+?)\. Vérifie que le WLED est allumé, sur le même réseau, et que l’adresse IP est exacte\.$/, (m) => "No answer from " + m[1] + ". Check that WLED is on, on the same network, and that the IP address is right."],
    [/^Aucune réponse de (.+?)\. Détail : (.+)$/, (m) => "No answer from " + m[1] + ". Details: " + m[2]],
    [/^(\d+) effets?$/, (m) => m[1] + (m[1] === "1" ? " effect" : " effects")],
    [/^(\d+) palettes?$/, (m) => m[1] + (m[1] === "1" ? " palette" : " palettes")],
    [/^Palette (.+)$/, (m) => "Palette " + tr(m[1])],
    [/^Cycle (\d+) sur (\d+)(, en pause)?$/, (m) => "Cycle " + m[1] + " of " + m[2] + (m[3] ? ", paused" : "")],
    [/^(Focus|Pause|Longue pause) : ([\d:]+)( \(en pause\))?, cycle (\d+) sur (\d+)$/, (m) => ({ Focus: "Focus", Pause: "Break", "Longue pause": "Long break" })[m[1]] + ": " + m[2] + (m[3] ? " (paused)" : "") + ", cycle " + m[4] + " of " + m[5]],
    [/^Pause $/, () => "Break "], [/^Focus $/, () => "Focus "],
    [/^Il reste (.+)$/, (m) => convertLeft(m[1]) + " left"],
    [/^J-(\d+)( (\d+) h)?$/, (m) => m[1] + "d" + (m[3] ? " " + m[3] + "h" : "")],
    [/^Moment choisi : (\d+) (\S+) à (\d+) h (\d+)$/, (m) => "Chosen moment: " + capitalize(MONTHS_LONG[m[2]] || m[2]) + " " + m[1] + " at " + m[3] + ":" + m[4]],
    [/^Moment choisi : (.+)$/, (m) => "Chosen moment: " + m[1]],
    [/^Actif : (.+)\. Touche pour revenir à ton éclairage$/, (m) => "On: " + tr(m[1]) + ". Tap to restore your lighting"],
    [/^Arrêt (?:dans )?(\d+) min$/, (m) => "Off in " + m[1] + " min"],
    [/^Prochain rappel dans (\d+) min$/, (m) => "Next reminder in " + m[1] + " min"],
    [/^Extinction dans (\d+) min\. Choisis une autre durée pour la remplacer\.$/, (m) => "Turning off in " + m[1] + " min. Choose another length to replace it."],
    [/^Heure du WLED : (.+)$/, (m) => "WLED time: " + m[1]],
    [/^(\d\d) h (\d\d)$/, (m) => m[1] + ":" + m[2]],
    [/^(\d\d) h$/, (m) => m[1] + ":00"],
    [/^Chaque heure, à (\d\d)$/, (m) => "Every hour at :" + m[1]],
    [/^(\d+) min (avant|après) le (lever|coucher) du soleil( : (.+))?$/, (m) => m[1] + " min " + (m[2] === "avant" ? "before " : "after ") + sunWord(m[3]) + (m[5] ? ": " + tr(m[5]) : "")],
    [/^(Lever|Coucher) du soleil : (.+)$/, (m) => (m[1] === "Lever" ? "Sunrise" : "Sunset") + ": " + tr(m[2])],
    [/^Au (lever|coucher) du soleil$/, (m) => "At " + sunWord(m[1])],
    [/^([+−]?)(\d+) min$/, null],
    [/^(Lun|Mar|Mer|Jeu|Ven|Sam|Dim)((, (lun|mar|mer|jeu|ven|sam|dim))*)$/, (m) => m[0].toLowerCase().split(", ").map((d) => DAYS[d]).join(", ")],
    [/^(.+), du (\d+) (\S+) au (\d+) (\S+)$/, (m) => translate(m[1]) + ", " + month(m[3]) + " " + m[2] + " to " + month(m[5]) + " " + m[4]],
    [/^(janv\.|févr\.|mars|avr\.|mai|juin|juil\.|août|sept\.|oct\.|nov\.|déc\.)$/, (m) => month(m[1])],
    [/^Les DEL s’allument doucement, du rouge sombre au blanc chaud, sur (\d+) min\.$/, (m) => "The LEDs fade in slowly, from deep red to warm white, over " + m[1] + " min."],
    [/^La couleur suit « (.+) » \((.+)\)\. Désactive « Couleur selon un capteur du PC » dans les réglages pour la choisir toi-même\.$/, (m) => "The color follows “" + m[1] + "” (" + m[2] + "). Turn off “Couleur selon un capteur du PC” in the settings to choose it yourself."],
    [/^Réglage reçu d’iCUE : (.+)$/, (m) => "Value received from iCUE: " + m[1]],
    [/^Échec : (.+?)\. Rien n’a été modifié dans l’horaire\.$/, (m) => "Failed: " + errorText(m[1]) + ". Nothing was changed in the schedule."],
    [/^Échec : (.+)$/, (m) => "Failed: " + errorText(m[1])],
    [/^Impossible de lire l’horaire du WLED \((.+)\)\.$/, (m) => "Could not read the WLED schedule (" + errorText(m[1]) + ")."],
    [/^(.+) : (augmenter|diminuer)$/, (m) => tr(m[1]) + (m[2] === "augmenter" ? ": increase" : ": decrease")],
    [/^Préréglage (\d+)$/, (m) => "Preset " + m[1]],
    [/^Effet (\d+)$/, (m) => "Effect " + m[1]],
  ];

  const MONTHS_LONG = { janvier: "january", février: "february", mars: "march", avril: "april", mai: "may", juin: "june", juillet: "july", août: "august", septembre: "september", octobre: "october", novembre: "november", décembre: "december" };
  const ERRORS = {
    "le WLED n’a pas conservé l’horaire": "WLED did not keep the schedule",
    "plus aucune place libre pour un préréglage": "no free preset slot left",
    "Le WLED a déjà trop d’horaires (16 au maximum).": "WLED already has too many schedules (16 at most).",
    "Cette version de WLED accepte au plus 8 horaires à heure fixe, et ils sont déjà tous utilisés.": "This WLED version accepts at most 8 fixed-time schedules, and they are all in use.",
    "Le lever du soleil est déjà utilisé par un autre horaire dans WLED. Choisis une heure fixe.": "Sunrise is already used by another WLED schedule. Choose a fixed time.",
    "Le coucher du soleil est déjà utilisé par un autre horaire dans WLED. Choisis une heure fixe.": "Sunset is already used by another WLED schedule. Choose a fixed time.",
  };
  const errorText = (s) => ERRORS[s] || s;
  const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  function convertLeft(s) {
    const m = /^J-(\d+)( (\d+) h)?$/.exec(s);
    return m ? m[1] + "d" + (m[3] ? " " + m[3] + "h" : "") : s;
  }

  function translate(text) {
    if (!text) return text;
    const lead = text.match(/^\s*/)[0], tail = text.match(/\s*$/)[0];
    const core = text.trim();
    if (!core) return text;
    if (EN[core]) return lead + EN[core] + tail;
    if (ERRORS[core]) return lead + ERRORS[core] + tail;
    for (const [re, fn] of RULES) {
      const m = re.exec(core);
      if (m) return fn ? lead + fn(m) + tail : text;
    }
    return text;
  }

  /* ---------- Choix de la langue ---------- */

  let lang = "fr";
  function detect(setting) {
    const v = String(setting || "").toLowerCase();
    if (v.startsWith("english")) return "en";
    if (v.startsWith("fran")) return "fr";
    const nav = String((global.navigator && (global.navigator.language || (global.navigator.languages || [])[0])) || "fr").toLowerCase();
    return nav.startsWith("fr") ? "fr" : "en";
  }

  /* ---------- Traduction de la page ---------- */

  const ATTRS = ["aria-label", "title", "placeholder", "alt"];
  let observer = null;

  function translateNode(node) {
    if (lang !== "en") return;
    if (node.nodeType === 3) {
      const p = node.parentNode;
      if (p && (p.nodeName === "SCRIPT" || p.nodeName === "STYLE")) return;
      const out = translate(node.nodeValue);
      if (out !== node.nodeValue) node.nodeValue = out;
      return;
    }
    if (node.nodeType !== 1) return;
    if (node.nodeName === "SCRIPT" || node.nodeName === "STYLE") return;
    ATTRS.forEach((a) => {
      if (node.hasAttribute && node.hasAttribute(a)) {
        const v = node.getAttribute(a), out = translate(v);
        if (out !== v) node.setAttribute(a, out);
      }
    });
    node.childNodes.forEach(translateNode);
  }

  function start(setting) {
    lang = detect(setting);
    document.documentElement.lang = lang;
    if (lang !== "en") { if (observer) observer.disconnect(); observer = null; return lang; }
    translateNode(document.body);
    if (!observer) {
      observer = new MutationObserver((list) => {
        list.forEach((m) => {
          if (m.type === "characterData") translateNode(m.target);
          else if (m.type === "attributes") translateNode(m.target);
          else m.addedNodes.forEach(translateNode);
        });
      });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    }
    return lang;
  }

  global.EdgeGlowI18n = {
    start,
    translate,
    get lang() { return lang; },
    locale: () => (lang === "en" ? "en-CA" : "fr-CA"),
    dayLetters: () => (lang === "en" ? ["M", "T", "W", "T", "F", "S", "S"] : ["L", "M", "M", "J", "V", "S", "D"]),
  };
})(window);
