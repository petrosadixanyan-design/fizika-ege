// Собирает то, что должно работать БЕЗ JavaScript:
//   1) список тем прямо в index.html (между метками <!-- prerender:topics -->);
//   2) site/spravochnik.html — вся шпаргалка одной страницей, её же удобно печатать.
//
// Запуск: node tools/prerender.js     (после node tools/render-formulas.js)
//
// Работает так же, как tools/prerender.js в tour_site: файлы данных и js/render.js
// загружаются в песочницу vm, где window — она сама.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.dirname(__dirname);
const SITE = path.join(ROOT, 'site');
const DATA = path.join(SITE, 'data');

const W = {};
W.window = W;
W.globalThis = W;
W.document = undefined;        // в песочнице страницы нет — render.js и не должен её трогать
vm.createContext(W);

function load(rel) {
  const file = path.join(SITE, rel);
  vm.runInContext(fs.readFileSync(file, 'utf8'), W, { filename: file });
}

load('data/topics.js');
load('js/render.js');

const topicIds = fs.readdirSync(DATA).filter(f => /^t-.+\.js$/.test(f)).map(f => f.replace(/^t-|\.js$/g, ''));
const TEX = { d: {}, i: {} };
const cardsOf = {};
const byId = {};

for (const id of topicIds) {
  load('data/t-' + id + '.js');
  const arr = W['T_' + id.toUpperCase().replace(/-/g, '_')] || [];
  for (const c of arr) { if (!c.topic) c.topic = id; byId[c.id] = c; }
  cardsOf[id] = arr;
  const tf = path.join(DATA, 'tex-' + id + '.js');
  if (fs.existsSync(tf)) {
    load('data/tex-' + id + '.js');
    const t = W['TEX_' + id.toUpperCase().replace(/-/g, '_')] || { d: {}, i: {} };
    Object.assign(TEX.d, t.d); Object.assign(TEX.i, t.i);
  }
}

// Render ждёт Data для ссылок на тему и соседние формулы — подкладываем простую замену.
W.Data = {
  topic: (id) => (W.TOPICS || []).find(t => t.id === id) || null,
  card: (id) => byId[id] || null,
};
const R = W.Render;
R.use({ d: (t) => TEX.d[t], i: (t) => TEX.i[t] });

/* ---------- 1. список тем в index.html ---------- */

function topicsBlock() {
  let h = '<div class="card"><p>Это тренажёр формул ЕГЭ по физике. Карточки повторения и квизы '
    + 'работают с JavaScript, а весь справочник — <a href="spravochnik.html">на отдельной странице</a>, '
    + 'её можно распечатать как шпаргалку.</p></div>';
  for (const sec of W.SECTIONS) {
    const list = W.TOPICS.filter(t => t.section === sec.code);
    h += '<h3 class="sec-title">' + R.esc(sec.code) + '. ' + R.esc(sec.title) + '</h3>';
    for (const t of list) {
      const n = (cardsOf[t.id] || []).length;
      h += '<a class="tile" href="spravochnik.html#t-' + R.esc(t.id) + '">'
        + '<span class="head"><span class="code">' + R.esc(t.code) + '</span>'
        + '<span class="name">' + R.esc(t.title) + '</span></span>'
        + '<span class="about">' + R.esc(t.about) + '</span>'
        + '<span class="meta">' + (n ? n + ' формул и определений' : 'скоро добавим') + '</span></a>';
    }
  }
  return h;
}

function putBetween(text, name, inner) {
  const a = '<!-- prerender:' + name + ' -->';
  const b = '<!-- /prerender:' + name + ' -->';
  const i = text.indexOf(a), j = text.indexOf(b);
  if (i < 0 || j < 0) throw new Error('в index.html нет меток ' + a);
  return text.slice(0, i + a.length) + '\n' + inner + '\n' + text.slice(j);
}

const indexFile = path.join(SITE, 'index.html');
let html = fs.readFileSync(indexFile, 'utf8');
html = putBetween(html, 'topics', topicsBlock());
fs.writeFileSync(indexFile, html, 'utf8');
console.log('  ok   список тем вписан в index.html');

/* ---------- 2. шпаргалка одной страницей ---------- */

function sprav() {
  const total = Object.keys(byId).length;
  let body = '<div class="fhead"><h2>Справочник формул</h2>'
    + '<p class="muted">Все формулы и определения по кодификатору ЕГЭ по физике 2026 (ФИПИ). '
    + 'Сейчас готово тем: ' + topicIds.length + ', карточек: ' + total + '. '
    + 'Страница работает без интернета и печатается — <b>Ctrl+P</b>.</p>'
    + '<p class="noprint"><a href="./">← к тренажёру с карточками и квизами</a></p></div>';

  for (const sec of W.SECTIONS) {
    const list = W.TOPICS.filter(t => t.section === sec.code && (cardsOf[t.id] || []).length);
    if (!list.length) continue;
    body += '<h2 class="sec-title" style="font-size:1.1rem">' + R.esc(sec.code) + '. ' + R.esc(sec.title) + '</h2>';
    for (const t of list) {
      body += '<section id="t-' + R.esc(t.id) + '" style="margin-bottom:var(--sp-6)">'
        + '<h2>' + R.esc(t.code) + ' ' + R.esc(t.title) + '</h2>'
        + '<p class="muted">' + R.esc(t.about) + ' Задания ЕГЭ: ' + t.ege.join(', ') + '.</p>';
      for (const c of cardsOf[t.id]) {
        body += '<article style="margin:var(--sp-5) 0;padding-top:var(--sp-3);border-top:1px solid var(--line)">'
          + R.formula(c, { deep: true }) + '</article>';
      }
      body += '</section>';
    }
  }
  return body;
}

const page = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Справочник формул ЕГЭ по физике</title>
<meta name="description" content="Все формулы ЕГЭ по физике из кодификатора ФИПИ 2026: запись, разбор каждой буквы, единицы, когда формула не работает, как запомнить. Одной страницей, можно распечатать.">
<meta name="theme-color" content="#fbfaf8" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#111317" media="(prefers-color-scheme: dark)">
<link rel="icon" href="assets/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="vendor/katex-0.19.0.min.css">
<link rel="stylesheet" href="css/style.css">
</head>
<body>
<!-- ЭТУ СТРАНИЦУ ДЕЛАЕТ tools/prerender.js — руками не править. -->
<a class="skip" href="#main">Перейти к содержимому</a>
<header class="top"><div class="wrap top-in"><h1>Справочник формул</h1></div></header>
<main id="main" class="wrap">
${sprav()}
</main>
</body>
</html>
`;

fs.writeFileSync(path.join(SITE, 'spravochnik.html'), page, 'utf8');
const kb = Math.round(Buffer.byteLength(page) / 1024);
console.log(`  ok   шпаргалка: ${Object.keys(byId).length} карточек, ${kb} КБ → site/spravochnik.html`);
