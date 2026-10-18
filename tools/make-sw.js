// Вписывает в site/sw.js версию кэша и список файлов оболочки.
//
// Зачем: если версию не менять, у человека навсегда останется старый index.html —
// это самая частая боль сайтов на GitHub Pages. Версия считается от содержимого файлов,
// поэтому меняется сама и ровно тогда, когда что-то действительно изменилось.
//
// Запуск: node tools/make-sw.js   (последним шагом сборки)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.dirname(__dirname);
const SITE = path.join(ROOT, 'site');
const SW = path.join(SITE, 'sw.js');

// Что класть в кэш сразу при установке. Данные тем и шрифты KaTeX сюда НЕ входят:
// они попадают в кэш по мере использования, чтобы первая загрузка была лёгкой.
const SHELL = [
  './', './index.html', './spravochnik.html',
  './css/style.css',
  './manifest.webmanifest', './assets/icon.svg', './assets/icon-192.png',
  './js/srs.js', './js/store.js', './js/quizgen.js', './js/data.js', './js/render.js', './js/app.js',
  './data/topics.js', './data/index.js',
];

function findVendorCss() {
  const v = fs.readdirSync(path.join(SITE, 'vendor')).filter(f => /^katex-.*\.css$/.test(f));
  return v.map(f => './vendor/' + f);
}

function hashOf(files) {
  const h = crypto.createHash('sha1');
  for (const rel of files) {
    const p = path.join(SITE, rel.replace(/^\.\//, ''));
    if (rel === './' || !fs.existsSync(p)) continue;
    h.update(rel);
    h.update(fs.readFileSync(p));
  }
  // данные тоже влияют на версию: поправил формулу — обновилось у всех
  const data = path.join(SITE, 'data');
  for (const f of fs.readdirSync(data).sort()) h.update(fs.readFileSync(path.join(data, f)));
  return h.digest('hex').slice(0, 8);
}

function main() {
  const shell = SHELL.slice(0, 4).concat(findVendorCss(), SHELL.slice(4));
  const missing = shell.filter(r => r !== './' && !fs.existsSync(path.join(SITE, r.replace(/^\.\//, ''))));
  if (missing.length) {
    console.log('  ОШИБКА в оболочке нет файлов: ' + missing.join(', '));
    process.exitCode = 1;
    return;
  }

  const v = 'fiz-' + hashOf(shell);
  let src = fs.readFileSync(SW, 'utf8');
  const was = (src.match(/const V = '([^']+)'/) || [])[1];

  src = src.replace(/const V = '[^']*';\s*\/\* make-sw: version \*\//,
    `const V = '${v}';                                  /* make-sw: version */`);
  src = src.replace(/const SHELL = \[[\s\S]*?\];\s*/,
    'const SHELL = [                                          /* make-sw: shell */\n'
    + shell.map(s => `  '${s}',`).join('\n') + '\n];\n\n');

  fs.writeFileSync(SW, src, 'utf8');
  console.log(`  ok   sw.js: версия ${was === v ? v + ' (ничего не менялось)' : was + ' → ' + v}, файлов в оболочке ${shell.length}`);
}

main();
