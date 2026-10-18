// Быстрые проверки без браузера: данные, коды кодификатора, движок повторения, все квизы.
// Браузерные проверки (вид, телефон, оффлайн) живут отдельно, в tests/check.py.
//
// Запуск из папки fizika_ege:   node tests/unit.js
//                               node tests/unit.js data srs quiz   (выборочно)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.dirname(__dirname);
const SITE = path.join(ROOT, 'site');
const FAIL = [];
let OK = 0;

function log(...a) { console.log(...a); }
function check(ok, msg) {
  if (ok) { OK++; log('  ok   ' + msg); } else { FAIL.push(msg); log('  ОШИБКА ' + msg); }
}

/* ---------- общий «браузер» для файлов сайта ---------- */

const W = {};
W.window = W;
W.globalThis = W;
vm.createContext(W);

function load(rel) {
  const file = path.join(SITE, rel);
  vm.runInContext(fs.readFileSync(file, 'utf8'), W, { filename: file });
}

load('js/srs.js');
load('js/quizgen.js');
load('data/topics.js');
load('data/elementy.js');

// все темы, для которых уже написаны данные
const TOPIC_FILES = fs.readdirSync(path.join(SITE, 'data'))
  .filter(f => /^t-.+\.js$/.test(f)).map(f => f.replace(/^t-|\.js$/g, ''));

const CARDS = [];
const TEX = { d: {}, i: {} };
for (const t of TOPIC_FILES) {
  load('data/t-' + t + '.js');
  const key = 'T_' + t.toUpperCase().replace(/-/g, '_');
  // тема не дублируется в каждой карточке — она берётся из имени файла
  for (const c of W[key] || []) { if (!c.topic) c.topic = t; CARDS.push(c); }
  const texFile = path.join(SITE, 'data', 'tex-' + t + '.js');
  if (fs.existsSync(texFile)) {
    load('data/tex-' + t + '.js');
    const tk = W['TEX_' + t.toUpperCase().replace(/-/g, '_')] || { d: {}, i: {} };
    Object.assign(TEX.d, tk.d); Object.assign(TEX.i, tk.i);
  }
}

const MANUAL = [];
for (const f of fs.readdirSync(path.join(SITE, 'data')).filter(f => /^quiz-.+\.js$/.test(f))) {
  load('data/' + f);
  const key = 'QUIZ_' + f.replace(/^quiz-|\.js$/g, '').toUpperCase().replace(/-/g, '_');
  for (const q of W[key] || []) MANUAL.push(q);
}

const S = W.SRS, Q = W.Quiz;
const byId = {};
for (const c of CARDS) byId[c.id] = c;

/* ---------- 1. Целостность данных ---------- */

function data() {
  log(`\n== данные: ${CARDS.length} карточек в ${TOPIC_FILES.length} темах, ручных вопросов ${MANUAL.length}`);

  const ids = {}, dup = [];
  for (const c of CARDS) { if (ids[c.id]) dup.push(c.id); ids[c.id] = true; }
  check(!dup.length, 'все id уникальны' + (dup.length ? ': повторы ' + dup.join(', ') : ''));

  const need = ['id', 'code', 'level', 'must', 'title', 'short', 'read', 'tasks', 'linked'];
  const miss = [];
  for (const c of CARDS) for (const f of need) {
    const v = c[f];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) miss.push(c.id + '.' + f);
  }
  check(!miss.length, 'обязательные поля заполнены' + (miss.length ? ': нет ' + miss.slice(0, 6).join(', ') : ''));

  const noTex = CARDS.filter(c => c.kind !== 'opred' && !c.tex).map(c => c.id);
  check(!noTex.length, 'у каждой формулы есть запись tex' + (noTex.length ? ': нет у ' + noTex.join(', ') : ''));

  const noLaw = CARDS.filter(c => c.kind === 'opred' && !c.law).map(c => c.id);
  check(!noLaw.length, 'у каждого определения есть формулировка law' + (noLaw.length ? ': нет у ' + noLaw.join(', ') : ''));

  // Ссылка на формулу из ещё не написанной темы — это задел, а не ошибка.
  // Отличаем по приставке ключа (поле pre в topics.js): если приставка чужая — это опечатка.
  const future = {};
  for (const t of W.TOPICS) if (!TOPIC_FILES.includes(t.id)) future[t.pre] = t.title;
  const badLink = [], waitLink = [];
  for (const c of CARDS) for (const l of c.linked || []) {
    if (byId[l]) continue;
    const pre = String(l).split('-')[0];
    if (future[pre]) waitLink.push(l + ' (' + future[pre] + ')');
    else badLink.push(c.id + ' → ' + l);
  }
  check(!badLink.length, 'связанные формулы существуют' + (badLink.length ? ': битые ' + badLink.slice(0, 5).join(', ') : ''));
  if (waitLink.length) {
    log(`       ждут своих тем: ${[...new Set(waitLink)].join(', ')}`);
  }

  const badTask = [];
  for (const c of CARDS) for (const t of c.tasks || []) if (!(Number.isInteger(t) && t >= 1 && t <= 26)) badTask.push(c.id + ':' + t);
  check(!badTask.length, 'номера заданий ЕГЭ в диапазоне 1…26' + (badTask.length ? ': ' + badTask.join(', ') : ''));

  const badVar = [];
  for (const c of CARDS) for (const v of c.vars || []) {
    if (!v.s || !v.tex || !v.name) badVar.push(c.id + ': буква без s/tex/name');
    else if (!v.unit && !v.unitless) badVar.push(c.id + '.' + v.s + ': нет unit и не помечена unitless');
  }
  check(!badVar.length, 'у каждой буквы есть название и единица' + (badVar.length ? ': ' + badVar.slice(0, 5).join('; ') : ''));

  const formulas = CARDS.filter(c => c.kind !== 'opred');
  const noVars = formulas.filter(c => !(c.vars || []).length).map(c => c.id);
  check(!noVars.length, 'у каждой формулы разобраны буквы' + (noVars.length ? ': нет у ' + noVars.join(', ') : ''));

  const badMust = CARDS.filter(c => ![1, 2, 3].includes(c.must)).map(c => c.id);
  check(!badMust.length, 'must равен 1, 2 или 3' + (badMust.length ? ': ' + badMust.join(', ') : ''));

  // powers должны ссылаться на существующие буквы
  const badPow = [];
  for (const c of CARDS) for (const res in c.powers || {}) {
    const keys = [res].concat(Object.keys(c.powers[res]));
    for (const k of keys) if (!(c.vars || []).some(v => v.s === k)) badPow.push(c.id + '.powers: нет буквы ' + k);
  }
  check(!badPow.length, 'powers ссылаются на существующие буквы' + (badPow.length ? ': ' + badPow.join('; ') : ''));

  // у формул с «+» в записи не должно быть powers: «удвоить» там считается неверно
  const plusPow = CARDS.filter(c => c.powers && c.tex && /(?:^|[^\\])[+-]/.test(c.tex.replace(/\\[a-zA-Z]+/g, '')))
    .map(c => c.id);
  check(!plusPow.length, 'у формул со сложением нет powers' + (plusPow.length ? ': ' + plusPow.join(', ') : ''));
}

/* ---------- 2. Коды кодификатора ---------- */

function kodif() {
  const E = W.ELEMENTY;
  log(`\n== кодификатор: ${E.elements.length} элементов, ${Object.keys(E.topics).length} тем`);

  const el = {};
  for (const e of E.elements) el[e.code] = e;

  const ghost = CARDS.filter(c => !el[c.code]).map(c => c.id + ' (код ' + c.code + ')');
  check(!ghost.length, 'каждый код есть в кодификаторе ФИПИ' + (ghost.length ? ': выдуманные ' + ghost.join(', ') : ''));

  const topById = {};
  for (const t of W.TOPICS) topById[t.id] = t;
  const wrongTopic = CARDS.filter(c => {
    const t = topById[c.topic];
    return !t || c.code.indexOf(t.code + '.') !== 0;
  }).map(c => c.id + ' (' + c.code + ' в теме ' + c.topic + ')');
  check(!wrongTopic.length, 'код элемента принадлежит своей теме' + (wrongTopic.length ? ': ' + wrongTopic.join(', ') : ''));

  const wrongLevel = CARDS.filter(c => el[c.code] && el[c.code].level !== c.level)
    .map(c => c.id + ': у нас ' + c.level + ', в кодификаторе ' + el[c.code].level);
  check(!wrongLevel.length, 'уровень БУ/УУ совпадает с кодификатором' + (wrongLevel.length ? ': ' + wrongLevel.join('; ') : ''));

  const topicCodes = new Set(W.TOPICS.map(t => t.code));
  const missTopic = Object.keys(E.topics).filter(c => !topicCodes.has(c));
  check(!missTopic.length, 'все 16 тем кодификатора есть в topics.js' + (missTopic.length ? ': нет ' + missTopic.join(', ') : ''));

  // что ещё не покрыто — это не ошибка, а список дел
  const done = new Set(CARDS.map(c => c.code));
  for (const t of W.TOPICS) {
    const mine = E.elements.filter(e => e.topic === t.code);
    if (!TOPIC_FILES.includes(t.id)) continue;
    const left = mine.filter(e => !done.has(e.code));
    log(`       ${t.code} ${t.title}: покрыто ${mine.length - left.length} из ${mine.length}` +
      (left.length ? ', осталось ' + left.map(e => e.code).join(', ') : ' — вся тема'));
  }
}

/* ---------- 3. Формулы нарисованы ---------- */

function tex() {
  log(`\n== формулы: ${Object.keys(TEX.d).length} крупных и ${Object.keys(TEX.i).length} строчных нарисовано`);

  const missD = [], missI = [];
  for (const c of CARDS) {
    if (c.tex && !TEX.d[c.tex]) missD.push(c.id);
    for (const t of c.traps || []) if (t.tex && !TEX.d[t.tex]) missD.push(c.id + ' (ловушка)');
    for (const v of c.vars || []) if (v.tex && !TEX.i[v.tex]) missI.push(c.id + '.' + v.s);
  }
  check(!missD.length, 'все крупные формулы нарисованы' + (missD.length ? ': забыт пререндер у ' + missD.slice(0, 5).join(', ') + ' — запусти node tools/render-formulas.js' : ''));
  check(!missI.length, 'все буквы нарисованы' + (missI.length ? ': нет ' + missI.slice(0, 5).join(', ') : ''));

  // вставки $...$ во всех текстах тоже должны быть нарисованы
  const missInline = [];
  const seek = (v, key) => {
    if (typeof v === 'string') {
      if (key === 'tex') return;
      const m = v.match(/\$([^$]+)\$/g) || [];
      for (const one of m) { const t = one.slice(1, -1); if (!TEX.i[t]) missInline.push(t); }
      return;
    }
    if (Array.isArray(v)) { v.forEach(x => seek(x, key)); return; }
    if (v && typeof v === 'object') for (const k of Object.keys(v)) seek(v[k], k);
  };
  CARDS.forEach(c => seek(c, null));
  check(!missInline.length, 'вставки $…$ в текстах нарисованы' + (missInline.length ? ': нет ' + [...new Set(missInline)].slice(0, 5).join(', ') : ''));

  const err = [];
  for (const k in TEX.d) if (/katex-error/.test(TEX.d[k])) err.push(k);
  for (const k in TEX.i) if (/katex-error/.test(TEX.i[k])) err.push(k);
  check(!err.length, 'KaTeX нигде не выдал ошибку' + (err.length ? ': ' + err.slice(0, 3).join(', ') : ''));

  // кириллица в формуле допустима только внутри \text{...}
  const cyr = CARDS.filter(c => {
    if (!c.tex) return false;
    const без = c.tex.replace(/\\text\{[^}]*\}/g, '').replace(/\\mathrm\{[^}]*\}/g, '');
    return /[а-яёА-ЯЁ]/.test(без);
  }).map(c => c.id);
  check(!cyr.length, 'кириллица в формулах только внутри \\text{}' + (cyr.length ? ': ' + cyr.join(', ') : ''));
}

/* ---------- 4. Движок повторения ---------- */

function srs() {
  log('\n== движок повторения');
  const exam = { examDate: '2027-05-28' };
  const step = (c, g, day, o) => S.next(c, g, day, o || exam);

  // А. новая формула, всё время «Знаю»
  let r = step(null, 'know', '2026-10-18');
  check(r.again === true && r.card.st === 'learn', 'новая карточка после «Знаю» показывается ещё раз в этом заходе');
  r = step(r.card, 'know', '2026-10-18');
  check(r.again === false && r.card.iv === 1 && r.card.st === 'review', 'после второго «Знаю» карточка выпускается с интервалом 1 день');
  r = step(r.card, 'know', '2026-10-19');
  check(r.card.iv === 3, 'второй интервал — 3 дня (вышло ' + r.card.iv + ')');
  r = step(r.card, 'know', '2026-10-22');
  check(r.card.iv === 8, 'третий интервал — 8 дней: 3 × 2,7 с разбросом (вышло ' + r.card.iv + ')');
  check(Math.abs(r.card.ef - 2.8) < 1e-9, 'легкость доросла до предела 2,8 (вышло ' + r.card.ef.toFixed(2) + ')');

  // Б. «Не помню» после долгой разлуки: прогресс теряется не полностью
  const old = { iv: 22, ef: 2.5, n: 4, due: '2026-11-21', last: '2026-10-30', lapses: 0, seen: 6, st: 'review', step: 0 };
  r = step(old, 'again', '2026-12-21');
  check(r.card.iv === 1 && r.card.st === 'relearn' && r.again === true, '«Не помню» возвращает карточку на завтра и в этот же заход');
  check(Math.abs(r.card.ef - 2.3) < 1e-9, 'легкость упала на 0,20 (вышло ' + r.card.ef.toFixed(2) + ')');
  check(r.card.back === 7, 'запомнили, что надо вернуть 30% прежнего интервала: 7 дней (вышло ' + r.card.back + ')');
  check(r.card.lapses === 1, 'забывание посчитано');
  let g = step(step(r.card, 'know', '2026-12-21').card, 'know', '2026-12-21');
  check(g.card.iv === 7, 'после переучивания интервал 7 дней, а не 1 (вышло ' + g.card.iv + ')');
  let g2 = step(g.card, 'know', '2026-12-28');
  check(g2.card.iv > g.card.iv, 'дальше интервал растёт, а не падает (' + g.card.iv + ' → ' + g2.card.iv + ')');

  // В. просрочку не наказываем
  const a1 = step({ iv: 10, ef: 2.5, n: 4, last: '2026-10-18', due: '2026-10-28', st: 'review', step: 0, lapses: 0, seen: 4 }, 'know', '2026-10-28');
  const a2 = step({ iv: 10, ef: 2.5, n: 4, last: '2026-10-18', due: '2026-10-28', st: 'review', step: 0, lapses: 0, seen: 4 }, 'know', '2026-11-12');
  check(Math.abs(a1.card.ef - a2.card.ef) < 1e-9, 'за опоздание легкость не снижается');
  check(a2.card.iv > a1.card.iv, 'поздний успех даёт больший интервал (' + a1.card.iv + ' → ' + a2.card.iv + ')');
  check(a2.card.iv <= Math.round(10 * 1.5 * 2.6) + 3, 'поздний успех не разгоняется без предела (вышло ' + a2.card.iv + ')');

  // Г. потолок из-за близкого экзамена
  const near = step({ iv: 20, ef: 2.8, n: 5, last: '2027-04-08', due: '2027-04-28', st: 'review', step: 0, lapses: 0, seen: 8 }, 'know', '2027-04-28');
  check(near.card.iv === 12, 'за 30 дней до ЕГЭ интервал обрезан до 12 дней (вышло ' + near.card.iv + ')');
  const fin = step({ iv: 20, ef: 2.8, n: 5, last: '2027-05-03', due: '2027-05-23', st: 'review', step: 0, lapses: 0, seen: 8 }, 'know', '2027-05-23');
  check(fin.card.iv === 1, 'в последнюю неделю всё повторяется каждый день (вышло ' + fin.card.iv + ')');

  // Д. свойства, которые должны держаться всегда
  let bad = [];
  let c = S.blank(); c.id = 'f1';
  const grades = ['know', 'know', 'hard', 'know', 'again', 'know', 'know', 'hard', 'know', 'know', 'know', 'know'];
  let day = '2026-10-18';
  for (let i = 0; i < 400; i++) {
    const gr = grades[i % grades.length];
    const res = step(c, gr, day); c = res.card;
    if (c.ef < S.DEF.efMin - 1e-9 || c.ef > S.DEF.efMax + 1e-9) bad.push('ef вышла за границы: ' + c.ef);
    if (!(c.iv >= 1)) bad.push('интервал меньше суток: ' + c.iv);
    if (S.days(day, c.due) < 1) bad.push('следующий показ не в будущем: ' + c.due);
    // пока экзамен не прошёл, показ не должен назначаться после него
    if (S.days(day, '2027-05-28') > 0 && S.days(c.due, '2027-05-28') < 0) {
      bad.push('показ назначен после ЕГЭ: ' + c.due);
    }
    day = res.again ? day : c.due;
  }
  check(!bad.length, '400 ответов подряд: легкость, интервал и дата остаются разумными' + (bad.length ? ': ' + bad[0] : ''));

  // Е. битые данные не ломают движок
  let crash = null;
  for (const b of [null, undefined, {}, 'строка', [], { iv: 'ой', ef: NaN, st: 'чепуха', due: 5 }]) {
    try { const x = S.next(b, 'know', '2026-10-18', exam); if (!(x.card.iv >= 1)) crash = 'странный интервал'; }
    catch (e) { crash = e.message; }
  }
  check(!crash, 'битая карточка из хранилища не роняет движок' + (crash ? ': ' + crash : ''));

  // Ж. разброс разводит карточки по разным дням
  const dayset = {};
  for (let i = 0; i < 40; i++) {
    const cc = { id: 'card' + i, iv: 20, ef: 2.5, n: 4, last: '2026-10-18', due: '2026-11-07', st: 'review', step: 0, lapses: 0, seen: 5 };
    dayset[step(cc, 'know', '2026-11-07').card.due] = true;
  }
  check(Object.keys(dayset).length >= 3, 'одинаковые карточки расходятся по разным дням (вышло дней: ' + Object.keys(dayset).length + ')');

  // З. очередь на день
  const ids = CARDS.map(c => ({ id: c.id, must: c.must }));
  const state = {};
  ids.forEach((it, i) => {
    if (i % 2) state[it.id] = { iv: 5, ef: 2.5, n: 3, due: S.addDays('2026-10-18', -(i % 9)), last: '2026-10-05', lapses: 0, seen: 3, st: 'review', step: 0 };
  });
  const q = S.queue(ids, state, '2026-10-18', Object.assign({ newPerDay: 8, maxPerDay: 40 }, exam));
  check(q.list.length <= 40, 'в день не больше maxPerDay карточек (вышло ' + q.list.length + ')');
  check(q.fresh <= 8, 'новых не больше newPerDay (вышло ' + q.fresh + ')');
  check(new Set(q.list).size === q.list.length, 'в очереди нет повторов');
  const q0 = S.queue(ids, state, '2027-05-25', Object.assign({ newPerDay: 8, maxPerDay: 40 }, exam));
  check(q0.fresh === 0, 'за 3 дня до ЕГЭ новые карточки не даются');
  const big = {};
  ids.forEach((it, i) => { big[it.id] = { iv: 3, ef: 2.5, n: 3, due: '2026-09-01', last: '2026-08-29', lapses: 0, seen: 3, st: 'review', step: 0 }; });
  const qb = S.queue(ids, big, '2026-10-18', Object.assign({ newPerDay: 8, maxPerDay: 10 }, exam));
  check(qb.list.length === 10 && qb.skippedDue === ids.length - 10, 'завал режется и остаток посчитан (' + qb.skippedDue + ' отложено)');
}

/* ---------- 5. Квизы ---------- */

function quiz() {
  const all = Q.build(CARDS, MANUAL);
  const byKind = {};
  for (const q of all) byKind[q.src] = (byKind[q.src] || 0) + 1;
  log(`\n== квизы: собрано ${all.length} вопросов`);
  for (const k of Object.keys(byKind).sort()) log(`       ${k}: ${byKind[k]}`);

  const bad = [];
  for (const q of all) {
    const p = Q.audit(q);
    if (p.length) bad.push(q.id + ': ' + p.join('; '));
  }
  check(!bad.length, 'у каждого вопроса ровно один верный ответ и нет повторов' +
    (bad.length ? ' — плохих ' + bad.length + ': ' + bad.slice(0, 4).join(' | ') : ''));

  const ids = {}, dup = [];
  for (const q of all) { if (ids[q.id]) dup.push(q.id); ids[q.id] = true; }
  check(!dup.length, 'id вопросов уникальны' + (dup.length ? ': ' + dup.slice(0, 4).join(', ') : ''));

  const ghost = all.filter(q => q.fid && !byId[q.fid]).map(q => q.id);
  check(!ghost.length, 'каждый вопрос привязан к существующей формуле' + (ghost.length ? ': ' + ghost.slice(0, 4).join(', ') : ''));

  // главная проверка: ответ на вопрос «что станет, если удвоить» считаем сами, независимо
  const powQ = all.filter(q => q.src === 'auto:powers');
  const wrong = [];
  for (const q of powQ) {
    const m = q.id.match(/^(.+)~pow~(.+)~(.+)$/);
    const card = byId[m[1]];
    const p = card.powers[m[2]][m[3]];
    const f = Math.pow(2, Math.abs(p));
    const want = p === 0 ? 'не изменится' : (p > 0 ? 'увеличится в ' : 'уменьшится в ') + Q.times(f);
    const got = (q.opts.find(o => o.ok) || {}).t;
    if (got !== want) wrong.push(q.id + ': ждали «' + want + '», а в вопросе «' + got + '»');
  }
  check(!wrong.length, `ответы ${powQ.length} вопросов про степени сошлись с независимым расчётом` +
    (wrong.length ? ': ' + wrong.slice(0, 3).join('; ') : ''));

  // ловушки не должны случайно совпасть с верной записью
  const clash = [];
  for (const c of CARDS) for (const t of c.traps || []) if (t.tex === c.tex) clash.push(c.id);
  check(!clash.length, 'ни одна ловушка не совпадает с верной формулой' + (clash.length ? ': ' + clash.join(', ') : ''));

  // единицы-ловушки не значат то же самое, что верный ответ
  const same = [];
  for (const q of all.filter(x => x.src === 'auto:unit')) {
    const right = q.opts.find(o => o.ok).t;
    const group = Q.SAME.find(g => g.indexOf(right) >= 0) || [right];
    for (const o of q.opts) if (!o.ok && group.indexOf(o.t) >= 0) same.push(q.id + ': ' + o.t + ' = ' + right);
  }
  check(!same.length, 'среди неверных единиц нет равнозначных верной' + (same.length ? ': ' + same.join('; ') : ''));

  // на каждую формулу должно быть чем спросить
  const per = {};
  for (const q of all) if (q.fid) per[q.fid] = (per[q.fid] || 0) + 1;
  const thin = CARDS.filter(c => (per[c.id] || 0) < 3).map(c => c.id + ' (' + (per[c.id] || 0) + ')');
  check(!thin.length, 'на каждую карточку не меньше 3 вопросов' + (thin.length ? ': мало у ' + thin.join(', ') : ''));

  // набор на один заход
  const ten = Q.pick(all, 'kinematika', 10, 1);
  check(ten.length === 10, 'в заход набирается ровно 10 вопросов (вышло ' + ten.length + ')');
  check(new Set(ten.map(q => q.id)).size === ten.length, 'в заходе нет одинаковых вопросов');
  const sameTwice = Q.pick(all, 'kinematika', 10, 1).map(q => q.id).join() === ten.map(q => q.id).join();
  check(sameTwice, 'от одного ключа набор получается один и тот же (значит, тест предсказуем)');
  const other = Q.pick(all, 'kinematika', 10, 2).map(q => q.id).join();
  check(other !== ten.map(q => q.id).join(), 'от другого ключа набор другой');

  // все формулы в вариантах ответов должны быть нарисованы
  const noTex = [];
  for (const q of all) {
    if (q.askTex && !TEX.i[q.askTex] && !TEX.d[q.askTex]) noTex.push(q.id + ' (вопрос)');
    for (const o of q.opts || []) if (o.tex && !TEX.d[o.tex]) noTex.push(q.id + ' (вариант)');
  }
  check(!noTex.length, 'все формулы в вопросах нарисованы' + (noTex.length ? ': ' + noTex.slice(0, 4).join(', ') : ''));
}

/* ---------- запуск ---------- */

const ALL = { data, kodif, tex, srs, quiz };
const parts = process.argv.slice(2).filter(a => ALL[a]);
for (const name of (parts.length ? parts : Object.keys(ALL))) ALL[name]();

log(`\nИТОГ: ${FAIL.length ? FAIL.length + ' ошибок из ' + (OK + FAIL.length) + ' проверок' : 'всё зелёное, проверок ' + OK}`);
process.exitCode = FAIL.length ? 1 : 0;
