/* Scripts do painel (CSP: somente 'self'). */
(function () {
  'use strict';

  // atualização automática (tempo real)
  var main = document.getElementById('main');
  var every = main && Number(main.getAttribute('data-refresh'));
  if (every) setTimeout(function () { location.reload(); }, every * 1000);

  // confirmação antes de excluir (CSP não permite handlers inline)
  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (e) { if (!window.confirm(form.getAttribute('data-confirm'))) e.preventDefault(); });
  });

  // mostrar/ocultar senha: um botão em cada campo de senha (sem JS o campo continua oculto, como deve ser)
  document.querySelectorAll('input[type="password"]').forEach(function (input) {
    var label = input.closest('label');
    if (label && !input.getAttribute('aria-label')) { // o botão não pode entrar no nome do campo
      var first = label.firstChild && label.firstChild.nodeType === 3 ? label.firstChild.textContent.trim() : '';
      if (first) input.setAttribute('aria-label', first);
    }
    var wrap = document.createElement('span');
    wrap.className = 'pw';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pw__btn';
    btn.textContent = 'Mostrar';
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-label', 'Mostrar senha');
    btn.addEventListener('click', function () {
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'Ocultar' : 'Mostrar';
      btn.setAttribute('aria-pressed', show ? 'true' : 'false');
      btn.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
      input.focus();
    });
    wrap.appendChild(btn);
  });

  // filtros: período personalizado só liga as datas quando necessário
  document.querySelectorAll('form.filters select[name="p"]').forEach(function (sel) {
    var form = sel.form;
    function sync() { form.querySelectorAll('input[type="date"]').forEach(function (i) { i.disabled = sel.value !== 'custom'; }); }
    sel.addEventListener('change', sync); sync();
  });

  // gerador de UTM
  var f = document.getElementById('utm-form');
  if (f) {
    var out = document.getElementById('utm-out'), suf = document.getElementById('utm-suffix');
    var slug = function (v) {
      return String(v || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9{}_\-]+/g, '-').replace(/^-+|-+$/g, '');
    };
    var build = function () {
      var v = function (n) { return f.elements[n].value; };
      var q = [];
      var add = function (k, val) { if (val) q.push(k + '=' + val.replace(/\{/g, '%7B').replace(/\}/g, '%7D')); };
      add('utm_source', slug(v('source'))); add('utm_medium', slug(v('medium'))); add('utm_campaign', slug(v('campaign')));
      add('utm_content', slug(v('content'))); add('utm_term', slug(v('term'))); add('svc', v('svc')); add('tribunal', v('tribunal'));
      var base = v('base').trim() || f.getAttribute('data-site') || '';
      if (/^https?:\/\/[^\/?#]+$/.test(base)) base += '/';
      var hasQ = base.indexOf('?') > -1;
      out.value = base + (hasQ ? '&' : '?') + q.join('&');
      var s = ['utm_source=google', 'utm_medium=cpc', 'utm_campaign=' + (slug(v('campaign')) || 'nome-da-campanha'), 'utm_term={keyword}', 'utm_content={creative}'];
      if (v('svc')) s.push('svc=' + v('svc'));
      if (v('tribunal')) s.push('tribunal=' + v('tribunal'));
      s.push('matchtype={matchtype}');
      suf.value = s.join('&');
    };
    f.addEventListener('input', build); f.addEventListener('change', build); build();
    var copy = function (id, btn) {
      return function () {
        var el = document.getElementById(id);
        el.select();
        var done = function () { var t = btn.textContent; btn.textContent = 'Copiado!'; setTimeout(function () { btn.textContent = t; }, 1500); };
        if (navigator.clipboard) navigator.clipboard.writeText(el.value).then(done); else { document.execCommand('copy'); done(); }
      };
    };
    var b1 = document.getElementById('utm-copy'), b2 = document.getElementById('utm-copy2');
    if (b1) b1.addEventListener('click', copy('utm-out', b1));
    if (b2) b2.addEventListener('click', copy('utm-suffix', b2));
  }
})();
