// Одна команда сборки: node tools/build.js
//
// Делает по порядку:
//   1) рисует формулы KaTeX в data/tex-*.js и собирает короткий список data/index.js;
//   2) собирает шпаргалку spravochnik.html и список тем в index.html;
//   3) вписывает в sw.js новую версию кэша;
//   4) прогоняет быстрые проверки (tests/unit.js).
//
// Запускай после ЛЮБОЙ правки данных. Если забудешь — проверка «tex» поймает.

const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = path.dirname(__dirname);
const steps = [
  ['Рисую формулы', 'tools/render-formulas.js'],
  ['Собираю шпаргалку', 'tools/prerender.js'],
  ['Обновляю оффлайн', 'tools/make-sw.js'],
  ['Проверяю', 'tests/unit.js'],
];

let bad = 0;
for (const [title, file] of steps) {
  console.log('\n— ' + title + ' (' + file + ')');
  try {
    execFileSync(process.execPath, [path.join(ROOT, file)], { cwd: ROOT, stdio: 'inherit' });
  } catch (e) {
    bad++;
    console.log('  ОШИБКА шаг не прошёл: ' + file);
    break;     // дальше идти нет смысла: следующие шаги работают с тем, что сделал этот
  }
}

console.log('\nСБОРКА: ' + (bad ? 'остановлена на ошибке' : 'готово'));
process.exitCode = bad ? 1 : 0;
