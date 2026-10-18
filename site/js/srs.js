// Умное повторение. ЗДЕСЬ ТОЛЬКО АРИФМЕТИКА — ни одного обращения к странице,
// поэтому всё это проверяется тестом (tests/check.py, часть srs), как planner.js в tour_site.
//
// Основа — SM-2 (тот же алгоритм, что у Anki), плюс три доработки под экзамен:
//   1) потолок интервала: не больше 40% дней, оставшихся до ЕГЭ;
//   2) финишная прямая: последнюю неделю всё повторяется каждый день;
//   3) поздний успех в плюс: вспомнил спустя долгий перерыв — значит знаешь крепче, чем мы думали.
// Просрочку в вину НЕ ставим: «легкость» падает только за нажатую кнопку.
//
// Даты — строки 'ГГГГ-ММ-ДД'. Часы не храним: внутри одного захода карточка возвращается
// по очереди сессии, а не по времени. Так проще и честнее.

(function (root) {
  'use strict';

  var DEF = {
    firstIv: 1,          // первый интервал после выпуска из обучения, дней
    secondIv: 3,         // второй интервал
    learnSteps: 2,       // сколько раз показать новую карточку внутри одного захода
    efStart: 2.5, efMin: 1.3, efMax: 2.8,
    efUp: 0.10,          // «знаю» → легкость растёт
    efDownHard: 0.15,    // «с трудом»
    efDownAgain: 0.20,   // «не помню»
    hardMul: 1.2,        // «с трудом» растит интервал всего на 20%
    lateBonus: 1.5,      // поздний успех учитываем не больше чем в полтора раза
    backKeep: 0.3,       // забыл формулу — сохраняем 30% прежнего интервала, а не начинаем с нуля
    maxIv: 1825,         // предел интервала, 5 лет: иначе за годы он переполнит дату
    examReserve: 0.4,    // интервал ≤ 40% дней до ЕГЭ
    finishDays: 7,       // последняя неделя — прогон всего каждый день
    noNewDays: 5,        // за сколько дней до ЕГЭ перестаём давать новые
    newPerDay: 8,        // новых карточек в день
    maxPerDay: 40,       // всего карточек в день
    examDate: '',        // '' — дата ЕГЭ не задана, тогда потолка нет
  };

  /* ---------- даты ---------- */

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // 'ГГГГ-ММ-ДД' из объекта Date (по местному времени, а не UTC)
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  function parse(s) {
    var p = String(s || '').split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }

  // сколько дней от a до b (b − a). Отрицательно, если b раньше.
  function days(a, b) {
    if (!a || !b) return 0;
    return Math.round((parse(b) - parse(a)) / 86400000);
  }

  function addDays(a, n) {
    var d = parse(a);
    d.setDate(d.getDate() + Math.round(n));
    return iso(d);
  }

  function today() { return iso(new Date()); }

  /* ---------- карточка ---------- */

  // Пустая карточка: ещё ни разу не показывали.
  // back — сколько дней вернуть карточке, когда она выйдет из переучивания (см. backKeep).
  function blank() {
    return { iv: 0, ef: DEF.efStart, n: 0, due: '', last: '', lapses: 0, seen: 0, st: 'new', step: 0, back: 0 };
  }

  // Приводим что угодно (битые данные из localStorage, null, строку) к нормальной карточке.
  function fix(c) {
    var b = blank();
    if (!c || typeof c !== 'object') return b;
    var num = function (v, d) { return typeof v === 'number' && isFinite(v) ? v : d; };
    return {
      iv: Math.max(0, num(c.iv, 0)),
      ef: Math.min(DEF.efMax, Math.max(DEF.efMin, num(c.ef, DEF.efStart))),
      n: Math.max(0, num(c.n, 0)),
      due: typeof c.due === 'string' ? c.due : '',
      last: typeof c.last === 'string' ? c.last : '',
      lapses: Math.max(0, num(c.lapses, 0)),
      seen: Math.max(0, num(c.seen, 0)),
      st: ['new', 'learn', 'review', 'relearn'].indexOf(c.st) >= 0 ? c.st : 'new',
      step: Math.max(0, num(c.step, 0)),
      back: Math.max(0, num(c.back, 0)),
      id: typeof c.id === 'string' ? c.id : '',
    };
  }

  // Разброс интервала ±10% (но не больше 3 дней), чтобы карточки не слипались в один день.
  // Без Math.random: маленький хэш от ключа, иначе тест не смог бы предсказать число.
  function fuzz(key, iv) {
    if (iv < 4) return 0;
    var h = 2166136261;
    var s = String(key);
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    var span = Math.min(3, Math.round(iv * 0.1));
    if (span < 1) return 0;
    return (h % (2 * span + 1)) - span;
  }

  // Потолок интервала: общий предел плюс ограничение из-за близкого экзамена.
  function cap(iv, todayStr, opt) {
    var lim = opt.maxIv || DEF.maxIv;
    iv = Math.min(isFinite(iv) ? iv : 1, lim);
    if (!opt.examDate) return Math.max(1, iv);
    var left = days(todayStr, opt.examDate);
    if (left <= 0) return Math.max(1, iv);                  // экзамен уже прошёл — ничего не ограничиваем
    if (left <= opt.finishDays) return 1;                   // финишная прямая: каждый день
    return Math.max(1, Math.min(iv, Math.floor(left * opt.examReserve), left - 1));
  }

  /* ---------- главный расчёт ---------- */

  // Ответ ученика. grade: 'again' | 'hard' | 'know'.
  // Возвращает { card, again } — again: true значит «показать ещё раз в этом же заходе».
  function next(cardIn, grade, todayStr, optIn) {
    var opt = Object.assign({}, DEF, optIn || {});
    var c = fix(cardIn);
    var day = todayStr || today();
    c.seen += 1;

    var learning = (c.st === 'new' || c.st === 'learn' || c.st === 'relearn');

    if (learning) {
      if (grade === 'again') {
        if (c.st !== 'new') c.lapses += 1;
        c.ef = Math.max(opt.efMin, c.ef - opt.efDownAgain);
        c.step = 0;
        c.st = (c.st === 'new' ? 'learn' : c.st);
        c.last = day; c.iv = 1; c.due = addDays(day, 1);
        return { card: c, again: true };
      }
      if (grade === 'hard') {
        // «с трудом» на новой карточке шаг не двигает — показываем ещё раз
        c.st = (c.st === 'new' ? 'learn' : c.st);
        c.last = day; c.iv = 1; c.due = addDays(day, 1);
        return { card: c, again: true };
      }
      // 'know'
      c.step += 1;
      if (c.step < opt.learnSteps) {
        c.st = (c.st === 'new' ? 'learn' : c.st);
        c.last = day; c.iv = 1; c.due = addDays(day, 1);
        return { card: c, again: true };
      }
      // выпуск из обучения. Если карточку переучивали после «не помню»,
      // возвращаем ей часть прежнего интервала (back), а не начинаем с одного дня.
      c.ef = Math.min(opt.efMax, c.ef + opt.efUp);
      var hadBack = c.back > 0;
      var want = hadBack ? Math.max(opt.firstIv, c.back) : opt.firstIv;
      c.back = 0;
      c.st = 'review'; c.step = 0;
      // после переучивания счётчик успехов НЕ начинаем заново: иначе следующий интервал
      // взялся бы из фиксированных 1 и 3 дня и оказался бы короче текущего
      c.n = hadBack ? 3 : 1;
      c.iv = cap(want, day, opt);
      c.last = day; c.due = addDays(day, c.iv);
      return { card: c, again: false };
    }

    // карточка в обычном повторении
    var elapsed = c.last ? Math.max(0, days(c.last, day)) : c.iv;
    // Поздний успех: вспомнил спустя перерыв — значит знаешь крепче, чем мы думали.
    // Берём половину опоздания (так же делает Anki) и не разгоняемся больше lateBonus.
    var late = Math.max(0, elapsed - c.iv);
    var base = Math.max(c.iv, Math.min(c.iv + late / 2, c.iv * opt.lateBonus));
    var raw;

    if (grade === 'again') {
      c.ef = Math.max(opt.efMin, c.ef - opt.efDownAgain);
      c.lapses += 1; c.n = 0; c.st = 'relearn'; c.step = 0;
      c.back = Math.max(1, Math.round(c.iv * opt.backKeep));   // сколько вернём после переучивания
      c.last = day; c.iv = 1; c.due = addDays(day, 1);
      return { card: c, again: true };
    }
    if (grade === 'hard') {
      c.ef = Math.max(opt.efMin, c.ef - opt.efDownHard);
      c.n += 1;
      raw = Math.max(c.iv + 1, Math.round(base * opt.hardMul));
    } else {
      c.ef = Math.min(opt.efMax, c.ef + opt.efUp);
      c.n += 1;
      raw = c.n === 1 ? opt.firstIv : c.n === 2 ? opt.secondIv : Math.round(base * c.ef);
    }

    // разброс считаем от КЛЮЧА карточки, иначе все формулы с одинаковой историей
    // назначатся на один и тот же день и получится «день из 40 карточек»
    raw = Math.max(1, raw + fuzz((c.id || '') + ':' + c.n, raw));
    c.iv = cap(raw, day, opt);
    c.last = day; c.due = addDays(day, c.iv);
    return { card: c, again: false };
  }

  // Ошибся в квизе: легкость НЕ портим (иначе один промах считается дважды),
  // но если карточка «ушла далеко» — возвращаем её в повторение на завтра.
  function afterQuiz(cardIn, todayStr, optIn) {
    var opt = Object.assign({}, DEF, optIn || {});
    var c = fix(cardIn);
    if (c.st === 'review' && c.iv > 7) {
      c.iv = Math.min(c.iv, 1);
      c.due = addDays(todayStr || today(), 1);
    }
    return c;
  }

  /* ---------- очередь на сегодня ---------- */

  // ids — все карточки, какие есть в данных: [{ id, must }].
  // state — что про них знает хранилище: { id: карточка }.
  function queue(ids, state, todayStr, optIn) {
    var opt = Object.assign({}, DEF, optIn || {});
    var day = todayStr || today();
    var left = opt.examDate ? days(day, opt.examDate) : Infinity;

    var due = [], fresh = [];
    for (var i = 0; i < ids.length; i++) {
      var it = ids[i];
      var c = state[it.id];
      if (!c || !c.due || c.st === 'new') { fresh.push(it); continue; }
      if (days(day, c.due) <= 0) {
        var over = fix(c).iv > 0 ? Math.abs(days(c.due, day)) / fix(c).iv : 99;
        due.push({ id: it.id, must: it.must || 2, over: over });
      }
    }

    // просроченные: сначала то, что обязательно знать, внутри — самое просроченное
    due.sort(function (a, b) { return (a.must - b.must) || (b.over - a.over); });
    fresh.sort(function (a, b) { return (a.must || 2) - (b.must || 2); });

    var newLimit = (left <= opt.noNewDays) ? 0 : opt.newPerDay;
    var dueIds = due.map(function (d) { return d.id; });
    var newIds = fresh.slice(0, newLimit).map(function (f) { return f.id; });

    // режем общий объём: сначала повторения, новые добираем остатком
    var room = Math.max(0, opt.maxPerDay);
    var cutDue = dueIds.slice(0, room);
    var cutNew = newIds.slice(0, Math.max(0, room - cutDue.length));

    // перемешиваем: одна новая после каждых четырёх повторений,
    // иначе заход начинается со стены незнакомых формул
    var out = [], di = 0, ni = 0;
    while (di < cutDue.length || ni < cutNew.length) {
      for (var k = 0; k < 4 && di < cutDue.length; k++) out.push(cutDue[di++]);
      if (ni < cutNew.length) out.push(cutNew[ni++]);
      if (di >= cutDue.length) { while (ni < cutNew.length) out.push(cutNew[ni++]); }
    }

    return {
      list: out,
      due: cutDue.length,
      fresh: cutNew.length,
      skippedDue: dueIds.length - cutDue.length,   // сколько просроченных не влезло
      totalDue: dueIds.length,
      totalNew: fresh.length,
    };
  }

  // План подготовки: успеваем ли пройти все новые формулы до экзамена.
  function plan(ids, state, todayStr, optIn) {
    var opt = Object.assign({}, DEF, optIn || {});
    var day = todayStr || today();
    var newLeft = 0, learned = 0;
    for (var i = 0; i < ids.length; i++) {
      var c = state[ids[i].id];
      if (!c || c.st === 'new') newLeft++;
      else if (c.st === 'review' && c.iv >= 7) learned++;
    }
    var left = opt.examDate ? days(day, opt.examDate) : null;
    var workDays = left === null ? null : Math.max(1, left - opt.finishDays);
    var needPerDay = workDays === null ? null : Math.ceil(newLeft / workDays);
    return {
      left: left, newLeft: newLeft, learned: learned, total: ids.length,
      needPerDay: needPerDay,
      hurry: needPerDay !== null && needPerDay > opt.newPerDay,
    };
  }

  /* ---------- как крепко помним ---------- */

  // Сила памяти в точках, 0…5 — понятная ученику замена слову «интервал».
  function strength(c) {
    if (!c || !c.due || c.st === 'new') return 0;
    var iv = fix(c).iv;
    if (iv < 2) return 1;
    if (iv < 5) return 2;
    if (iv < 12) return 3;
    if (iv < 25) return 4;
    return 5;
  }

  // Готовность к ЕГЭ: средняя вероятность вспомнить формулу в день экзамена.
  // R = exp(−дней_до_ЕГЭ_от_последнего_ответа / (9.5 × интервал)): через «интервал» дней
  // получается ровно 0,9 — то есть интервалы и подбираются под «помню на 90%».
  function ready(ids, state, todayStr, examDate) {
    var day = todayStr || today();
    var sum = 0, cnt = 0;
    for (var i = 0; i < ids.length; i++) {
      if ((ids[i].must || 2) > 1) continue;          // считаем по формулам, которые знать обязательно
      cnt++;
      var c = state[ids[i].id];
      if (!c || !c.last || c.st === 'new') continue;
      var f = fix(c);
      if (f.iv <= 0) continue;
      var gap = examDate ? Math.max(0, days(f.last, examDate)) : Math.max(0, days(f.last, day));
      sum += Math.exp(-gap / (9.5 * f.iv));
    }
    return cnt ? Math.round(100 * sum / cnt) : 0;
  }

  root.SRS = {
    DEF: DEF, blank: blank, fix: fix, next: next, afterQuiz: afterQuiz,
    queue: queue, plan: plan, strength: strength, ready: ready,
    days: days, addDays: addDays, today: today, iso: iso, cap: cap, fuzz: fuzz,
  };

})(typeof window !== 'undefined' ? window : globalThis);
