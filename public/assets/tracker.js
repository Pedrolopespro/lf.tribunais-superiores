/* Tracker first-party da LP.
   - Sem consentimento: mede de forma anônima (id de sessão só na aba, sem cookie/localStorage persistente, sem tags de terceiros).
   - Com consentimento: id persistente de visitante, primeiro toque (90 dias) e tags de terceiros (GTM / GA4 / Pixel / Google Ads).
   Todos os eventos também vão para window.dataLayer (prefixo lf_), para o gestor ligar GA4/Ads/Meta pelo GTM. */
(function () {
  'use strict';
  var cfg = {};
  try { cfg = JSON.parse(document.getElementById('lf-config').textContent) || {}; } catch (e) { /* sem config */ }

  var K = { consent: 'lf_consent', sid: 'lf_sid', vid: 'lf_vid', attr: 'lf_attr', ft: 'lf_ft' };
  var ENDPOINT = '/api/e';
  var dl = (window.dataLayer = window.dataLayer || []);
  function gtag() { dl.push(arguments); }
  window.gtag = window.gtag || gtag;

  // ---------- armazenamento seguro ----------
  function store(kind) {
    return {
      get: function (k) { try { return window[kind].getItem(k); } catch (e) { return null; } },
      set: function (k, v) { try { window[kind].setItem(k, v); } catch (e) { /* bloqueado */ } },
      del: function (k) { try { window[kind].removeItem(k); } catch (e) { /* bloqueado */ } },
    };
  }
  var LS = store('localStorage'), SS = store('sessionStorage');
  function rid(len) {
    var out = '';
    try { var a = new Uint8Array(len / 2); crypto.getRandomValues(a); for (var i = 0; i < a.length; i++) out += ('0' + a[i].toString(16)).slice(-2); return out; } catch (e) { /* fallback */ }
    while (out.length < len) out += Math.floor(Math.random() * 16).toString(16);
    return out;
  }
  function jparse(s) { try { return JSON.parse(s) || null; } catch (e) { return null; } }

  // ---------- consentimento ----------
  var consent = (function () { var c = jparse(LS.get(K.consent)); return c && (c.a === 1 || c.a === -1) ? c.a : 0; })();
  gtag('consent', 'default', { ad_storage: 'denied', analytics_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', wait_for_update: 500 });

  // ---------- atribuição ----------
  var ATTR_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid', 'svc'];
  var params = {};
  try { new URLSearchParams(location.search).forEach(function (v, k) { if (ATTR_KEYS.indexOf(k) > -1 && v) params[k] = String(v).slice(0, 120); }); } catch (e) { /* ignore */ }
  var NOW = Date.now();
  var CLICK_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'gclid', 'fbclid'];
  function sig(o) { return CLICK_KEYS.map(function (k) { return (o && o[k]) || ''; }).join('|'); }
  var hasClick = CLICK_KEYS.some(function (k) { return !!params[k]; });
  var prevAttr = jparse(SS.get(K.attr)) || {};
  var sess = jparse(SS.get(K.sid));
  // Sessão nova quando: não existe, passou de 30 min parado OU chegou um clique de campanha diferente do guardado.
  // (Sem isso, quem abre outro anúncio na mesma aba ficaria com a atribuição do primeiro acesso.)
  var isNewSession = !sess || !sess.id || NOW - sess.ts > 30 * 60 * 1000 || (hasClick && sig(params) !== sig(prevAttr));
  if (isNewSession) { sess = { id: rid(24), ts: NOW }; SS.del(K.attr); prevAttr = {}; }
  var attr = prevAttr;
  if (hasClick || !Object.keys(prevAttr).length) attr = params; else if (params.svc) attr.svc = params.svc;
  SS.set(K.attr, JSON.stringify(attr));
  function touchSession() { sess.ts = Date.now(); SS.set(K.sid, JSON.stringify(sess)); }
  touchSession();

  // Identificador de visitante: só com consentimento e com validade de 90 dias (igual à Política de Privacidade).
  var VID_TTL = 90 * 86400 * 1000;
  function vid() {
    if (consent !== 1) return '';
    var rec = jparse(LS.get(K.vid));
    if (!rec || !/^[a-f0-9]{16,32}$/.test(rec.v || '') || Date.now() - rec.t > VID_TTL) {
      rec = { v: rid(24), t: Date.now() };
      LS.set(K.vid, JSON.stringify(rec));
    }
    return rec.v;
  }
  function firstTouch() {
    var ft = jparse(LS.get(K.ft));
    if (ft && ft.ts && Date.now() - ft.ts > 90 * 86400 * 1000) { LS.del(K.ft); ft = null; }
    if (!ft && consent === 1) {
      ft = { landing: location.pathname, ref: document.referrer ? document.referrer.slice(0, 120) : '', ts: Date.now() };
      for (var k in attr) { if (Object.prototype.hasOwnProperty.call(attr, k)) ft[k] = attr[k]; }
      LS.set(K.ft, JSON.stringify(ft));
    }
    return consent === 1 ? ft : null;
  }

  function enabled() { return consent === 1 || cfg.anon !== false; }

  // ---------- fila e envio ----------
  var queue = [], timer = null;
  function ctx() {
    return {
      l: location.pathname, r: document.referrer || '', u: attr, c: consent,
      sw: window.screen ? screen.width : 0, sh: window.screen ? screen.height : 0, lg: navigator.language || '', wd: navigator.webdriver ? 1 : 0,
    };
  }
  function payload(batch) {
    var now = Date.now();
    return JSON.stringify({
      sid: sess.id, vid: vid(), ctx: ctx(),
      ev: batch.map(function (e) { return { n: e.n, l: e.l, v: e.v, x: e.x, a: now - e.t }; }),
    });
  }
  function flush(useBeacon) {
    if (!queue.length) return;
    var batch = queue.splice(0, 30);
    var body = payload(batch);
    var sent = false;
    if (useBeacon && navigator.sendBeacon) { try { sent = navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'text/plain' })); } catch (e) { sent = false; } }
    if (!sent) {
      try { fetch(ENDPOINT, { method: 'POST', body: body, keepalive: true, headers: { 'Content-Type': 'text/plain' }, credentials: 'omit' }).catch(function () {}); } catch (e) { /* ignore */ }
    }
    if (queue.length) flush(useBeacon);
  }
  function schedule() {
    if (timer) return;
    timer = setTimeout(function () { timer = null; flush(false); }, 1500);
  }

  var MIRROR = { cta_click: 1, whatsapp_click: 1, wizard_court: 1, wizard_service: 1, wizard_deadline: 1, wizard_summary: 1, wizard_copy: 1, carousel_ctl: 1, scroll: 1, section_view: 1, outbound_click: 1 };
  function track(name, label, value, extra) {
    touchSession();
    if (MIRROR[name]) {
      var o = { event: 'lf_' + name, lf_label: label || '' };
      if (value !== undefined && value !== null) o.lf_value = value;
      dl.push(o);
    }
    if (!enabled()) return;
    queue.push({ n: name, l: label ? String(label).slice(0, 80) : '', v: value === undefined ? null : value, x: extra || null, t: Date.now() });
    schedule();
  }

  // ---------- tags de terceiros (somente após aceite) ----------
  var tagsLoaded = false;
  function loadScript(src) { var s = document.createElement('script'); s.async = true; s.src = src; document.head.appendChild(s); }
  function loadTags() {
    if (tagsLoaded || consent !== 1) return;
    tagsLoaded = true;
    gtag('consent', 'update', { ad_storage: 'granted', analytics_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted' });
    if (cfg.gtm) {
      dl.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
      loadScript('https://www.googletagmanager.com/gtm.js?id=' + encodeURIComponent(cfg.gtm));
    } else if (cfg.ga4 || cfg.ads) {
      loadScript('https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(cfg.ga4 || cfg.ads));
      gtag('js', new Date());
      if (cfg.ga4) gtag('config', cfg.ga4);
      if (cfg.ads) gtag('config', cfg.ads);
    }
    if (cfg.pixel) {
      /* eslint-disable */
      !function (f, b, e, v, n, t, s) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); }; if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = []; t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s); }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
      /* eslint-enable */
      window.fbq('init', cfg.pixel);
      window.fbq('track', 'PageView');
    }
  }

  // ---------- conversões ----------
  function convert(kind, data) {
    data = data || {};
    if (kind === 'lead') {
      dl.push({ event: 'generate_lead', lf_demand: data.demand || '', lf_uf: data.uf || '' });
      if (consent === 1 && !cfg.gtm) {
        if (cfg.ga4) gtag('event', 'generate_lead', { lead_demand: data.demand || '' });
        if (cfg.ads && cfg.adsLead) gtag('event', 'conversion', { send_to: cfg.ads + '/' + cfg.adsLead });
      }
      if (consent === 1 && cfg.pixel && window.fbq) window.fbq('track', 'Lead');
    } else if (kind === 'whatsapp') {
      dl.push({ event: 'click_whatsapp', lf_label: data.label || '' });
      if (consent === 1 && !cfg.gtm) {
        if (cfg.ga4) gtag('event', 'click_whatsapp', { cta: data.label || '' });
        if (cfg.ads && cfg.adsWa) gtag('event', 'conversion', { send_to: cfg.ads + '/' + cfg.adsWa });
      }
      if (consent === 1 && cfg.pixel && window.fbq) window.fbq('track', 'Contact');
    }
  }

  function setConsent(accepted) {
    var prev = consent;
    consent = accepted ? 1 : -1;
    LS.set(K.consent, JSON.stringify({ a: consent, t: Date.now() }));
    if (accepted) {
      vid(); firstTouch(); loadTags();
      track('consent_accept');
    } else {
      LS.del(K.vid); LS.del(K.ft);
      track('consent_decline');
      if (prev === 1) gtag('consent', 'update', { ad_storage: 'denied', analytics_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
    }
    flush(false);
  }

  // ---------- comportamento ----------
  var lastAct = Date.now(), engagedMs = 0, lastEngagedSent = 0;
  ['pointermove', 'keydown', 'scroll', 'touchstart', 'click'].forEach(function (ev) {
    window.addEventListener(ev, function () { lastAct = Date.now(); }, { passive: true });
  });
  setInterval(function () {
    if (document.visibilityState === 'visible' && Date.now() - lastAct < 10000) {
      engagedMs += 1000;
      if (engagedMs - lastEngagedSent >= 15000) { lastEngagedSent = engagedMs; track('engaged', '', Math.round(engagedMs / 1000)); }
    }
  }, 1000);

  var maxPct = 0, marks = [25, 50, 75, 90], ticking = false;
  function onScroll() {
    if (ticking) return; ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var h = document.documentElement.scrollHeight || 1;
      var pct = Math.round(((window.scrollY || window.pageYOffset) + window.innerHeight) / h * 100);
      if (pct > maxPct) {
        maxPct = pct;
        while (marks.length && pct >= marks[0]) track('scroll', marks[0] + '%', marks.shift());
      }
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  function observe() {
    if (!('IntersectionObserver' in window)) return;
    var seen = {};
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var id = en.target.id;
        if (en.isIntersecting && id && !seen[id]) { seen[id] = 1; track('section_view', id); }
      });
    }, { rootMargin: '-35% 0px -35% 0px', threshold: 0 });
    var secs = document.querySelectorAll('[data-section]');
    for (var i = 0; i < secs.length; i++) io.observe(secs[i]);
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-track], a[href]') : null;
    if (!el) return;
    var name = el.getAttribute('data-track');
    var label = el.getAttribute('data-label') || '';
    if (name) {
      track(name, label);
      if (el.hasAttribute('data-wa') && cfg.wa) { track('whatsapp_click', label); convert('whatsapp', { label: label }); }
      return;
    }
    var href = el.getAttribute('href') || '';
    if (/^(https?:)?\/\//.test(href)) {
      try { var u = new URL(href, location.href); if (u.host !== location.host) track('outbound_click', u.host); } catch (err) { /* ignore */ }
    } else if (/^(tel|mailto):/.test(href)) {
      track('outbound_click', href.split(':')[0]);
    }
  }, true);

  document.addEventListener('toggle', function (e) {
    var d = e.target;
    if (d && d.tagName === 'DETAILS' && d.open) track('faq_open', d.getAttribute('data-label') || '');
  }, true);

  // ---------- qualidade técnica ----------
  var lcp = 0, cls = 0, vitalsSent = false;
  try {
    new PerformanceObserver(function (l) { var e = l.getEntries(); if (e.length) lcp = e[e.length - 1].startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) { if (!e.hadRecentInput) cls += e.value; }); }).observe({ type: 'layout-shift', buffered: true });
  } catch (e) { /* navegador sem suporte */ }
  var errs = 0;
  window.addEventListener('error', function (e) {
    if (errs >= 3) return; errs++;
    var f = (e.filename || '').split('/').pop();
    track('js_error', String(e.message || 'erro').slice(0, 50) + ' @' + f + ':' + (e.lineno || 0));
  });
  window.addEventListener('unhandledrejection', function () { if (errs < 3) { errs++; track('js_error', 'unhandledrejection'); } });

  function leave() {
    if (engagedMs - lastEngagedSent >= 1000) { lastEngagedSent = engagedMs; track('engaged', '', Math.round(engagedMs / 1000)); }
    if (!vitalsSent && (lcp || cls)) { vitalsSent = true; if (lcp) track('lcp', '', Math.round(lcp)); track('cls', '', Math.round(cls * 1000) / 1000); }
    flush(true);
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') leave(); });
  window.addEventListener('pagehide', leave);

  // ---------- início ----------
  track('page_view', '', null, params.svc ? { svc: params.svc } : null);
  if (consent === 1) { vid(); firstTouch(); loadTags(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observe); else observe();

  window.LF = {
    cfg: cfg, track: track, convert: convert, setConsent: setConsent, getConsent: function () { return consent; },
    sid: function () { return sess.id; }, vid: vid, attr: function () { return attr; }, firstTouch: firstTouch, flush: flush,
  };
})();
