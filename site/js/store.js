// Прогресс ученика. Хранится в самом браузере (localStorage), без регистрации и сервера.
//
// ВАЖНО: все ключи начинаются с 'fizege:' — на petrosadixanyan-design.github.io
// хранилище общее для всех сайтов проекта, без приставки они бы перемешались.
//
// Любое чтение и запись обёрнуты в try/catch: в режиме инкогнито и при запрете
// cookie-файлов localStorage бросает исключение, и сайт не должен от этого падать.

(function (root) {
  'use strict';

  var P = 'fizege:';
  var K = { cards: P + 'cards:v1', set: P + 'set:v1', log: P + 'log:v1', quiz: P + 'quiz:v1' };

  var SET_DEF = {
    exam: '',            // дата ЕГЭ, 'ГГГГ-ММ-ДД'; пусто — не задана
    newPerDay: 8,
    maxPerDay: 40,
    both: true,          // учить формулу в обе стороны (название→формула и формула→смысл)
    theme: 'auto',       // auto | light | dark
    hello: false,        // показывали ли первый экран с вопросом про дату
  };

  var mem = {};          // запасной «склад» в памяти, если localStorage недоступен
  var broken = false;

  function raw(key) {
    if (broken) return mem[key];
    try { var v = localStorage.getItem(key); return v === null ? undefined : v; }
    catch (e) { broken = true; return mem[key]; }
  }

  function put(key, str) {
    mem[key] = str;
    if (broken) return false;
    try { localStorage.setItem(key, str); return true; }
    catch (e) { broken = true; return false; }   // переполнение или запрет — живём в памяти
  }

  function read(key, def) {
    var s = raw(key);
    if (s === undefined) return def;
    try {
      var v = JSON.parse(s);
      return (v === null || typeof v !== typeof def) ? def : v;
    } catch (e) { return def; }
  }

  function write(key, val) { return put(key, JSON.stringify(val)); }

  /* ---------- карточки ---------- */

  function cards() { return read(K.cards, {}); }

  // Сохраняем сразу после каждого ответа: телефон может закрыть вкладку в любой момент.
  function saveCard(id, card) {
    var all = cards();
    all[id] = card;
    return write(K.cards, all);
  }

  function saveCards(patch) {
    var all = cards();
    for (var id in patch) if (Object.prototype.hasOwnProperty.call(patch, id)) all[id] = patch[id];
    return write(K.cards, all);
  }

  /* ---------- настройки ---------- */

  function settings() {
    var s = read(K.set, {});
    var out = {};
    for (var k in SET_DEF) {
      out[k] = Object.prototype.hasOwnProperty.call(s, k) && typeof s[k] === typeof SET_DEF[k] ? s[k] : SET_DEF[k];
    }
    return out;
  }

  function setSettings(patch) {
    var s = settings();
    for (var k in patch) if (Object.prototype.hasOwnProperty.call(SET_DEF, k)) s[k] = patch[k];
    return write(K.set, s);
  }

  /* ---------- дневник: сколько карточек сделано в какой день ---------- */

  function log() { return read(K.log, {}); }

  function addDone(day, n) {
    var l = log();
    l[day] = (l[day] || 0) + (n || 1);
    // держим только последние 120 дней, иначе файл растёт без смысла
    var keys = Object.keys(l).sort();
    while (keys.length > 120) { delete l[keys.shift()]; }
    return write(K.log, l);
  }

  function doneToday(day) { return log()[day] || 0; }

  // Сколько дней подряд занимался, считая от сегодня (или от вчера, если сегодня ещё не начал).
  function streak(day, addDays) {
    var l = log();
    var n = 0;
    var d = l[day] ? day : addDays(day, -1);
    while (l[d]) { n++; d = addDays(d, -1); }
    return n;
  }

  /* ---------- квиз: лучшие результаты и ошибки ---------- */

  function quiz() { return read(K.quiz, {}); }

  function saveQuiz(topic, right, total) {
    var q = quiz();
    var was = q[topic] || { best: 0, runs: 0 };
    q[topic] = {
      best: Math.max(was.best || 0, total ? Math.round(100 * right / total) : 0),
      runs: (was.runs || 0) + 1,
    };
    return write(K.quiz, q);
  }

  /* ---------- перенос прогресса на другой телефон ---------- */

  function exportText() {
    return JSON.stringify({
      v: 1, kind: 'fizege-progress',
      cards: cards(), set: settings(), log: log(), quiz: quiz(),
    });
  }

  // Возвращает { ok: true, n: сколько карточек } или { ok: false, why: 'почему' }.
  function importText(text) {
    var d;
    try { d = JSON.parse(String(text).trim()); }
    catch (e) { return { ok: false, why: 'Это не похоже на сохранённый прогресс: текст не читается.' }; }
    if (!d || d.kind !== 'fizege-progress') return { ok: false, why: 'Файл не от этого сайта.' };
    if (!d.cards || typeof d.cards !== 'object') return { ok: false, why: 'В файле нет карточек.' };
    write(K.cards, d.cards);
    if (d.set && typeof d.set === 'object') write(K.set, d.set);
    if (d.log && typeof d.log === 'object') write(K.log, d.log);
    if (d.quiz && typeof d.quiz === 'object') write(K.quiz, d.quiz);
    return { ok: true, n: Object.keys(d.cards).length };
  }

  function clearAll() {
    var ok = true;
    for (var k in K) { if (!put(K[k], 'null')) ok = false; }
    try { for (var n in K) localStorage.removeItem(K[n]); } catch (e) { /* и так пусто */ }
    mem = {};
    return ok;
  }

  // Работает ли настоящее хранилище. Если нет — предупредим, что прогресс не сохранится.
  function alive() {
    try {
      localStorage.setItem(P + 'test', '1');
      localStorage.removeItem(P + 'test');
      return true;
    } catch (e) { return false; }
  }

  root.Store = {
    KEYS: K, SET_DEF: SET_DEF,
    cards: cards, saveCard: saveCard, saveCards: saveCards,
    settings: settings, setSettings: setSettings,
    log: log, addDone: addDone, doneToday: doneToday, streak: streak,
    quiz: quiz, saveQuiz: saveQuiz,
    exportText: exportText, importText: importText, clearAll: clearAll, alive: alive,
  };

})(typeof window !== 'undefined' ? window : globalThis);
