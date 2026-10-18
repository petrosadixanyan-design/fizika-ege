// Показывает, какие интервалы даёт движок повторения. Это помощник для разработки:
// запусти `node tools/try-srs.js`, посмотри глазами, что числа разумные.
// Настоящая проверка с ожидаемыми числами — в tests/srs.js.

const fs = require('fs');
const path = require('path');

const root = { };
new Function('window', fs.readFileSync(path.join(__dirname, '..', 'site', 'js', 'srs.js'), 'utf8')
  .replace('typeof window !== \'undefined\' ? window : globalThis', 'window'))(root);
const S = root.SRS;

function line(...a) { console.log(...a); }

function run(name, start, answers, opt) {
  line('\n=== ' + name + ' ===');
  let c = start || S.blank();
  let day = (opt && opt.from) || '2026-10-18';
  for (const [grade, jump] of answers) {
    if (jump) day = S.addDays(day, jump);
    const r = S.next(c, grade, day, opt);
    c = r.card;
    line(`  ${day}  ${grade.padEnd(5)} → интервал ${String(c.iv).padStart(3)} д,  следующий ${c.due || '—'},  ef ${c.ef.toFixed(2)},  n=${c.n}, ${c.st}${r.again ? ', ещё раз в этом заходе' : ''}`);
    if (!r.again) day = c.due;
  }
  return c;
}

const exam = { examDate: '2027-05-28' };

run('A. Новая формула, всё время «Знаю» (до ЕГЭ 222 дня)', null,
  [['know'], ['know'], ['know'], ['know'], ['know'], ['know'], ['know']], exam);

run('B. Выучил, потом «Не помню»',
  { iv: 22, ef: 2.5, n: 4, due: '2026-11-21', last: '2026-10-30', lapses: 0, seen: 6, st: 'review', step: 0 },
  [['again', 51], ['know'], ['know'], ['know']], exam);

line('\n=== C. Поздний успех: пришёл с опозданием на 15 дней ===');
{
  const c = { iv: 10, ef: 2.5, n: 4, due: '2026-10-28', last: '2026-10-18', lapses: 0, seen: 5, st: 'review', step: 0 };
  const r = S.next(c, 'know', '2026-11-12', exam);   // прошло 25 дней вместо 10
  line(`  было 10 д → стало ${r.card.iv} д (в чистом SM-2 было бы ${Math.round(10 * 2.6)})`);
}

line('\n=== D. До ЕГЭ 30 дней: потолок ===');
{
  const c = { iv: 20, ef: 2.8, n: 5, due: '2027-04-28', last: '2027-04-08', lapses: 0, seen: 8, st: 'review', step: 0 };
  const r = S.next(c, 'know', '2027-04-28', exam);
  line(`  сырой интервал был бы ${Math.round(20 * 2.8)} д → потолок дал ${r.card.iv} д`);
}

line('\n=== E. До ЕГЭ 5 дней: финишная прямая ===');
{
  const c = { iv: 20, ef: 2.8, n: 5, due: '2027-05-23', last: '2027-05-03', lapses: 0, seen: 8, st: 'review', step: 0 };
  const r = S.next(c, 'know', '2027-05-23', exam);
  line(`  интервал ${r.card.iv} д (должен быть 1)`);
}

line('\n=== Очередь на сегодня ===');
{
  const ids = [];
  for (let i = 0; i < 60; i++) ids.push({ id: 'f' + i, must: (i % 3) + 1 });
  const state = {};
  for (let i = 0; i < 25; i++) {
    state['f' + i] = { iv: 5 + i, ef: 2.5, n: 3, due: S.addDays('2026-10-18', -(i % 12)), last: '2026-10-01', lapses: 0, seen: 4, st: 'review', step: 0 };
  }
  const q = S.queue(ids, state, '2026-10-18', exam);
  line(`  просрочено ${q.totalDue}, новых доступно ${q.totalNew}`);
  line(`  в очереди ${q.list.length}: повторений ${q.due} + новых ${q.fresh}, не влезло ${q.skippedDue}`);
  line('  порядок (п — повторение, Н — новая): ' + q.list.map(id => state[id] ? 'п' : 'Н').join(''));

  const p = S.plan(ids, state, '2026-10-18', exam);
  line(`  план: до ЕГЭ ${p.left} дней, новых осталось ${p.newLeft}, нужно по ${p.needPerDay} в день, спешка: ${p.hurry}`);
  line(`  готовность: ${S.ready(ids, state, '2026-10-18', exam.examDate)}%`);
}

line('\n=== Битые данные не должны ронять движок ===');
for (const bad of [null, undefined, {}, 'строка', { iv: 'ой', ef: NaN, st: 'чепуха' }, []]) {
  const r = S.next(bad, 'know', '2026-10-18', exam);
  line(`  ${JSON.stringify(bad)} → iv ${r.card.iv}, ef ${r.card.ef}, ${r.card.st}`);
}
