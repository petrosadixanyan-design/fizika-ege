// Рисует формулы: берёт LaTeX из site/data/t-*.js и кладёт готовый HTML в site/data/tex-*.js.
// KaTeX работает ТОЛЬКО здесь, в браузер библиотека не попадает — туда едет уже готовый HTML.
//
// Запуск:  node tools/render-formulas.js            (все темы)
//          node tools/render-formulas.js kinematika (одна тема)
//          node tools/render-formulas.js --smoke     (быстрая проверка, что KaTeX жив)
//
// ВАЖНО: после правки любого поля с формулой запусти это заново, иначе на сайте
// останется старая картинка. Проверка tests/check.py (часть tex) на это и ругается.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const katex = require(path.join(__dirname, 'katex.min.js'));

const ROOT = path.dirname(__dirname);
const DATA = path.join(ROOT, 'site', 'data');

// Настройки KaTeX. throwOnError: падаем сразу на опечатке, лучше здесь, чем у ученика.
const OPT_D = { displayMode: true, throwOnError: true, strict: false, output: 'html' };
const OPT_I = { displayMode: false, throwOnError: true, strict: false, output: 'html' };

// Из текстовых полей вытаскиваем встроенную математику вида $\upsilon_x$
const INLINE = /\$([^$]+)\$/g;
// Поля, которые сами целиком являются формулой, — их не надо искать по $...$
const TEX_FIELDS = new Set(['tex', 'also']);

function log(...a) { console.log(...a); }

// Загружает файл данных (window.X = [...]) и возвращает всё, что он объявил.
function loadData(file) {
  const sandbox = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  delete sandbox.window;
  return sandbox;
}

// Собирает все строки LaTeX темы: отдельно «крупные» (d) и «строчные» (i).
// Крупные — главная формула карточки и ловушки квиза.
// Строчные — буквы из vars, подписи осей графика и вставки $...$ в любом тексте,
// в том числе вложенном (memo.text, example.q, traps[].why).
function collect(cards) {
  const d = new Set(), i = new Set();

  // обходим карточку целиком и выбираем из каждой строки вставки $...$
  function walk(v, key) {
    if (typeof v === 'string') {
      if (TEX_FIELDS.has(key)) return;            // это уже формула, не текст
      let m; INLINE.lastIndex = 0;
      while ((m = INLINE.exec(v))) i.add(m[1]);
      return;
    }
    if (Array.isArray(v)) { for (const x of v) walk(x, key); return; }
    if (v && typeof v === 'object') { for (const k of Object.keys(v)) walk(v[k], k); }
  }

  for (const c of cards) {
    if (c.tex) d.add(c.tex);
    for (const t of c.traps || []) if (t.tex) d.add(t.tex);
    for (const t of c.also || []) d.add(t);
    for (const v of c.vars || []) if (v.tex) i.add(v.tex);
    if (c.plot) { if (c.plot.y) i.add(c.plot.y); if (c.plot.x) i.add(c.plot.x); }
    walk(c, null);
  }
  return { d, i };
}

// Рисует набор строк. Возвращает объект {latex: html} и список шрифтов, которые понадобились.
function render(set, opt, where, fonts) {
  const out = {};
  for (const tex of set) {
    let html;
    try {
      html = katex.renderToString(tex, opt);
    } catch (e) {
      console.error(`\nОШИБКА в формуле (${where}):\n  ${tex}\n  ${e.message}\n`);
      process.exitCode = 1;
      continue;
    }
    // Какие семейства шрифтов KaTeX реально использовал — чтобы не тащить лишние файлы
    for (const m of html.matchAll(/class="[^"]*\b(mathnormal|mathbf|mathit|mathrm|mathbb|mathcal|mathscr|mathfrak|mathsf|mathtt|amsrm|delimsizing size[1-4]|sizing)\b/g)) {
      fonts.add(m[1]);
    }
    out[tex] = html;
  }
  return out;
}

function smoke() {
  const tests = [
    ['Координата при равноускоренном движении', 'x(t)=x_0+\\upsilon_{0x}t+\\dfrac{a_x t^2}{2}'],
    ['Период пружинного маятника', 'T=2\\pi\\sqrt{\\dfrac{m}{k}}'],
    ['Уравнение Менделеева — Клапейрона', 'pV=\\dfrac{m}{M}RT'],
    ['Второй закон Ньютона', '\\vec{F}=m\\vec{a}'],
    ['Формула тонкой линзы', '\\dfrac{1}{d}+\\dfrac{1}{f}=\\dfrac{1}{F}'],
    ['Ядро тория', '{}^{234}_{90}\\mathrm{Th}\\rightarrow{}^{234}_{91}\\mathrm{Pa}+{}^{\\;\\,0}_{-1}e'],
    ['Закон преломления', 'n_1\\sin\\alpha=n_2\\sin\\beta'],
    ['Средняя кинетическая энергия', '\\langle E_{\\text{к}}\\rangle=\\dfrac{3}{2}kT'],
    ['Магнитный поток', '\\Phi=BS\\cos\\alpha'],
    ['Фотоэффект', 'h\\nu=A_{\\text{вых}}+\\dfrac{m\\upsilon^2}{2}'],
  ];
  log(`KaTeX ${katex.version}: проверяю ${tests.length} формул`);
  const fonts = new Set();
  let bad = 0;
  for (const [name, tex] of tests) {
    try {
      const h = katex.renderToString(tex, OPT_D);
      for (const m of h.matchAll(/class="[^"]*\b(mathnormal|mathbf|mathit|mathrm|mathbb|mathcal|amsrm|sizing)\b/g)) fonts.add(m[1]);
      log(`  ok   ${name} — ${h.length} знаков HTML`);
    } catch (e) {
      log(`  ОШИБКА ${name}: ${e.message}`);
      bad++;
    }
  }
  log(`\nШрифтовые классы: ${[...fonts].sort().join(', ')}`);
  log(bad ? `ИТОГ: ${bad} ошибок` : 'ИТОГ: всё зелёное');
  process.exitCode = bad ? 1 : 0;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--smoke')) return smoke();

  let files = fs.readdirSync(DATA).filter(f => /^t-.+\.js$/.test(f));
  if (args.length) files = args.map(a => `t-${a.replace(/^t-|\.js$/g, '')}.js`);
  if (!files.length) return log('Нет файлов site/data/t-*.js — рисовать нечего.');
  const INDEX = [];

  const fonts = new Set();
  let total = 0;
  for (const f of files) {
    const file = path.join(DATA, f);
    const topic = f.replace(/^t-|\.js$/g, '');
    const declared = loadData(file);
    const cards = Object.values(declared).find(Array.isArray);
    if (!cards) { log(`  ОШИБКА ${f}: не нашёл массив карточек`); process.exitCode = 1; continue; }
    for (const c of cards) if (!c.topic) c.topic = topic;   // тема берётся из имени файла

    const { d, i } = collect(cards);
    const out = { d: render(d, OPT_D, f, fonts), i: render(i, OPT_I, f, fonts) };
    const name = 'TEX_' + topic.toUpperCase().replace(/-/g, '_');
    const head = `// Готовый HTML формул темы «${topic}». ЭТОТ ФАЙЛ ДЕЛАЕТ tools/render-formulas.js — руками не править.\n`
      + `// d — крупные формулы, i — строчные (буквы и вставки $...$ в тексте).\n`;
    fs.writeFileSync(path.join(DATA, `tex-${topic}.js`),
      head + `window.${name} = ${JSON.stringify(out, null, 0)};\n`, 'utf8');
    log(`  ok   ${f}: ${cards.length} карточек, формул ${d.size} крупных и ${i.size} строчных`);
    total += d.size + i.size;
    for (const c of cards) INDEX.push({ i: c.id, t: topic, m: c.must, c: c.code, l: c.level, n: c.title });
  }
  log(`\nВсего нарисовано ${total} формул. Шрифтовые классы: ${[...fonts].sort().join(', ') || '—'}`);

  // Облегчённый список ВСЕХ формул: по нему экран «Сегодня» собирает очередь повторений,
  // не загружая данные всех тем. Пишется только при полном прогоне.
  if (!args.length) {
    const head = '// Короткий список всех формул: i — ключ, t — тема, m — насколько обязательна,\n'
      + '// c — код кодификатора, l — уровень, n — название.\n'
      + '// ЭТОТ ФАЙЛ ДЕЛАЕТ tools/render-formulas.js — руками не править.\n';
    fs.writeFileSync(path.join(DATA, 'index.js'),
      head + `window.INDEX = ${JSON.stringify(INDEX)};\n`, 'utf8');
    log(`Список всех формул: ${INDEX.length} штук → site/data/index.js`);
  } else {
    log('Тема рисовалась выборочно, поэтому data/index.js не обновлён — прогони без имени темы.');
  }
}

main();
