/*
 * WledClient : parle au contrôleur WLED.
 *
 * 1. Essaie d'abord le WebSocket (ws://IP/ws) : mises à jour instantanées dans les deux sens.
 * 2. Si le WebSocket échoue deux fois, essaie l'API HTTP JSON (/json/si) et passe en mode
 *    « sondage » : on relit l'état toutes les X secondes.
 * 3. Si rien ne répond, signale « offline » et réessaie avec un délai croissant.
 */
(function (global) {
  "use strict";

  const TIMEOUT_MS = 5000;

  async function fetchJson(url, options) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, Object.assign({ signal: ctrl.signal, cache: "no-store" }, options || {}));
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  class WledClient {
    constructor(handlers) {
      this.onState = handlers.onState || function () {};
      this.onStatus = handlers.onStatus || function () {};
      this.onLive = handlers.onLive || function () {};
      this.liveWanted = false;
      this.ip = "";
      this.mode = "idle"; // idle | ws | http | offline
      this.ws = null;
      this.failures = 0;
      this.pollSeconds = 5;
      this.timers = [];
      this.pollTimer = null;
      this.keepAliveTimer = null;
      this.stopped = true;
      this.diag = { wsUrl: "", wsEvents: "", httpError: "" };
    }

    get base() {
      return "http://" + this.ip;
    }

    start(ip, pollSeconds) {
      this.stop();
      this.ip = ip;
      this.pollSeconds = pollSeconds || 5;
      this.failures = 0;
      this.stopped = false;
      this.onStatus("connecting");
      this._openWs();
    }

    stop() {
      this.stopped = true;
      this.timers.forEach(clearTimeout);
      this.timers = [];
      clearInterval(this.pollTimer);
      clearInterval(this.keepAliveTimer);
      this.pollTimer = null;
      this.keepAliveTimer = null;
      if (this.ws) {
        this.ws.onclose = null;
        try { this.ws.close(); } catch (e) { /* ignoré */ }
        this.ws = null;
      }
      this.mode = "idle";
    }

    setPollInterval(seconds) {
      this.pollSeconds = seconds;
      if (this.mode === "http") this._startPolling();
    }

    /* ---------- WebSocket ---------- */

    _openWs() {
      if (this.stopped) return;
      let ws;
      try {
        this.diag.wsUrl = "ws://" + this.ip + "/ws";
        ws = new WebSocket(this.diag.wsUrl);
      } catch (e) {
        this.diag.wsEvents = "exception : " + e.name + " : " + e.message;
        this._wsFailed();
        return;
      }
      this.ws = ws;
      ws.binaryType = "arraybuffer";
      const openTimer = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) ws.close();
      }, TIMEOUT_MS);

      ws.onopen = () => {
        clearTimeout(openTimer);
        this.failures = 0;
        this.mode = "ws";
        this.onStatus("online");
        if (this.liveWanted) this._wsSend({ lv: true });
        // Garde la connexion vivante et resynchronise l'état chaque minute.
        clearInterval(this.keepAliveTimer);
        this.keepAliveTimer = setInterval(() => this._wsSend({ v: true }), 60000);
      };

      ws.onmessage = (ev) => {
        if (ev.data instanceof ArrayBuffer) {
          // Trame binaire de l'aperçu en direct : "L", version, puis les couleurs.
          this.onLive(new Uint8Array(ev.data));
          return;
        }
        if (typeof ev.data !== "string") return;
        let data;
        try { data = JSON.parse(ev.data); } catch (e) { return; }
        if (data.state) this.onState(data.state, data.info || null);
        else if (data.on !== undefined) this.onState(data, null);
      };

      ws.onerror = () => {
        this.diag.wsEvents = "erreur (état " + ws.readyState + ")";
      };

      ws.onclose = (ev) => {
        this.diag.wsEvents += " | fermé : code " + ev.code + (ev.reason ? " " + ev.reason : "");
        clearTimeout(openTimer);
        clearInterval(this.keepAliveTimer);
        this.ws = null;
        if (this.stopped) return;
        this._wsFailed();
      };
    }

    _wsFailed() {
      this.failures++;
      if (this.failures === 2) {
        // Deux échecs : on tente l'API HTTP.
        this._tryHttp();
        return;
      }
      this.onStatus(this.failures > 2 ? "offline" : "connecting");
      const delay = Math.min(30000, 1000 * Math.pow(2, this.failures));
      this._later(() => this._openWs(), delay);
    }

    _wsSend(obj) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(obj));
        return true;
      }
      return false;
    }

    /* ---------- HTTP (mode secours) ---------- */

    async _tryHttp() {
      try {
        const data = await fetchJson(this.base + "/json/si");
        if (this.stopped) return;
        this.mode = "http";
        this.onStatus("online-http");
        this.onState(data.state, data.info);
        this._startPolling();
      } catch (e) {
        this.diag.httpError = (e && e.name) + " : " + (e && e.message);
        if (this.stopped) return;
        this.mode = "offline";
        this.onStatus("offline");
        this.failures++;
        this._later(() => this._openWs(), 10000);
      }
    }

    _startPolling() {
      clearInterval(this.pollTimer);
      this.pollTimer = setInterval(async () => {
        try {
          const data = await fetchJson(this.base + "/json/si");
          this.onStatus("online-http");
          this.onState(data.state, data.info);
        } catch (e) {
          this.onStatus("offline");
        }
      }, this.pollSeconds * 1000);
    }

    /* ---------- Aperçu en direct des DEL ---------- */

    // Seul le WebSocket transporte l'aperçu. WLED n'envoie l'aperçu qu'à un client à la fois.
    setLive(on) {
      this.liveWanted = Boolean(on);
      this._wsSend({ lv: this.liveWanted });
    }

    get liveAvailable() {
      return this.mode === "ws";
    }

    /* ---------- Commandes ---------- */

    async send(obj) {
      if (this._wsSend(obj)) return;
      if (!this.ip) return;
      try {
        const body = Object.assign({}, obj, { v: true });
        const state = await fetchJson(this.base + "/json/state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (state && state.on !== undefined) this.onState(state, null);
      } catch (e) {
        this.onStatus("offline");
      }
    }

    /* ---------- Listes (effets, palettes, préréglages) ---------- */

    async loadLists() {
      const cacheKey = "wled-lists:" + this.ip;
      const [eff, pal, ps, fxd] = await Promise.allSettled([
        fetchJson(this.base + "/json/eff"),
        fetchJson(this.base + "/json/pal"),
        fetchJson(this.base + "/presets.json"),
        fetchJson(this.base + "/json/fxdata"),
      ]);

      let cached = {};
      try { cached = JSON.parse(localStorage.getItem(cacheKey) || "{}"); } catch (e) { cached = {}; }

      const lists = {
        effects: eff.status === "fulfilled" ? eff.value : cached.effects || [],
        palettes: pal.status === "fulfilled" ? pal.value : cached.palettes || [],
        presets: ps.status === "fulfilled" ? ps.value : cached.presets || {},
        fxdata: fxd.status === "fulfilled" ? fxd.value : cached.fxdata || [],
        palx: cached.palx || {},
      };

      // Couleurs réelles des palettes (WLED 0.14 et plus), 8 palettes par page.
      try {
        const first = await fetchJson(this.base + "/json/palx?page=0");
        const all = Object.assign({}, first.p || {});
        const max = Math.min(Number(first.m) || 0, 60);
        for (let page = 1; page <= max; page++) {
          const r = await fetchJson(this.base + "/json/palx?page=" + page);
          Object.assign(all, r.p || {});
        }
        lists.palx = all;
      } catch (e) { /* ancienne version de WLED : pas d'aperçu des couleurs */ }

      try { localStorage.setItem(cacheKey, JSON.stringify(lists)); } catch (e) { /* stockage plein ou indisponible */ }
      return lists;
    }

    /* ---------- Calendrier (lecture seule pour l'instant) ---------- */

    // /json/cfg est la configuration complète du WLED. On n'y lit que les horaires.
    async loadSchedule() {
      const [cfg, info] = await Promise.all([
        fetchJson(this.base + "/json/cfg"),
        fetchJson(this.base + "/json/info").catch(() => null),
      ]);
      const timers = (cfg && cfg.timers) || {};
      return {
        entries: Array.isArray(timers.ins) ? timers.ins : [],
        info: info,
      };
    }

    /* ---------- Écriture (calendrier, préréglages) ---------- */

    getJson(path) {
      return fetchJson(this.base + path);
    }

    postJson(path, body) {
      return fetchJson(this.base + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    _later(fn, ms) {
      this.timers.push(setTimeout(fn, ms));
    }
  }

  global.WledClient = WledClient;
})(window);
