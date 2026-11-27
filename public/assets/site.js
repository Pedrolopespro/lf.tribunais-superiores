/* Interações da LP: carrossel de tribunais (cada cartão abre o WhatsApp), botões de WhatsApp, avaliações, consentimento e animações. */
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
  // ?svc= (grupos de anúncios): [tribunal ou null, serviço]
  var PRESETS = { resp: ['stj', 'resp'], re: ['stf', 're'], rr: ['tst', 'rr'], hde: ['stj', 'hde'], despacho: [null, 'despacho'], sustentacao: [null, 'sustentacao'], acompanhamento: [null, 'acompanhamento'] };

  var ICON = {
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    wa: '<svg class="ic-wa" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>',
  };
  var label = function (list, code) { for (var i = 0; i < list.length; i++) if (list[i][0] === code) return list[i][1]; return ''; };

  // ---------- WhatsApp: todo botão de ação abre a conversa (sem formulário) ----------
  // ?tribunal= e ?svc= (anúncios) só deixam a mensagem pronta mais específica.
  var preset = { court: '', service: '' };
  function waMessage(court, service) {
    var t = TRIB[court];
    var sv = service ? (t ? label(SERV[court], service) : label(COMMON, service)) : '';
    return 'Olá! Gostaria de apoio para uma demanda' + (t ? ' no ' + t.nome + ' (' + t.sigla + ')' : '') + '.' + (sv ? '\nApoio: ' + sv : '');
  }
  function waUrl(text) { return 'https://wa.me/' + cfg.wa + '?text=' + encodeURIComponent(text); }

  // ---------- carrossel ----------
  var Car = (function () {
    var viewport = $('#car-viewport'), track = $('#car-track');
    var cards = [], n = COURTS.length, step = 0, setW = 0, off = 0, last = 0, tween = null;
    var hoverP = false, focusP = false, touchP = false, userP = false, selectedP = false, inView = true, touchTimer = 0;
    var SPEED = 30; // px/s, da direita para a esquerda

    function card(id, clone) {
      var t = TRIB[id], b = document.createElement('a');
      b.className = 'court'; b.setAttribute('data-court', id); b.href = '#tribunais';
      b.setAttribute('data-track', 'cta_click'); b.setAttribute('data-label', 'court_' + id);
      if (clone) { b.setAttribute('aria-hidden', 'true'); b.tabIndex = -1; }
      var logo = t.logo && useLogos ? '<span class="court__logo"><img src="/assets/img/' + id + '.png" alt="" loading="eager" decoding="async"></span>' : '<span class="court__logo court__logo--text" aria-hidden="true">' + t.sigla + '</span>';
      b.innerHTML = logo + '<span class="court__meta"><span class="court__sigla">' + t.sigla + '</span><span class="court__name">' + t.nome + '</span></span>' +
        '<span class="court__cta">' + ICON.wa + 'Falar com nossa equipe</span>';
      b.setAttribute('aria-label', t.nome + ' — falar com nossa equipe pelo WhatsApp');
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

  // ---------- conversão: todo clique para o WhatsApp vira uma demanda (sem dados pessoais) ----------
  var lastLead = { key: '', at: 0 };
  function sendLead(court, service) {
    var sv = court && service && label(SERV[court], service) ? service : '';
    var key = (court || '-') + ':' + sv;
    if (lastLead.key === key && Date.now() - lastLead.at < 60000) return; // clique repetido
    lastLead = { key: key, at: Date.now() };
    LF.convert('lead', { demand: (court || 'geral') + (sv ? ':' + sv : '') });
    LF.flush(false);
    try {
      fetch('/api/lead', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, credentials: 'omit',
        body: JSON.stringify({ tribunal: court || '', servico: sv, prazo: '', via: 'whatsapp', sid: LF.sid(), vid: LF.vid(), ft: LF.firstTouch() }) }).catch(function () {});
    } catch (err) { /* ignora */ }
  }

  // cartões dos tribunais: abrem o WhatsApp já com o tribunal na mensagem
  Car.cards.forEach(function (c) {
    c.addEventListener('click', function () {
      if (!cfg.wa) return;
      var id = c.getAttribute('data-court');
      LF.track('wizard_court', id);
      LF.track('whatsapp_click', 'court_' + id); LF.convert('whatsapp', { label: 'court_' + id });
      sendLead(id, preset.service);
    });
  });

  // botões gerais (cabeçalho, flutuante, encerramento): o tracker já conta o clique; aqui só registramos a demanda
  var waEls = $$('[data-wa]');
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-wa]');
    if (el && cfg.wa) sendLead(preset.court, preset.service);
  });

  function updateLinks() {
    if (!cfg.wa) return;
    var text = waMessage(preset.court, preset.service);
    waEls.forEach(function (el) { el.href = waUrl(text); el.target = '_blank'; el.rel = 'noopener'; });
    Car.cards.forEach(function (c) { c.href = waUrl(waMessage(c.getAttribute('data-court'), preset.service)); c.target = '_blank'; c.rel = 'noopener'; });
  }

  // ---------- parâmetros de anúncio: ?svc= e ?tribunal= ----------
  (function readPreset() {
    var q; try { q = new URLSearchParams(location.search); } catch (e) { return; }
    var svc = (q.get('svc') || '').toLowerCase(), trib = (q.get('tribunal') || '').toLowerCase();
    if (PRESETS[svc]) { preset.service = PRESETS[svc][1]; if (PRESETS[svc][0]) preset.court = PRESETS[svc][0]; }
    if (COURTS.indexOf(trib) > -1) preset.court = trib;
  })();
  updateLinks();

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

  // ---------- avaliações do Google: carrossel (só existe quando a integração está configurada no servidor) ----------
  // O servidor consulta o Google ao vivo (sem cache, por regra do Google) e só devolve o necessário. O texto entra com
  // textContent (nunca innerHTML) e não é editado. A consulta só acontece quando o visitante chega perto da seção.
  (function reviews() {
    var sec = $('#avaliacoes');
    if (!sec || !cfg.rev || !cfg.rev.on) return;
    var box = $('#rev'), track = $('#rev-track'), vp = $('#rev-viewport'), all = $('#rev-all'), note = $('#rev-note'), score = $('#rev-score');
    var pauseBtn = $('#rev-pause'), prevBtn = $('#rev-prev'), nextBtn = $('#rev-next');
    var started = false, timer = null, userPaused = !!reduceMq.matches, hovering = false, visible = false, touchTimer = null;

    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
    function ext(href, text, cls) { var a = el('a', cls, text); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; }

    function card(r) {
      var li = el('li', 'rev__card');
      var top = el('div', 'rev__top');
      var av = el('span', 'rev__av', (r.autor.charAt(0) || '?').toUpperCase()); av.setAttribute('aria-hidden', 'true');
      var who = el('div', 'rev__who');
      who.appendChild(r.autorUrl ? ext(r.autorUrl, r.autor, 'rev__name') : el('span', 'rev__name', r.autor));
      if (r.quando) who.appendChild(el('span', 'rev__when', r.quando));
      top.appendChild(av); top.appendChild(who); li.appendChild(top);
      var st = el('p', 'rev__stars'); st.setAttribute('role', 'img'); st.setAttribute('aria-label', 'Nota ' + r.nota + ' de 5');
      for (var i = 1; i <= 5; i++) st.appendChild(el('span', i <= r.nota ? 'on' : '', '★'));
      li.appendChild(st);
      var q = el('blockquote', 'rev__text'); q.appendChild(el('p', null, r.texto)); li.appendChild(q);
      var more = el('button', 'rev__more', 'Ler mais'); more.type = 'button'; more.hidden = true; more.setAttribute('aria-expanded', 'false');
      more.addEventListener('click', function () {
        var open = li.classList.toggle('is-open');
        more.textContent = open ? 'Ler menos' : 'Ler mais'; more.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      li.appendChild(more);
      if (r.url) li.appendChild(ext(r.url, 'Ver no Google', 'rev__link'));
      return li;
    }

    function stepPx() {
      var c = track.firstElementChild; if (!c) return 0;
      return c.getBoundingClientRect().width + (parseFloat(getComputedStyle(track).columnGap) || 16);
    }
    function go(dir) {
      var max = vp.scrollWidth - vp.clientWidth, x = vp.scrollLeft + dir * stepPx();
      if (dir > 0 && vp.scrollLeft >= max - 4) x = 0;
      if (dir < 0 && vp.scrollLeft <= 4) x = max;
      vp.scrollTo({ left: x, behavior: reduceMq.matches ? 'auto' : 'smooth' });
    }
    function running() { return !userPaused && !hovering && visible && !document.hidden; }
    function startTimer() { if (!timer) timer = setInterval(function () { if (running()) go(1); }, 6500); }
    function syncPause() {
      pauseBtn.setAttribute('aria-pressed', userPaused ? 'true' : 'false');
      pauseBtn.setAttribute('aria-label', userPaused ? 'Continuar' : 'Pausar');
    }

    function render(d) {
      var list = d && d.ok && d.reviews && d.reviews.length ? d.reviews : [];
      var perfil = (d && d.perfil) || cfg.rev.link || '';
      if (!list.length) {
        // sem avaliações (erro, teto diário ou perfil sem texto): só o link para o perfil, se houver
        if (!perfil) return;
        note.hidden = true; all.href = perfil; all.hidden = false; all.className = 'btn btn--outline btn--sm'; all.textContent = 'Ver avaliações no Google';
        sec.hidden = false; return;
      }
      list.forEach(function (r) { track.appendChild(card(r)); });
      if (perfil) { all.href = perfil; all.hidden = false; }
      if (d.nota) { score.textContent = String(d.nota.media).replace('.', ',') + ' de 5 · ' + d.nota.total + (d.nota.total === 1 ? ' avaliação' : ' avaliações') + ' no Google'; score.hidden = false; }
      box.hidden = false; sec.hidden = false;
      requestAnimationFrame(function () { // com a seção visível dá para medir quais textos ficaram cortados
        $$('.rev__card', track).forEach(function (li) {
          var p = $('.rev__text p', li);
          if (p && p.scrollHeight > p.clientHeight + 2) $('.rev__more', li).hidden = false;
        });
      });
      prevBtn.addEventListener('click', function () { go(-1); });
      nextBtn.addEventListener('click', function () { go(1); });
      pauseBtn.addEventListener('click', function () { userPaused = !userPaused; syncPause(); });
      vp.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') hovering = true; });
      vp.addEventListener('pointerleave', function () { hovering = false; });
      box.addEventListener('focusin', function () { hovering = true; });
      box.addEventListener('focusout', function () { hovering = false; });
      vp.addEventListener('touchstart', function () { hovering = true; clearTimeout(touchTimer); }, { passive: true });
      vp.addEventListener('touchend', function () { clearTimeout(touchTimer); touchTimer = setTimeout(function () { hovering = false; }, 6000); }, { passive: true });
      vp.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight') { e.preventDefault(); go(1); } else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); } });
      syncPause();
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (es) { visible = es[0].isIntersecting; }, { threshold: 0.3 }).observe(box);
      } else { visible = true; }
      startTimer();
    }

    // Widget gratuito do Featurable: o script deles monta as avaliações dentro do <div id="featurable-ID">.
    function featurable() {
      var holder = $('#rev-ext'), fid = String(cfg.rev.fid);
      var d = document.createElement('div'); d.id = 'featurable-' + fid; d.setAttribute('data-featurable-async', '');
      holder.appendChild(d); holder.hidden = false; sec.hidden = false;
      if (cfg.rev.link) { all.href = cfg.rev.link; all.hidden = false; }
      var failed = false;
      var fail = function () { // script bloqueado ou fora do ar: some o bloco e fica só o link (se houver)
        if (failed) return; failed = true; holder.hidden = true;
        if (cfg.rev.link) { note.hidden = true; all.className = 'btn btn--outline btn--sm'; all.textContent = 'Ver avaliações no Google'; }
        else sec.hidden = true;
      };
      // O widget injeta dados estruturados (nota média como "Product") no <head>. Removemos: nota agregada não confirmada pela
      // OAB e marcação de avaliações do próprio negócio fora das diretrizes do Google. Só a exibição das avaliações fica.
      var killSchema = function () { var x = document.getElementById('featurable-structured-data'); if (x) x.remove(); };
      if ('MutationObserver' in window) new MutationObserver(killSchema).observe(document.head, { childList: true });
      var s = document.createElement('script'); s.src = 'https://featurable.com/assets/bundle.js'; s.defer = true; s.charset = 'UTF-8';
      s.onerror = fail; document.body.appendChild(s);
      setTimeout(function () { if (d.offsetHeight < 20 && !d.childElementCount && !d.shadowRoot) fail(); }, 12000);
    }

    function load() {
      if (started) return; started = true;
      if (cfg.rev.fid) { featurable(); return; }
      fetch('/api/avaliacoes', { credentials: 'omit', headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(render, function () { render(null); });
    }
    // só consulta o Google quando o visitante chega perto da seção (poupa consultas pagas)
    var anchor = $('#escritorio');
    if (anchor && 'IntersectionObserver' in window) {
      var wait = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { wait.disconnect(); load(); } }, { rootMargin: '700px 0px' });
      wait.observe(anchor);
    } else { load(); }
  })();

  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.08 });
    $$('.reveal').forEach(function (el) { io.observe(el); });
  } else { $$('.reveal').forEach(function (el) { el.classList.add('in'); }); }
})();
