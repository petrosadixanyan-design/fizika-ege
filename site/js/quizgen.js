// Квизы. ЗДЕСЬ ТОЛЬКО СБОРКА ВОПРОСОВ — ни одного обращения к странице,
// поэтому проверка (tests/check.py, часть quiz) может прогнать ВСЕ вопросы и убедиться,
// что у каждого ровно один верный ответ.
//
// ГЛАВНОЕ ПРАВИЛО: генератор ничего не выдумывает. Вопрос появляется только если
// в данных руками заполнено нужное поле:
//   «в чём измеряется» — есть unit и нет unitless/skipAuto;
//   «выбери верную запись» — есть traps (неверные записи пишет человек);
//   «что станет, если удвоить» — есть powers (степени тоже пишет человек);
//   «можно ли применять» — есть works и breaks.
// Нет поля — нет вопроса. Это убивает целый класс «умных» ошибок генератора.

(function (root) {
  'use strict';

  /* ---------- мелкие помощники ---------- */

  function hash(s) {
    var h = 2166136261;
    s = String(s);
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h >>> 0;
  }

  // Предсказуемый «случайный» порядок: от одного ключа всегда один и тот же.
  // Math.random тут нельзя — тест не смог бы ничего проверить.
  function rng(seed) {
    var a = (seed || 1) >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;   // всегда строго меньше 1
    };
  }

  function shuffle(arr, seed) {
    var a = arr.slice(), r = rng(seed);
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // «2 раза», «5 раз», «21 раз»
  function times(n) {
    var d = n % 10, h = n % 100;
    return (d >= 2 && d <= 4 && !(h >= 12 && h <= 14)) ? n + ' раза' : n + ' раз';
  }

  function varOf(card, key) {
    var vs = card.vars || [];
    for (var i = 0; i < vs.length; i++) if (vs[i].s === key) return vs[i];
    return null;
  }

  function skips(card, what) {
    return (card.skipAuto || []).indexOf(what) >= 0;
  }

  // Первая буква заглавной: пояснения в данных написаны с маленькой, а в вопросе
  // они становятся отдельным предложением.
  function big(s) {
    s = String(s || '').trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  }

  /* ---------- сбор словарей по всем данным ---------- */

  // Какие единицы вообще встречаются — из них берём неверные варианты.
  // Берём только настоящие единицы из данных: придумывать их нельзя.
  function unitPool(cards) {
    var set = {};
    for (var i = 0; i < cards.length; i++) {
      var vs = cards[i].vars || [];
      for (var j = 0; j < vs.length; j++) {
        if (vs[j].unit && !vs[j].unitless) set[vs[j].unit] = true;
      }
    }
    return Object.keys(set);
  }

  // Единицы, которые значат то же самое: они не должны стать «неверным» вариантом.
  var SAME = [
    ['Дж', 'Н·м', 'Вт·с'],
    ['Па', 'Н/м²'],
    ['Гц', '1/с', 'с⁻¹'],
    ['Вб', 'Тл·м²'],
    ['Кл', 'А·с'],
    ['В', 'Дж/Кл'],
    ['м/с²', 'Н/кг'],
  ];

  function sameAs(unit) {
    for (var i = 0; i < SAME.length; i++) if (SAME[i].indexOf(unit) >= 0) return SAME[i];
    return [unit];
  }

  /* ---------- генераторы ---------- */

  // 1. «В чём измеряется ...?»
  function genUnit(card, pool, out) {
    if (skips(card, 'unit')) return;
    var vs = card.vars || [];
    for (var i = 0; i < vs.length; i++) {
      var v = vs[i];
      if (!v.unit || v.unitless) continue;
      var bad = sameAs(v.unit).concat(card.unitAlso && card.unitAlso[v.s] ? card.unitAlso[v.s] : []);
      var id = card.id + '~unit~' + v.s;
      var others = pool.filter(function (u) { return bad.indexOf(u) < 0; });
      if (others.length < 3) continue;
      var picked = shuffle(others, hash(id)).slice(0, 3);
      // показываем БУКВУ и спрашиваем единицу: так проверяется связка «значок → смысл → единица»,
      // а не просто знание слова
      out.push({
        id: id, src: 'auto:unit', fid: card.id, topic: card.topic, kind: 'choice', hard: 1,
        ask: 'В чём измеряется эта величина из формулы «' + card.title + '»?',
        askTex: v.tex,
        opts: [{ t: v.unit, ok: true }].concat(picked.map(function (u) { return { t: u }; })),
        why: 'Это ' + v.name + ', измеряется в ' + v.unit + '.' + (v.about ? ' ' + big(v.about) : ''),
      });
    }
  }

  // 2. «Что означает эта буква?»
  function genLetter(card, allVars, out) {
    if (skips(card, 'letter')) return;
    var vs = card.vars || [];
    if (vs.length < 2) return;
    for (var i = 0; i < vs.length; i++) {
      var v = vs[i];
      var id = card.id + '~letter~' + v.s;
      // сначала берём другие буквы ЭТОЙ формулы — так вопрос учит различать её части
      var near = vs.filter(function (x) { return x.s !== v.s && x.name !== v.name; })
        .map(function (x) { return x.name; });
      var far = allVars.filter(function (n) { return n !== v.name && near.indexOf(n) < 0; });
      var picked = near.concat(shuffle(far, hash(id)).slice(0, 3)).slice(0, 3);
      if (picked.length < 3) continue;
      out.push({
        id: id, src: 'auto:letter', fid: card.id, topic: card.topic, kind: 'choice', hard: 1,
        ask: 'Что означает эта буква в формуле «' + card.title + '»?',
        askTex: v.tex,
        opts: [{ t: v.name, ok: true }].concat(picked.map(function (n) { return { t: n }; })),
        why: big(v.name) + (v.unit && !v.unitless ? ', измеряется в ' + v.unit : '') + '.'
          + (v.about ? ' ' + big(v.about) : ''),
      });
    }
  }

  // 3. «Какая запись верна?» — верная формула против ловушек, написанных руками.
  function genTrap(card, out) {
    if (skips(card, 'trap') || !card.tex) return;
    var tr = (card.traps || []).filter(function (t) { return t && t.tex && t.why; });
    if (tr.length < 2) return;
    var id = card.id + '~trap';
    var picked = shuffle(tr, hash(id)).slice(0, 3);
    out.push({
      id: id, src: 'auto:trap', fid: card.id, topic: card.topic, kind: 'choice', hard: 2,
      ask: 'Какая запись верна — «' + card.title + '»?',
      opts: [{ tex: card.tex, ok: true }].concat(picked.map(function (t) { return { tex: t.tex, why: t.why }; })),
      why: 'Верно: ' + card.short + '. Остальные записи ломаются так: ' +
        picked.map(function (t) { return t.why; }).join('; ') + '.',
    });
  }

  // 4. «Чем находят ...?» — название формулы, выбрать запись. Неверные варианты —
  //    записи СОСЕДНИХ формул (настоящие формулы, а не выдуманные).
  function genFind(card, byId, out) {
    if (skips(card, 'find') || !card.tex) return;
    var near = (card.linked || []).map(function (id) { return byId[id]; })
      .filter(function (c) { return c && c.tex && c.tex !== card.tex; });
    if (near.length < 3) return;
    var id = card.id + '~find';
    var picked = shuffle(near, hash(id)).slice(0, 3);
    out.push({
      id: id, src: 'auto:find', fid: card.id, topic: card.topic, kind: 'choice', hard: 2,
      ask: 'Какой формулой это находят: ' + card.title.toLowerCase() + '?',
      opts: [{ tex: card.tex, ok: true }].concat(picked.map(function (c) { return { tex: c.tex, why: 'это «' + c.title + '»' }; })),
      why: card.short.charAt(0).toUpperCase() + card.short.slice(1) + '.',
    });
  }

  // 5. «Что станет с ..., если ... увеличить в N раз?» — только по полю powers.
  function genPowers(card, out) {
    if (skips(card, 'powers') || !card.powers) return;
    for (var res in card.powers) {
      if (!Object.prototype.hasOwnProperty.call(card.powers, res)) continue;
      var deps = card.powers[res];
      var rv = varOf(card, res);
      for (var key in deps) {
        if (!Object.prototype.hasOwnProperty.call(deps, key)) continue;
        var p = deps[key];
        if (!p || Math.abs(p) > 3) continue;
        var kv = varOf(card, key);
        if (!rv || !kv) continue;
        var id = card.id + '~pow~' + res + '~' + key;
        var k = 2;
        var labels = {};
        function lab(power) {
          if (power === 0) return 'не изменится';
          var f = Math.pow(k, Math.abs(power));
          return (power > 0 ? 'увеличится в ' : 'уменьшится в ') + times(f);
        }
        var correct = lab(p);
        labels[correct] = true;
        var cand = [p > 0 ? p + 1 : p - 1, -p, 0, p > 0 ? 1 : -1];
        var opts = [{ t: correct, ok: true }];
        for (var c = 0; c < cand.length && opts.length < 4; c++) {
          var l = lab(cand[c]);
          if (labels[l]) continue;
          labels[l] = true;
          opts.push({ t: l });
        }
        if (opts.length < 4) continue;
        out.push({
          id: id, src: 'auto:powers', fid: card.id, topic: card.topic, kind: 'choice', hard: 3,
          ask: 'Формула «' + card.title + '». Что станет с величиной «' + rv.name + '», если «' +
            kv.name + '» увеличить в ' + times(k) + ', а остальное не менять?',
          opts: opts,
          why: 'В формуле ' + rv.name + ' зависит от «' + kv.name + '» ' +
            (Math.abs(p) === 1 ? (p > 0 ? 'прямо пропорционально' : 'обратно пропорционально')
              : (p > 0 ? 'как ' + Math.abs(p) + '-я степень' : 'как ' + Math.abs(p) + '-я степень в знаменателе')) +
            ', поэтому ответ: ' + correct + '.',
        });
      }
    }
  }

  // 6. «Можно ли применять формулу, если ...?» — два варианта, ответ всегда однозначен,
  //    потому что условия взяты из полей works (можно) и breaks (нельзя) этой же карточки.
  function genApply(card, out) {
    if (skips(card, 'apply')) return;
    var w = card.works || [], b = card.breaks || [];
    var mk = function (cond, canUse, i) {
      out.push({
        id: card.id + '~apply~' + (canUse ? 'w' : 'b') + i, src: 'auto:apply',
        fid: card.id, topic: card.topic, kind: 'choice', hard: 2,
        ask: 'Формула «' + card.title + '». Можно ею пользоваться, если ' + cond + '?',
        opts: canUse ? [{ t: 'Да, можно', ok: true }, { t: 'Нет, нельзя' }]
          : [{ t: 'Нет, нельзя', ok: true }, { t: 'Да, можно' }],
        why: canUse ? 'Это как раз условие, при котором формула работает.'
          : 'Это случай, когда формула не работает: ' + cond + '.',
      });
    };
    for (var i = 0; i < w.length && i < 2; i++) if (w[i].indexOf('$') < 0) mk(w[i], true, i);
    for (var j = 0; j < b.length && j < 2; j++) if (b[j].indexOf('$') < 0) mk(b[j], false, j);
  }

  /* ---------- сборка ---------- */

  // cards — карточки формул, manual — вопросы, написанные руками.
  // Ручной вопрос с тем же id ЗАТИРАЕТ автоматический: плохой автовопрос правится
  // одной строкой в данных, без правки генератора.
  function build(cards, manual) {
    var byId = {}, i;
    for (i = 0; i < cards.length; i++) byId[cards[i].id] = cards[i];

    var pool = unitPool(cards);
    var allVarNames = {};
    for (i = 0; i < cards.length; i++) {
      var vs = cards[i].vars || [];
      for (var j = 0; j < vs.length; j++) if (vs[j].name) allVarNames[vs[j].name] = true;
    }
    var names = Object.keys(allVarNames);

    var out = [];
    for (i = 0; i < cards.length; i++) {
      var c = cards[i];
      if (c.kind === 'opred') { genApply(c, out); continue; }
      genUnit(c, pool, out);
      genLetter(c, names, out);
      genTrap(c, out);
      genFind(c, byId, out);
      genPowers(c, out);
      genApply(c, out);
    }

    var map = {};
    for (i = 0; i < out.length; i++) map[out[i].id] = out[i];
    var man = manual || [];
    for (i = 0; i < man.length; i++) {
      var m = man[i];
      map[m.id] = Object.assign({ src: 'hand', kind: 'choice', hard: 2 }, m);
    }
    return Object.keys(map).map(function (k) { return map[k]; });
  }

  // Набор вопросов для одного захода: n штук, вперемешку, но без двух вопросов
  // про одну и ту же формулу подряд и с разными видами вопросов.
  function pick(all, topic, n, seed) {
    var list = all.filter(function (q) { return !topic || q.topic === topic; });
    list = shuffle(list, hash('pick:' + topic + ':' + seed));
    var out = [], usedF = {}, usedKind = {};
    var want = n || 10;
    // первый проход: по одному вопросу на формулу и поровну видов
    for (var pass = 0; pass < 3 && out.length < want; pass++) {
      for (var i = 0; i < list.length && out.length < want; i++) {
        var q = list[i];
        if (out.indexOf(q) >= 0) continue;
        var fk = q.fid || q.id;
        if (pass === 0 && usedF[fk]) continue;
        if (pass === 0 && (usedKind[q.src] || 0) > Math.ceil(want / 3)) continue;
        usedF[fk] = true;
        usedKind[q.src] = (usedKind[q.src] || 0) + 1;
        out.push(q);
      }
    }
    return out;
  }

  // Проверка одного вопроса: сколько верных вариантов, нет ли повторов.
  // Этим пользуется и сайт, и тест.
  function audit(q) {
    var bad = [];
    var opts = q.opts || [];
    if (opts.length < 2) bad.push('меньше двух вариантов');
    var right = opts.filter(function (o) { return o.ok; }).length;
    if (right !== 1) bad.push('верных вариантов ' + right + ', а должен быть ровно один');
    var seen = {};
    for (var i = 0; i < opts.length; i++) {
      var key = opts[i].tex || opts[i].t;
      if (!key || !String(key).trim()) bad.push('пустой вариант');
      if (seen[key]) bad.push('вариант повторяется: ' + key);
      seen[key] = true;
    }
    if (!q.ask || !q.ask.trim()) bad.push('нет текста вопроса');
    if (!q.why || !q.why.trim()) bad.push('нет пояснения');
    return bad;
  }

  root.Quiz = {
    build: build, pick: pick, audit: audit,
    shuffle: shuffle, hash: hash, times: times, SAME: SAME,
  };

})(typeof window !== 'undefined' ? window : globalThis);
