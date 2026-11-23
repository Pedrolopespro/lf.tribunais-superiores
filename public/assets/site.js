/* Interações da LP: carrossel de tribunais, assistente de 3 etapas, WhatsApp, consentimento e animações. */
(function () {
  'use strict';
  var LF = window.LF || { cfg: {}, track: function () {}, convert: function () {}, setConsent: function () {}, getConsent: function () { return 0; }, sid: function () { return ''; }, vid: function () { return ''; }, firstTouch: function () { return null; }, flush: function () {} };
  var cfg = LF.cfg || {};
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var root = document.documentElement;
  var reduceMq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false, addEventListener: function () {} };
  function applyReduce() { root.classList.toggle('reduced', !!reduceMq.matches); }
  applyReduce();
  if (reduceMq.addEventListener) reduceMq.addEventListener('change', applyReduce);

  // ---------- dados (espelhados em server/track.js) ----------
  var COURTS = ['stf', 'stj', 'tst', 'tse', 'stm'];
  var useLogos = cfg.logos !== false; // site.marcasTribunais=false troca as marcas por texto (ex.: enquanto não houver autorização)
  var TRIB = {
    stf: { sigla: 'STF', nome: 'Supremo Tribunal Federal', logo: true },
    stj: { sigla: 'STJ', nome: 'Superior Tribunal de Justiça', logo: true },
    tst: { sigla: 'TST', nome: 'Tribunal Superior do Trabalho', logo: true },
    tse: { sigla: 'TSE', nome: 'Tribunal Superior Eleitoral', logo: false },
    stm: { sigla: 'STM', nome: 'Superior Tribunal Militar', logo: true },
  };
  var COMMON = [['despacho', 'Despacho e memoriais'], ['sustentacao', 'Sustentação oral'], ['acompanhamento', 'Acompanhamento processual']];
  var SERV = {
    stf: [['re', 'Recurso extraordinário']].concat(COMMON, [['outra', 'Outra demanda']]),
    stj: [['resp', 'Recurso especial']].concat(COMMON, [['hde', 'Homologação de decisão estrangeira'], ['outra', 'Outra demanda']]),
    tst: [['rr', 'Recurso de revista']].concat(COMMON, [['outra', 'Outra demanda']]),
    tse: [['eleitoral', 'Apresentar demanda eleitoral']],
    stm: [['militar', 'Apresentar demanda militar']],
  };
  var PRAZOS = [['andamento', 'Tenho um prazo em andamento'], ['julgamento', 'Tenho um julgamento marcado'], ['sem-data', 'Não há uma data próxima'], ['explicar', 'Prefiro explicar à equipe']];
  // ?svc= (grupos de anúncios): [tribunal ou null, serviço]
  var PRESETS = { resp: ['stj', 'resp'], re: ['stf', 're'], rr: ['tst', 'rr'], hde: ['stj', 'hde'], despacho: [null, 'despacho'], sustentacao: [null, 'sustentacao'], acompanhamento: [null, 'acompanhamento'] };

  var ICON = {
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    chev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 6 6 6-6 6"/></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 6-6 6 6 6"/></svg>',
  };
  var label = function (list, code) { for (var i = 0; i < list.length; i++) if (list[i][0] === code) return list[i][1]; return ''; };

  // ---------- estado ----------
  var S = { court: '', service: '', prazo: '', step: 0, leadKey: '', leadAt: 0 };
  var picker = $('[data-picker]'), selectView = $('.picker__select'), wiz = $('#wiz');
  var presetService = '';

  function summaryMessage() {
    var t = TRIB[S.court];
    return 'Olá! Gostaria de apoio para uma demanda.\nTribunal: ' + t.nome + ' (' + t.sigla + ')\nApoio: ' + label(SERV[S.court], S.service) + '\nPrazo: ' + label(PRAZOS, S.prazo);
  }
  var genericMessage = 'Olá! Gostaria de apoio para uma demanda.';
  var complete = function () { return !!(S.court && S.service && S.prazo); };
  function waUrl(text) { return 'https://wa.me/' + cfg.wa + '?text=' + encodeURIComponent(text); }

  // ---------- carrossel ----------
  var Car = (function () {
    var viewport = $('#car-viewport'), track = $('#car-track');
    var cards = [], n = COURTS.length, step = 0, setW = 0, off = 0, last = 0, tween = null;
    var hoverP = false, focusP = false, touchP = false, userP = false, selectedP = false, inView = true, touchTimer = 0;
    var SPEED = 30; // px/s, da direita para a esquerda

    function card(id, clone) {
      var t = TRIB[id], b = document.createElement('button');
      b.type = 'button'; b.className = 'court'; b.setAttribute('data-court', id);
      if (clone) { b.setAttribute('aria-hidden', 'true'); b.tabIndex = -1; }
      var logo = t.logo && useLogos ? '<span class="court__logo"><img src="/assets/img/' + id + '.png" alt="" loading="eager" decoding="async"></span>' : '<span class="court__logo court__logo--text" aria-hidden="true">' + t.sigla + '</span>';
      b.innerHTML = logo + '<span class="court__meta"><span class="court__sigla">' + t.sigla + '</span><span class="court__name">' + t.nome + '</span></span>' +
        '<span class="court__cta">Selecionar tribunal ' + ICON.arrow + '</span>';
      b.setAttribute('aria-label', t.nome + ' — Selecionar tribunal');
      return b;
    }
    for (var pass = 0; pass < 2; pass++) COURTS.forEach(function (id) { track.appendChild(card(id, pass === 1)); });
    cards = $$('.court', track);

    function measure() {
      if (!viewport.clientWidth) return;
      step = cards[1].offsetLeft - cards[0].offsetLeft;
      setW = step * n;
    }
    function wrap() { if (setW) off = ((off % setW) + setW) % setW; }
    function apply() { track.style.transform = 'translate3d(' + (-off).toFixed(2) + 'px,0,0)'; }
    function playing() {
      return !reduceMq.matches && !userP && !hoverP && !focusP && !touchP && !selectedP && inView && document.visibilityState === 'visible' && !!setW;
    }
    function frame(ts) {
      var dt = last ? Math.min(64, ts - last) : 16; last = ts;
      if (tween) {
        var k = Math.min(1, (ts - tween.t0) / tween.d), e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        off = tween.from + (tween.to - tween.from) * e;
        if (k >= 1) { tween = null; wrap(); }
      } else if (playing()) { off += SPEED * dt / 1000; }
      if (setW) { if (!tween) wrap(); apply(); }
      requestAnimationFrame(frame);
    }
    function go(dir) {
      measure(); if (!step) return;
      var to = off + dir * step;
      if (reduceMq.matches) { off = to; wrap(); apply(); return; }
      tween = { from: off, to: to, t0: performance.now(), d: 560 };
    }
    function ensureVisible(el) {
      var i = cards.indexOf(el); if (i < 0) return;
      var left = (i % n) * step, w = el.offsetWidth, vw = viewport.clientWidth;
      var rel = ((left - off) % setW + setW) % setW;
      if (rel + w > vw || rel < 0) { off = left - Math.max(0, (vw - w) / 2); tween = null; wrap(); apply(); }
    }
    // pausas: mouse, teclado, toque, seleção
    viewport.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') hoverP = true; });
    viewport.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') hoverP = false; });
    viewport.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse') return;
      touchP = true; clearTimeout(touchTimer);
    });
    ['pointerup', 'pointercancel'].forEach(function (ev) { viewport.addEventListener(ev, function (e) { if (e.pointerType !== 'mouse') { clearTimeout(touchTimer); touchTimer = setTimeout(function () { touchP = false; }, 4500); } }); });
    root.addEventListener('focusin', function (e) { if (e.target.closest && e.target.closest('#car')) { focusP = true; var c = e.target.closest('.court'); if (c) ensureVisible(c); } });
    root.addEventListener('focusout', function (e) { if (!e.relatedTarget || !(e.relatedTarget.closest && e.relatedTarget.closest('#car'))) focusP = false; });
    viewport.addEventListener('scroll', function () { viewport.scrollLeft = 0; }); // o foco não pode "rolar" o contêiner
    if ('IntersectionObserver' in window) new IntersectionObserver(function (en) { inView = en[0].isIntersecting; }, { threshold: 0.05 }).observe($('#car'));
    window.addEventListener('resize', function () { measure(); wrap(); apply(); });

    var prev = $('#car-prev'), next = $('#car-next'), pause = $('#car-pause');
    prev.addEventListener('click', function () { LF.track('carousel_ctl', 'prev'); go(-1); });
    next.addEventListener('click', function () { LF.track('carousel_ctl', 'next'); go(1); });
    // O botão reflete o estado real: parado pelo visitante OU parado porque há um tribunal selecionado.
    function syncPause() {
      var on = userP || selectedP;
      pause.setAttribute('aria-pressed', on ? 'true' : 'false'); pause.setAttribute('aria-label', on ? 'Retomar' : 'Pausar');
    }
    pause.addEventListener('click', function () {
      if (userP || selectedP) { userP = false; selectedP = false; LF.track('carousel_ctl', 'resume'); }
      else { userP = true; LF.track('carousel_ctl', 'pause'); }
      syncPause();
    });

    measure(); requestAnimationFrame(frame);
    return {
      cards: cards, refresh: function () { measure(); wrap(); apply(); },
      setSelected: function (id) { cards.forEach(function (c) { c.classList.toggle('is-selected', !!id && c.getAttribute('data-court') === id); }); selectedP = !!id; syncPause(); },
    };
  })();

  // ---------- assistente ----------
  function topBar(stepNo) {
    var t = TRIB[S.court];
    var mark = '<i></i>';
    var bar = [1, 2, 3].map(function (i) { return '<span' + (i <= stepNo ? ' class="on"' : '') + '></span>'; }).join('');
    return '<div class="wiz__top"><span class="wiz__court">' + mark + t.sigla + '</span><span>Etapa ' + stepNo + ' de 3</span></div><div class="wiz__bar" aria-hidden="true">' + bar + '</div>';
  }
  var backBtn = function (act) { return '<button type="button" class="wiz__back" data-act="' + act + '">' + ICON.back + 'Voltar</button>'; };

  function render(opts) {
    opts = opts || {};
    var showWiz = S.step > 0;
    selectView.hidden = showWiz; wiz.hidden = !showWiz;
    root.classList.toggle('wiz-open', showWiz);
    Car.setSelected(S.court);
    if (!showWiz) { Car.refresh(); updateWa(); return; }
    var html = '';
    if (S.step === 1) {
      html = topBar(1) + '<h2 class="wiz__h" tabindex="-1">Como podemos apoiar seu escritório?</h2><div class="wiz__opts">' +
        SERV[S.court].map(function (s) { return '<button type="button" class="opt' + (S.service === s[0] ? ' is-on' : '') + '" data-act="service" data-v="' + s[0] + '"><span>' + s[1] + '</span>' + ICON.chev + '</button>'; }).join('') +
        '</div>' + backBtn('back');
    } else if (S.step === 2) {
      html = topBar(2) + '<h2 class="wiz__h" tabindex="-1">Há algum prazo ou julgamento próximo?</h2><div class="wiz__opts">' +
        PRAZOS.map(function (p) { return '<button type="button" class="opt' + (S.prazo === p[0] ? ' is-on' : '') + '" data-act="prazo" data-v="' + p[0] + '"><span>' + p[1] + '</span>' + ICON.chev + '</button>'; }).join('') +
        '</div>' + backBtn('back');
    } else {
      var t = TRIB[S.court], msg = summaryMessage();
      var action = cfg.wa
        ? '<a class="btn btn--gold wiz__go" data-act="wa" target="_blank" rel="noopener" href="' + waUrl(msg) + '">Continuar pelo WhatsApp</a><p class="wiz__note">Você será direcionado ao WhatsApp com suas escolhas.</p>'
        : '<button type="button" class="btn btn--gold wiz__go" data-act="copy">Copiar resumo da demanda</button><p class="wiz__ok" role="status" aria-live="polite" id="wiz-ok"></p>';
      html = topBar(3) + '<h2 class="wiz__h" tabindex="-1">Vamos conversar sobre sua demanda.</h2>' +
        '<ul class="sum"><li><span>Tribunal</span><b>' + t.sigla + '</b><button type="button" data-act="edit-court">Alterar</button></li>' +
        '<li><span>Apoio</span><b>' + label(SERV[S.court], S.service) + '</b><button type="button" data-act="edit-service">Alterar</button></li>' +
        '<li><span>Prazo</span><b>' + label(PRAZOS, S.prazo) + '</b><button type="button" data-act="edit-prazo">Alterar</button></li></ul>' +
        '<p class="msg" aria-label="Mensagem preenchida">' + msg.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</p>' + action + backBtn('back');
    }
    wiz.innerHTML = html;
    updateWa();
    if (!opts.quiet) {
      var h = $('.wiz__h', wiz); if (h) h.focus({ preventScroll: true });
      var r = picker.getBoundingClientRect();
      if (r.top < 70 || r.bottom > window.innerHeight) picker.scrollIntoView({ block: 'center', behavior: reduceMq.matches ? 'auto' : 'smooth' });
    }
    if (S.step === 3) LF.track('wizard_summary', S.court + ':' + S.service + ':' + S.prazo);
  }

  function chooseCourt(id, quiet) {
    S.court = id; S.prazo = '';
    LF.track('wizard_court', id);
    var list = SERV[id];
    if (presetService && label(list, presetService)) { S.service = presetService; LF.track('wizard_service', id + ':' + S.service, null, { preset: 1 }); S.step = 2; }
    else if (list.length === 1) { S.service = ''; S.step = 1; }
    else { S.service = ''; S.step = 1; }
    render({ quiet: quiet });
  }

  wiz.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    var act = b.getAttribute('data-act'), v = b.getAttribute('data-v');
    if (act === 'service') { S.service = v; LF.track('wizard_service', S.court + ':' + v); S.step = 2; render(); }
    else if (act === 'prazo') { S.prazo = v; LF.track('wizard_deadline', v); S.step = 3; render(); }
    else if (act === 'back') { LF.track('wizard_back', String(S.step)); S.step = S.step - 1; render(); }
    else if (act === 'edit-court') { LF.track('wizard_back', 'court'); S.step = 0; render(); }
    else if (act === 'edit-service') { LF.track('wizard_back', 'service'); S.step = 1; render(); }
    else if (act === 'edit-prazo') { LF.track('wizard_back', 'prazo'); S.step = 2; render(); }
    else if (act === 'wa') { LF.track('whatsapp_click', 'wizard_final'); LF.convert('whatsapp', { label: 'wizard_final' }); sendLead('whatsapp'); }
    else if (act === 'copy') {
      var ok = $('#wiz-ok');
      copyText(summaryMessage()).then(function () { if (ok) ok.textContent = 'Resumo copiado.'; }, function () { if (ok) ok.textContent = 'Não foi possível copiar. Selecione o texto acima.'; });
      LF.track('wizard_copy', S.court + ':' + S.service + ':' + S.prazo); sendLead('copia');
    }
  });

  Car.cards.forEach(function (c) { c.addEventListener('click', function () { chooseCourt(c.getAttribute('data-court')); }); });

  function copyText(t) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t);
    return new Promise(function (res, rej) {
      var ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
      document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      ta.remove(); ok ? res() : rej();
    });
  }

  // conversão: clique final (WhatsApp ou cópia) com as escolhas e a atribuição da sessão
  function sendLead(via) {
    if (!complete()) return;
    var key = S.court + ':' + S.service + ':' + S.prazo + ':' + via;
    if (S.leadKey === key && Date.now() - S.leadAt < 60000) return;
    S.leadKey = key; S.leadAt = Date.now();
    LF.convert('lead', { demand: S.court + ':' + S.service });
    LF.flush(false);
    try {
      fetch('/api/lead', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, credentials: 'omit',
        body: JSON.stringify({ tribunal: S.court, servico: S.service, prazo: S.prazo, via: via, sid: LF.sid(), vid: LF.vid(), ft: LF.firstTouch() }) }).catch(function () {});
    } catch (err) { /* ignora */ }
  }

  // ---------- WhatsApp do cabeçalho e do botão flutuante ----------
  var waEls = $$('[data-wa]');
  function updateWa() {
    if (!cfg.wa) return;
    var text = complete() ? summaryMessage() : genericMessage;
    waEls.forEach(function (el) { el.href = waUrl(text); el.target = '_blank'; el.rel = 'noopener'; });
  }
  updateWa();

  // ---------- parâmetros de anúncio: ?svc= e ?tribunal= ----------
  (function preset() {
    var q; try { q = new URLSearchParams(location.search); } catch (e) { return; }
    var svc = (q.get('svc') || '').toLowerCase(), trib = (q.get('tribunal') || '').toLowerCase();
    if (PRESETS[svc]) {
      presetService = PRESETS[svc][1];
      if (PRESETS[svc][0]) { chooseCourt(PRESETS[svc][0], true); return; }
    }
    if (COURTS.indexOf(trib) > -1) chooseCourt(trib, true);
  })();
  render({ quiet: true });

  // ---------- cabeçalho, consentimento, animações ----------
  var hdr = $('#hdr');
  function onScroll() { hdr.classList.toggle('is-solid', (window.scrollY || window.pageYOffset) > 24); }
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();

  var banner = $('#consent');
  function syncConsentOffset() { root.classList.toggle('consent-open', !!banner && !banner.hidden); }
  function showBanner() { banner.hidden = false; syncConsentOffset(); }
  function hideBanner() { banner.hidden = true; syncConsentOffset(); }
  if (banner) {
    if (LF.getConsent() === 0) setTimeout(showBanner, 900);
    $('#consent-accept').addEventListener('click', function () { LF.setConsent(true); hideBanner(); });
    $('#consent-decline').addEventListener('click', function () { LF.setConsent(false); hideBanner(); });
    var open = $('#open-consent'); if (open) open.addEventListener('click', showBanner);
  }

  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.08 });
    $$('.reveal').forEach(function (el) { io.observe(el); });
  } else { $$('.reveal').forEach(function (el) { el.classList.add('in'); }); }
})();
