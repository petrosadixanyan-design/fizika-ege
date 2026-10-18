// Собирает HTML из данных. Работает И в браузере, И в Node внутри tools/prerender.js,
// поэтому здесь нельзя обращаться к document — только строки.
//
// Готовый HTML формул берётся не напрямую, а через Render.use({d, i}): в браузере это
// Data, в пререндере — свой объект. Так один и тот же файл годится в оба места.

(function (root) {
  'use strict';

  var get = { d: function () { return null; }, i: function () { return null; } };
  function use(src) { get = src; }

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Крупная формула (отдельной строкой) и строчная (внутри текста).
  // Если в «своём» наборе формулы нет, берём из соседнего: одна и та же буква бывает
  // нарисована только как строчная, а показать её надо крупно (например, в вопросе квиза).
  function md(tex) {
    var h = get.d(tex) || get.i(tex);
    return h || '<code class="plain">' + esc(tex) + '</code>';
  }
  function mi(tex) {
    var h = get.i(tex) || get.d(tex);
    return h ? '<span class="m">' + h + '</span>' : '<code class="plain">' + esc(tex) + '</code>';
  }

  // Текст, в котором формулы помечены $...$ — например «следи за знаком $a_x$».
  function text(s) {
    if (!s) return '';
    var out = '', last = 0, re = /\$([^$]+)\$/g, m;
    while ((m = re.exec(s))) {
      out += esc(s.slice(last, m.index)) + mi(m[1]);
      last = m.index + m[0].length;
    }
    return out + esc(s.slice(last));
  }

  /* ---------- мелкие кусочки ---------- */

  // Сила памяти: пять точек. Понятнее ученику, чем «интервал 12 дней».
  function dots(n) {
    var s = '';
    for (var i = 1; i <= 5; i++) s += i <= n ? '●' : '<span class="off">○</span>';
    return '<span class="dots" aria-label="сила памяти ' + n + ' из 5">' + s + '</span>';
  }

  function levelTag(level) {
    return level === 'БУ'
      ? '<span class="tag bu" title="базовый уровень: нужно всем">БУ</span>'
      : '<span class="tag uu" title="углублённый уровень: вторая часть и сложные задания">УУ</span>';
  }

  function bar(part, cls) {
    var p = Math.max(0, Math.min(100, Math.round(part)));
    return '<span class="bar ' + (cls || '') + '"><i style="width:' + p + '%"></i></span>';
  }

  function plural(n, one, few, many) {
    var d = n % 10, h = n % 100;
    if (d === 1 && h !== 11) return one;
    if (d >= 2 && d <= 4 && !(h >= 12 && h <= 14)) return few;
    return many;
  }

  /* ---------- мини-график ---------- */

  var PATHS = {
    naklon: 'M14 86 L104 20',
    parabola: 'M14 86 Q 56 86 104 18',
    const: 'M14 50 L104 50',
    ubyvanie: 'M14 20 Q 56 86 104 84',
  };

  function plot(p) {
    if (!p || !PATHS[p.kind]) return '';
    return '<div class="plot">'
      + '<svg viewBox="0 0 120 100" role="img" aria-label="график зависимости">'
      + '<path class="ax" d="M14 92 L112 92" /><path class="ax" d="M14 92 L14 8" />'
      + '<path class="ln" d="' + PATHS[p.kind] + '" />'
      + '<text class="lb" x="4" y="12">' + esc(plainTex(p.y)) + '</text>'
      + '<text class="lb" x="104" y="104">' + esc(plainTex(p.x)) + '</text>'
      + '</svg></div>';
  }

  // Подпись оси в SVG — без KaTeX: внутри <svg> его разметка не работает.
  function plainTex(t) {
    return String(t || '')
      .replace(/\\upsilon/g, 'υ').replace(/\\omega/g, 'ω').replace(/\\alpha/g, 'α')
      .replace(/\\Delta/g, 'Δ').replace(/\\Phi/g, 'Ф').replace(/\\nu/g, 'ν')
      .replace(/[{}]/g, '').replace(/_/g, '');
  }

  /* ---------- строка в списке формул ---------- */

  function frow(card, strength) {
    var body = card.tex ? md(card.tex) : '<b>' + esc(card.short) + '</b>';
    return '<a class="frow" href="#/f/' + esc(card.id) + '">'
      + '<span class="f"><span class="ftitle">' + esc(card.title) + '</span>' + body + '</span>'
      + dots(strength || 0) + '</a>';
  }

  /* ---------- плитка темы ---------- */

  function tile(t, st) {
    var n = st && st.total ? st.total : 0;
    return '<a class="tile" href="#/t/' + esc(t.id) + '">'
      + '<span class="head"><span class="code">' + esc(t.code) + '</span>'
      + '<span class="name">' + esc(t.title) + '</span></span>'
      + '<span class="about">' + esc(t.about) + '</span>'
      + '<span class="meta">' + bar(n ? 100 * st.learned / n : 0)
      + '<span>' + (st ? st.learned + ' из ' + n : '—') + '</span></span>'
      + '</a>';
  }

  /* ---------- экран одной формулы ---------- */

  function block(title, icon, inner) {
    if (!inner) return '';
    return '<section class="card block"><h3><span class="ic" aria-hidden="true">' + icon + '</span>'
      + esc(title) + '</h3>' + inner + '</section>';
  }

  function note(cls, label, body) {
    if (!body) return '';
    return '<div class="note ' + cls + '"><span class="lab">' + esc(label) + '</span>' + text(body) + '</div>';
  }

  function list(cls, arr) {
    if (!arr || !arr.length) return '';
    return '<ul class="lw ' + cls + '">' + arr.map(function (s) { return '<li>' + text(s) + '</li>'; }).join('') + '</ul>';
  }

  function vars(card) {
    if (!card.vars || !card.vars.length) return '';
    var rows = card.vars.map(function (v) {
      return '<li><button type="button" class="vbtn" aria-expanded="false" data-sym="' + esc(v.s) + '">'
        + '<span class="sym">' + mi(v.tex) + '</span>'
        + '<span class="f"><span class="nm">' + esc(v.name) + '</span>'
        + (v.about ? '<span class="ab">' + text(v.about) + (v.note ? ' ' + text(v.note) : '') + '</span>' : '')
        + '</span>'
        + '<span class="un">' + (v.unitless ? 'без единиц' : esc(v.unit)) + '</span>'
        + '</button></li>';
    }).join('');
    return '<section class="card block"><h3><span class="ic" aria-hidden="true">🔤</span>Что значит каждая буква</h3>'
      + '<p class="small muted">Нажми на букву — покажу подробнее.</p>'
      + '<ul class="vars">' + rows + '</ul></section>';
  }

  function tasksLine(card) {
    if (!card.tasks || !card.tasks.length) return '';
    return '<p>Встречается в ' + plural(card.tasks.length, 'задании', 'заданиях', 'заданиях')
      + ' ЕГЭ <b>№ ' + card.tasks.join(', ') + '</b>.</p>';
  }

  // Полный экран формулы. deep: true — раскрыть все подробности (для печатной шпаргалки).
  function formula(card, opt) {
    opt = opt || {};
    var t = root.Data ? root.Data.topic(card.topic) : null;
    var h = '';

    h += '<div class="fhead"><div class="crumb">'
      + (t ? '<a class="chip" href="#/t/' + esc(t.id) + '">' + esc(t.code) + ' ' + esc(t.title) + '</a>' : '')
      + levelTag(card.level)
      + (card.must === 1 ? '<span class="tag" title="без этой формулы ЕГЭ не сдать">обязательно</span>' : '')
      + '</div><h2>' + esc(card.title) + '</h2></div>';

    if (card.tex) {
      h += '<div class="fbig" role="math" aria-label="' + esc(card.read) + '">'
        + md(card.tex)
        + '<p class="short">' + esc(card.short) + '</p></div>';
    } else if (card.law) {
      h += '<div class="card"><p>' + text(card.law) + '</p></div>';
    }

    h += vars(card);

    if ((card.works && card.works.length) || (card.breaks && card.breaks.length)) {
      h += block('Когда работает и когда нет', '⚖️',
        list('works', card.works) + list('breaks', card.breaks));
    }

    h += note('memo', card.memo && card.memo.kind ? 'как запомнить — ' + card.memo.kind : 'как запомнить',
      card.memo && card.memo.text);
    if (card.signs) h += note('sign', 'про знаки', card.signs);
    if (card.mistake) h += note('mist', 'типичная ошибка', card.mistake);

    var more = '';
    if (card.origin) more += det('Откуда она берётся', text(card.origin), opt.deep);
    if (card.unitcheck) more += det('Проверка по единицам', text(card.unitcheck), opt.deep);
    if (card.example) more += det('Пример с числами',
      '<p><b>' + text(card.example.q) + '</b></p><p>' + text(card.example.a) + '</p>', opt.deep);
    if (card.plot) more += det('Как выглядит график', plot(card.plot), opt.deep);
    if (card.tasks && card.tasks.length) more += det('Где это на ЕГЭ', tasksLine(card), opt.deep);
    h += more;

    var near = (card.linked || []).map(function (id) {
      var c = root.Data ? root.Data.card(id) : null;
      return c ? '<a class="chip" href="#/f/' + esc(id) + '">' + esc(c.title) + '</a>' : '';
    }).filter(Boolean).join('');
    if (near) h += block('Рядом стоит запомнить', '🔗', '<div class="chips">' + near + '</div>');

    return h;
  }

  function det(title, body, open) {
    return '<details class="more"' + (open ? ' open' : '') + '><summary>' + esc(title) + '</summary>'
      + '<div class="body">' + body + '</div></details>';
  }

  /* ---------- вопрос квиза ---------- */

  function question(q, n, total) {
    var h = '<p class="small muted">Вопрос ' + n + ' из ' + total + '</p>';
    h += '<p class="q">' + text(q.ask) + '</p>';
    if (q.askTex) h += '<div class="fbig">' + md(q.askTex) + '</div>';
    h += '<div class="opts">';
    for (var i = 0; i < q.opts.length; i++) {
      var o = q.opts[i];
      h += '<button type="button" class="opt" data-i="' + i + '">'
        + '<span class="k">' + (i + 1) + '</span>'
        + '<span class="tx">' + (o.tex ? md(o.tex) : text(o.t)) + '</span></button>';
    }
    return h + '</div><div class="why" aria-live="polite"></div>';
  }

  root.Render = {
    use: use, esc: esc, md: md, mi: mi, text: text,
    dots: dots, levelTag: levelTag, bar: bar, plural: plural, plot: plot, plainTex: plainTex,
    frow: frow, tile: tile, formula: formula, question: question, block: block, note: note,
    list: list, det: det, tasksLine: tasksLine,
  };

})(typeof window !== 'undefined' ? window : globalThis);
