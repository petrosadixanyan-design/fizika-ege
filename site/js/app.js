// Страница: переходы между экранами, повторение, квиз, настройки.
// Вся арифметика повторения живёт в srs.js, сборка вопросов — в quizgen.js,
// сборка HTML — в render.js. Здесь только связь с экраном и событиями.

(() => {
  'use strict';

  const d = document;
  const $ = (s, r = d) => r.querySelector(s);
  const $$ = (s, r = d) => [].slice.call(r.querySelectorAll(s));
  const R = window.Render, Data = window.Data, S = window.SRS, St = window.Store, Qz = window.Quiz;

  R.use({ d: Data.d, i: Data.i });

  let set = St.settings();
  let state = St.cards();
  let ses = null;      // текущий заход повторения
  let run = null;      // текущий квиз
  let busy = false;

  const today = () => S.today();
  const opt = () => ({ examDate: set.exam, newPerDay: set.newPerDay, maxPerDay: set.maxPerDay });

  /* ---------- какие вообще есть карточки ---------- */

  // Одна формула даёт одну или две карточки: 'id:w' — по названию вспомнить формулу
  // (именно это нужно на экзамене), 'id:f' — по формуле вспомнить смысл и буквы.
  function keys() {
    const out = [];
    for (const r of Data.index()) {
      out.push({ id: r.i + ':w', fid: r.i, topic: r.t, must: r.m });
      if (set.both && r.m === 1) out.push({ id: r.i + ':f', fid: r.i, topic: r.t, must: r.m + 1 });
    }
    return out;
  }

  const fidOf = (key) => key.split(':')[0];
  const sideOf = (key) => key.split(':')[1] || 'w';

  function card(key) {
    const c = state[key] ? Object.assign({}, state[key]) : S.blank();
    c.id = key;
    return c;
  }

  function saveCard(key, c) { state[key] = c; St.saveCard(key, c); }

  /* ---------- переходы ---------- */

  const SCREENS = ['today', 'topics', 'topic', 'formula', 'session', 'quiz', 'me'];
  const TITLES = {
    today: 'Формулы ЕГЭ · Физика', topics: 'Формулы', topic: 'Тема',
    formula: 'Формула', session: 'Повторение', quiz: 'Квиз', me: 'Я',
  };
  const ROOTS = { today: '#/', topics: '#/temy', quiz: '#/kviz', me: '#/ya' };

  function show(name) {
    for (const s of SCREENS) {
      const el = $('#s-' + s);
      if (el) el.classList.toggle('on', s === name);
    }
    $('#title').textContent = TITLES[name] || TITLES.today;
    const isRoot = !!ROOTS[name];
    $('#back').classList.toggle('hide', isRoot);
    for (const a of $$('.nav a')) {
      const on = a.dataset.nav === name || (name === 'topic' || name === 'formula') && a.dataset.nav === 'topics';
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
    window.scrollTo(0, 0);
  }

  function go(hash) { location.hash = hash; }

  function wait(where, msg) {
    $(where).innerHTML = '<div class="card"><p class="muted">' + (msg || 'Загружаю…') + '</p></div>';
  }

  function route() {
    const h = (location.hash || '#/').replace(/^#/, '');
    const p = h.split('/').filter(Boolean);

    if (!p.length) return today0();
    if (p[0] === 'temy') return topicsScreen();
    if (p[0] === 't' && p[1]) return topicScreen(p[1]);
    if (p[0] === 'f' && p[1]) return formulaScreen(p[1]);
    if (p[0] === 'povtor') return sessionScreen(p[1] || '');
    if (p[0] === 'kviz') return p[1] ? quizStart(p[1]) : quizPick();
    if (p[0] === 'ya') return meScreen();
    return go('#/');     // непонятный адрес — на главную
  }

  /* ---------- экран «Сегодня» ---------- */

  function today0() {
    show('today');
    const day = today();
    const all = keys();
    const q = S.queue(all, state, day, opt());
    const pl = S.plan(all, state, day, opt());
    const ready = S.ready(all, state, day, set.exam);
    const done = St.doneToday(day);
    const streak = St.streak(day, S.addDays);
    let h = '';

    // первый запуск: спрашиваем дату ЕГЭ одним экраном
    if (!set.hello) {
      h += '<section class="card"><h2>Привет!</h2>'
        + '<p>Здесь живут все формулы ЕГЭ по физике из кодификатора ФИПИ 2026 — с разбором каждой буквы, '
        + 'квизами и умным повторением: сайт сам решает, какую формулу пора повторить, чтобы она не забылась.</p>'
        + '<p>Когда у тебя ЕГЭ? От этого зависит расписание повторений.</p>'
        + '<div class="field"><input type="date" id="exam0" value="2027-05-28" min="' + day + '"></div>'
        + '<div class="row-2"><button class="btn btn-main" id="hello-ok">Поехали</button>'
        + '<button class="btn" id="hello-skip">Пока без даты</button></div></section>';
      $('#today-body').innerHTML = h;
      return;
    }

    if (!St.alive()) {
      h += '<div class="card note mist"><span class="lab">внимание</span>'
        + 'Браузер не разрешает сохранять данные, поэтому прогресс пропадёт при закрытии страницы. '
        + 'Это бывает в режиме инкогнито.</div>';
    }

    h += '<div class="band">'
      + (pl.left !== null ? '<span>До ЕГЭ <b>' + pl.left + ' ' + R.plural(pl.left, 'день', 'дня', 'дней') + '</b></span>'
        : '<span><a href="#/ya">Поставить дату ЕГЭ</a></span>')
      + '<span>Готовность <b>' + ready + '%</b></span></div>';

    if (q.list.length) {
      const mins = Math.max(1, Math.round(q.list.length * 0.35));
      h += '<button class="btn btn-main btn-wide today-main" id="start-ses">'
        + '<span>' + (q.due ? 'Повторить ' + q.list.length + ' ' + R.plural(q.list.length, 'формулу', 'формулы', 'формул')
          : 'Выучить ' + q.list.length + ' ' + R.plural(q.list.length, 'формулу', 'формулы', 'формул')) + '</span>'
        + '<span class="sub">примерно ' + mins + ' ' + R.plural(mins, 'минута', 'минуты', 'минут')
        + (q.due && q.fresh ? ' · ' + q.due + ' на повторение и ' + q.fresh + ' новых' : '') + '</span></button>';
    } else {
      h += '<section class="card" style="text-align:center">'
        + '<p class="done big" style="font-size:2.4rem;margin:0">✓</p>'
        + '<p><b>На сегодня всё.</b></p>'
        + '<p class="muted small">' + (done ? 'Сделано карточек: ' + done + '. ' : '')
        + (pl.newLeft ? 'Новых формул впереди ещё ' + pl.newLeft + ' — можно взять их заранее.' : 'Все формулы уже в работе.') + '</p>'
        + (pl.newLeft ? '<button class="btn btn-wide" id="start-extra">Взять ещё новых</button>' : '')
        + '</section>';
    }

    if (q.skippedDue) {
      h += '<div class="card note sign"><span class="lab">накопилось</span>'
        + 'Просроченных формул больше, чем влезает в день: ещё <b>' + q.skippedDue + '</b> ждут. '
        + 'Разберём по ' + set.maxPerDay + ' в день, самые важные первыми.</div>';
    }

    if (pl.hurry) {
      h += '<div class="card note sign"><span class="lab">не успеваем</span>'
        + 'Новых формул осталось ' + pl.newLeft + ', а до ЕГЭ ' + pl.left + ' '
        + R.plural(pl.left, 'день', 'дня', 'дней') + '. Чтобы успеть, нужно по <b>' + pl.needPerDay
        + '</b> в день вместо ' + set.newPerDay + '. '
        + '<button class="btn btn-sm" id="fix-pace">Поставить ' + pl.needPerDay + '</button></div>';
    }

    const nF = Data.index().length, nT = Data.topics().filter(t => Data.indexOfTopic(t.id).length).length;
    h += '<a class="linkrow" href="#/temy"><span><span class="t">Формулы по темам</span>'
      + '<span class="n">' + nT + ' ' + R.plural(nT, 'тема', 'темы', 'тем') + ' готово, формул ' + nF
      + ', выучено ' + learnedFormulas() + '</span></span></a>';
    h += '<a class="linkrow" href="#/kviz"><span><span class="t">Квиз</span>'
      + '<span class="n">проверить себя: буквы, единицы, ловушки</span></span></a>';
    h += '<a class="linkrow" href="spravochnik.html"><span><span class="t">Шпаргалка одной страницей</span>'
      + '<span class="n">всё вместе, можно распечатать</span></span></a>';

    if (streak > 1) h += '<p class="streak">·· ' + streak + ' ' + R.plural(streak, 'день', 'дня', 'дней') + ' подряд ··</p>';
    else if (done) h += '<p class="streak">·· сегодня уже позанимался ··</p>';

    $('#today-body').innerHTML = h;
    const dot = $('#nav-dot');
    dot.textContent = q.list.length;
    dot.classList.toggle('hide', !q.list.length);
  }

  /* ---------- темы ---------- */

  // Сколько формул (а не карточек) уже сидит крепко: интервал от недели.
  function learnedFormulas() {
    let n = 0;
    for (const r of Data.index()) {
      const c = state[r.i + ':w'];
      if (c && c.st === 'review' && c.iv >= 7) n++;
    }
    return n;
  }

  function topicStat(topicId) {
    const rows = Data.indexOfTopic(topicId);
    let learned = 0;
    for (const r of rows) {
      const c = state[r.i + ':w'];
      if (c && c.st === 'review' && c.iv >= 7) learned++;
    }
    return { total: rows.length, learned: learned };
  }

  function topicsScreen() {
    show('topics');
    let h = '';
    for (const sec of Data.sections()) {
      const list = Data.topics().filter(t => t.section === sec.code);
      h += '<h3 class="sec-title"><span>' + R.esc(sec.code) + '. ' + R.esc(sec.title) + '</span>'
        + '<span class="muted" style="font-weight:600;letter-spacing:0">задания ' + R.esc(sec.ege) + '</span></h3>';
      for (const t of list) {
        const ready = Data.indexOfTopic(t.id).length;
        h += ready ? R.tile(t, topicStat(t.id))
          : '<div class="tile soon"><span class="head"><span class="code">' + R.esc(t.code)
          + '</span><span class="name">' + R.esc(t.title) + '</span></span>'
          + '<span class="about">' + R.esc(t.about) + '</span>'
          + '<span class="meta">скоро добавим</span></div>';
      }
    }
    $('#topics-body').innerHTML = h;
  }

  function topicScreen(id) {
    show('topic');
    const t = Data.topic(id);
    if (!t) return go('#/temy');
    $('#title').textContent = t.title;
    wait('#topic-body');
    Data.need([id], (err) => {
      if (err) return fail('#topic-body', err);
      const cards = Data.cards(id);
      const st = topicStat(id);
      let h = '<div class="fhead"><div class="crumb"><span class="tag">' + R.esc(t.code) + '</span>'
        + '<span class="tag">задания ЕГЭ ' + t.ege.join(', ') + '</span></div>'
        + '<h2>' + R.esc(t.title) + '</h2><p class="muted">' + R.esc(t.about) + '</p></div>';
      h += '<div class="card"><div class="band"><span>Выучено <b>' + st.learned + ' из ' + st.total + '</b></span></div>'
        + R.bar(st.total ? 100 * st.learned / st.total : 0) + '</div>';
      h += '<div class="row-2" style="margin-bottom:var(--sp-4)">'
        + '<button class="btn" data-ses="' + R.esc(id) + '">Учить тему</button>'
        + '<a class="btn" href="#/kviz/' + R.esc(id) + '">Квиз по теме</a></div>';
      h += '<ul class="flist">' + cards.map(c => '<li>' + R.frow(c, S.strength(state[c.id + ':w'])) + '</li>').join('') + '</ul>';
      $('#topic-body').innerHTML = h;
    });
  }

  function fail(where, msg) {
    $(where).innerHTML = '<div class="card note mist"><span class="lab">не вышло</span>' + R.esc(msg)
      + ' Проверь интернет и попробуй снова.</div>';
  }

  /* ---------- одна формула ---------- */

  function formulaScreen(id) {
    show('formula');
    const topic = Data.topicOf(id);
    if (!topic) return go('#/temy');
    wait('#formula-body');
    Data.need([topic], (err) => {
      if (err) return fail('#formula-body', err);
      const c = Data.card(id);
      if (!c) return go('#/temy');
      $('#title').textContent = c.title;
      const mine = state[id + ':w'];
      let h = R.formula(c);
      h += '<div class="row-2" style="margin-top:var(--sp-4)">'
        + '<button class="btn" data-pov="' + R.esc(id) + '">'
        + (mine && mine.st !== 'new' ? 'Повторить сейчас' : 'Взять в повторение') + '</button>'
        + '<a class="btn" href="#/kviz/' + R.esc(topic) + '">Квиз по теме</a></div>';
      if (mine && mine.st !== 'new') {
        h += '<p class="streak">' + R.dots(S.strength(mine)) + ' следующий показ ' + R.esc(mine.due) + '</p>';
      }
      $('#formula-body').innerHTML = h;
    });
  }

  // Подсветка буквы внутри большой формулы: собираем «листья» разметки KaTeX в одну
  // строку и ищем в ней нужный кусок. Так подсвечивается именно та буква, на которую нажали.
  function litVar(symHtmlEl) {
    const big = $('#formula-body .fbig .katex');
    if (!big) return;
    for (const el of $$('.lit', big)) el.classList.remove('lit');
    const want = (symHtmlEl.textContent || '').trim();
    if (!want) return;
    const leaves = $$('*', big).filter(e => e.children.length === 0 && (e.textContent || '').trim());
    let acc = '', map = [];
    for (const e of leaves) {
      const t = (e.textContent || '').trim();
      for (let i = 0; i < t.length; i++) map.push(e);
      acc += t;
    }
    const at = acc.indexOf(want);
    if (at < 0) return;
    for (let i = at; i < at + want.length && i < map.length; i++) map[i].classList.add('lit');
  }

  /* ---------- повторение ---------- */

  function sessionScreen(topicId) {
    show('session');
    if (!ses) return startSession(topicId);
    drawCard();
  }

  function startSession(topicId, extra) {
    show('session');
    const day = today();
    let all = keys();
    if (topicId) all = all.filter(k => k.topic === topicId);
    const o = opt();
    if (extra) { o.newPerDay = Math.max(o.newPerDay, 10); o.maxPerDay = Math.max(o.maxPerDay, 20); }
    const q = S.queue(all, state, day, o);
    if (!q.list.length) {
      $('#session-body').innerHTML = '<div class="done"><p class="big">✓</p><p>Тут всё повторено.</p>'
        + '<button class="btn btn-wide" data-go="#/">На главную</button></div>';
      return;
    }
    const topics = [];
    for (const k of q.list) { const t = Data.topicOf(fidOf(k)); if (t && topics.indexOf(t) < 0) topics.push(t); }
    wait('#session-body', 'Готовлю карточки…');
    Data.need(topics, (err) => {
      if (err) return fail('#session-body', err);
      ses = { list: q.list.slice(), left: q.list.length, done: 0, open: false, from: topicId || '' };
      drawCard();
    });
  }

  function drawCard() {
    if (!ses) return go('#/');
    if (!ses.list.length) return drawDone();
    const key = ses.list[0];
    const c = Data.card(fidOf(key));
    if (!c) { ses.list.shift(); return drawCard(); }
    const side = sideOf(key);
    const total = ses.done + ses.list.length;
    const pct = total ? 100 * ses.done / total : 0;

    let q, a;
    if (side === 'w') {
      // у определений формулы нет — спрашиваем иначе, иначе выходит «вспомни формулу» про понятие
      q = '<p class="ask">' + (c.tex ? 'Вспомни формулу' : 'Вспомни, что это такое') + '</p>'
        + '<p class="q">' + R.esc(c.title) + '</p>';
      a = (c.tex ? '<div class="ans">' + R.md(c.tex) + '</div>' : '<div class="ans"><p>' + R.text(c.law) + '</p></div>')
        + '<p class="hint">' + R.esc(c.short) + '</p>';
    } else {
      q = '<p class="ask">Что это за формула и что значат буквы?</p>'
        + (c.tex ? '<div class="q">' + R.md(c.tex) + '</div>' : '<p class="q">' + R.esc(c.title) + '</p>');
      a = '<div class="ans"><p class="q">' + R.esc(c.title) + '</p>'
        + (c.vars && c.vars.length ? '<ul class="vmini">' + c.vars.map(v =>
          '<li><span>' + R.mi(v.tex) + '</span><span>' + R.esc(v.name) + '</span>'
          + '<span class="un">' + (v.unitless ? '—' : R.esc(v.unit)) + '</span></li>').join('') + '</ul>' : '')
        + '</div>';
    }

    let h = '<div class="ses">'
      + '<div class="prog">' + R.bar(pct) + '<span class="n">' + (ses.done + 1) + ' из ' + total + '</span></div>'
      + '<div class="fc" id="fc" role="button" tabindex="0" aria-label="Показать ответ">' + q
      + (ses.open ? a : '<p class="hint">нажми, чтобы увидеть ответ</p>') + '</div>';

    if (ses.open) {
      h += '<div class="grades">'
        + '<button class="btn again" data-grade="again">Не помню<span class="k">1</span></button>'
        + '<button class="btn hard" data-grade="hard">С трудом<span class="k">2</span></button>'
        + '<button class="btn know" data-grade="know">Знаю<span class="k">3</span></button></div>'
        + '<p class="streak"><a href="#/f/' + R.esc(c.id) + '">Открыть разбор формулы →</a></p>';
    } else {
      h += '<button class="btn btn-main btn-wide" id="flip">Показать ответ</button>';
    }
    $('#session-body').innerHTML = h + '</div>';
  }

  function grade(g) {
    if (!ses || !ses.open || busy) return;
    busy = true;
    const key = ses.list.shift();
    const r = S.next(card(key), g, today(), opt());
    saveCard(key, r.card);
    St.addDone(today(), 1);
    ses.done += 1;
    ses.open = false;
    // «не помню» и незакреплённые — вернуть в этот же заход, через пару карточек
    if (r.again) ses.list.splice(Math.min(2, ses.list.length), 0, key);
    busy = false;
    drawCard();
  }

  function drawDone() {
    const n = ses ? ses.done : 0;
    const from = ses ? ses.from : '';
    ses = null;
    $('#session-body').innerHTML = '<div class="done"><p class="big">🎉</p>'
      + '<h2>Готово</h2><p class="muted">Карточек за этот заход: ' + n + '.</p>'
      + '<div class="row-2" style="margin-top:var(--sp-5)">'
      + '<button class="btn btn-main" data-go="#/">На главную</button>'
      + '<a class="btn" href="#/kviz' + (from ? '/' + R.esc(from) : '') + '">Проверить квизом</a></div></div>';
    today0.dirty = true;
  }

  /* ---------- квиз ---------- */

  function quizPick() {
    show('quiz');
    const have = Data.topics().filter(t => Data.indexOfTopic(t.id).length);
    let h = '<div class="fhead"><h2>Квиз</h2><p class="muted">Короткая проверка: что значат буквы, '
      + 'в чём измеряются, какая запись верна и когда формулой пользоваться нельзя.</p></div>';
    const q = St.quiz();
    for (const t of have) {
      const best = q[t.id] && q[t.id].best;
      h += '<a class="linkrow" href="#/kviz/' + R.esc(t.id) + '"><span><span class="t">' + R.esc(t.title) + '</span>'
        + '<span class="n">' + (best ? 'лучший результат ' + best + '%' : 'ещё не проходил') + '</span></span></a>';
    }
    if (have.length > 1) {
      h += '<a class="linkrow" href="#/kviz/vse"><span><span class="t">Все темы вперемешку</span>'
        + '<span class="n">как на экзамене</span></span></a>';
    }
    $('#quiz-body').innerHTML = h;
  }

  function quizStart(topicId) {
    show('quiz');
    const all = topicId === 'vse'
      ? Data.topics().map(t => t.id).filter(id => Data.indexOfTopic(id).length)
      : [topicId];
    if (!all.length || (topicId !== 'vse' && !Data.topic(topicId))) return go('#/kviz');
    wait('#quiz-body', 'Готовлю вопросы…');
    Data.need(all, (err) => {
      if (err) return fail('#quiz-body', err);
      const pool = Qz.build(Data.allLoaded(), window.QUIZ_HAND || []);
      const seed = Qz.hash(today() + ':' + (St.quiz()[topicId] ? St.quiz()[topicId].runs : 0));
      const list = Qz.pick(pool, topicId === 'vse' ? '' : topicId, 10, seed);
      if (!list.length) return fail('#quiz-body', 'Для этой темы вопросов пока нет.');
      run = { list: list, i: 0, right: 0, wrong: [], topic: topicId, answered: false };
      drawQ();
    });
  }

  function drawQ() {
    if (!run) return go('#/kviz');
    if (run.i >= run.list.length) return drawQuizDone();
    const q = run.list[run.i];
    $('#quiz-body').innerHTML = '<div class="qz">' + R.question(q, run.i + 1, run.list.length) + '</div>';
    run.answered = false;
  }

  function answer(i) {
    if (!run || run.answered) return;
    const q = run.list[run.i];
    const opts = $$('#quiz-body .opt');
    if (!q.opts[i]) return;
    run.answered = true;
    const ok = !!q.opts[i].ok;
    if (ok) run.right++; else if (q.fid) run.wrong.push(q.fid);
    opts.forEach((el, j) => {
      el.disabled = true;
      if (q.opts[j].ok) el.classList.add('is-ok');
      else if (j === i) el.classList.add('is-bad');
    });
    $('#quiz-body .why').innerHTML = '<div class="note ' + (ok ? 'memo' : 'mist') + '">'
      + '<span class="lab">' + (ok ? 'верно' : 'не так') + '</span>' + R.text(q.why) + '</div>'
      + '<button class="btn btn-main btn-wide" id="next-q" style="margin-top:var(--sp-3)">'
      + (run.i + 1 >= run.list.length ? 'Показать итог' : 'Дальше →') + '</button>';
    $('#next-q').focus();
  }

  function drawQuizDone() {
    const total = run.list.length, right = run.right;
    const bad = [...new Set(run.wrong)];
    St.saveQuiz(run.topic, right, total);
    // ошибся в квизе — вернём формулу в повторение, но легкость не портим
    for (const fid of bad) {
      const key = fid + ':w';
      if (state[key]) saveCard(key, S.afterQuiz(card(key), today(), opt()));
    }
    const pct = Math.round(100 * right / total);
    let h = '<div class="done"><p class="big">' + (pct >= 80 ? '🎯' : pct >= 50 ? '🙂' : '💪') + '</p>'
      + '<h2>' + right + ' из ' + total + '</h2>'
      + '<p class="muted">' + (pct >= 80 ? 'Крепко.' : pct >= 50 ? 'Неплохо, но есть дырки.' : 'Эти формулы стоит повторить.') + '</p></div>';
    if (bad.length) {
      h += '<div class="card note sign"><span class="lab">вернули в повторение</span>'
        + bad.length + ' ' + R.plural(bad.length, 'формула', 'формулы', 'формул')
        + ', где была ошибка, появятся в повторении завтра.</div>';
      h += '<ul class="flist">' + bad.map(fid => {
        const c = Data.card(fid);
        return c ? '<li>' + R.frow(c, S.strength(state[fid + ':w'])) + '</li>' : '';
      }).join('') + '</ul>';
    }
    h += '<div class="row-2" style="margin-top:var(--sp-4)">'
      + '<button class="btn btn-main" data-requiz="' + R.esc(run.topic) + '">Ещё раз</button>'
      + '<button class="btn" data-go="#/kviz">К темам квиза</button></div>';
    $('#quiz-body').innerHTML = h;
    run = null;
  }

  /* ---------- Я: прогресс и настройки ---------- */

  function meScreen() {
    show('me');
    const day = today();
    const all = keys();
    const pl = S.plan(all, state, day, opt());
    const ready = S.ready(all, state, day, set.exam);
    const log = St.log();
    const hard = [];
    for (const k in state) {
      const c = state[k];
      if (c && c.lapses >= 2 && sideOf(k) === 'w') hard.push({ fid: fidOf(k), lapses: c.lapses });
    }
    hard.sort((a, b) => b.lapses - a.lapses);

    let h = '<div class="fhead"><h2>Мой прогресс</h2></div>';
    h += '<div class="stats">'
      + stat(ready + '%', 'готовность к ЕГЭ')
      + stat(pl.learned, 'формул выучено')
      + stat(pl.left === null ? '—' : pl.left, 'дней до ЕГЭ')
      + stat(St.streak(day, S.addDays), 'дней подряд')
      + '</div>';

    // столбики за последние 30 дней
    let sp = '';
    const max = Math.max(1, ...Object.values(log));
    for (let i = 29; i >= 0; i--) {
      const dd = S.addDays(day, -i), v = log[dd] || 0;
      sp += '<i class="' + (v ? 'has' : '') + '" style="height:' + Math.round(100 * v / max) + '%" title="'
        + dd + ': ' + v + '"></i>';
    }
    h += '<section class="card"><h3>Последние 30 дней</h3><div class="spark">' + sp + '</div></section>';

    if (hard.length) {
      h += '<section class="card"><h3>Трудные формулы</h3><p class="small muted">Их ты забывал чаще других.</p>'
        + '<div class="chips">' + hard.slice(0, 8).map(x => {
          const c = Data.card(x.fid);
          return '<a class="chip" href="#/f/' + R.esc(x.fid) + '">' + R.esc(c ? c.title : x.fid) + '</a>';
        }).join('') + '</div></section>';
    }

    h += '<section class="card"><h3>Настройки</h3>'
      + '<div class="field"><label for="exam">Дата ЕГЭ</label>'
      + '<input type="date" id="exam" value="' + R.esc(set.exam) + '" min="' + day + '">'
      + '<p class="hint">От неё зависят интервалы: чем ближе экзамен, тем чаще повторения.</p></div>'
      + '<div class="field"><label for="npd">Новых формул в день: <b id="npd-v">' + set.newPerDay + '</b></label>'
      + '<input type="range" id="npd" min="2" max="20" step="1" value="' + set.newPerDay + '"></div>'
      + '<div class="field"><label for="mpd">Всего карточек в день: <b id="mpd-v">' + set.maxPerDay + '</b></label>'
      + '<input type="range" id="mpd" min="10" max="80" step="5" value="' + set.maxPerDay + '"></div>'
      + '<div class="field"><label>Учить формулы в обе стороны</label>'
      + '<div class="seg"><button type="button" data-both="1" aria-pressed="' + (set.both ? 'true' : 'false') + '">Да</button>'
      + '<button type="button" data-both="0" aria-pressed="' + (!set.both ? 'true' : 'false') + '">Нет</button></div>'
      + '<p class="hint">«Да» — кроме «название → формула» будет ещё «формула → смысл». Так крепче, но карточек вдвое больше.</p></div>'
      + '<div class="field"><label>Оформление</label><div class="seg">'
      + ['auto', 'light', 'dark'].map(v => '<button type="button" data-theme="' + v + '" aria-pressed="'
        + (set.theme === v ? 'true' : 'false') + '">' + ({ auto: 'Как в системе', light: 'Светлое', dark: 'Тёмное' })[v]
        + '</button>').join('') + '</div></div>'
      + '</section>';

    h += '<details class="more"><summary>Перенести прогресс на другой телефон</summary><div class="body">'
      + '<p class="small muted">Прогресс хранится только в этом браузере. Скопируй текст и сохрани в заметки — '
      + 'потом его можно вставить здесь же на другом устройстве.</p>'
      + '<textarea id="dump" readonly>' + R.esc(St.exportText()) + '</textarea>'
      + '<div class="row" style="margin:var(--sp-2) 0"><button class="btn btn-sm" id="copy">Скопировать</button></div>'
      + '<label for="load" class="small">Вставить сохранённый прогресс:</label>'
      + '<textarea id="load" placeholder="вставь сюда текст"></textarea>'
      + '<div class="row" style="margin-top:var(--sp-2)"><button class="btn btn-sm" id="apply-load">Загрузить</button></div>'
      + '<p id="load-msg" class="small"></p>'
      + '</div></details>';

    h += '<details class="more"><summary>Начать всё заново</summary><div class="body">'
      + '<p class="small muted">Сотрёт весь прогресс: карточки, дни и результаты квизов. Отменить нельзя.</p>'
      + '<button class="btn btn-sm" id="reset">Стереть прогресс</button></div></details>';

    h += '<p class="streak small">Содержание сверено с кодификатором ЕГЭ по физике 2026 (ФИПИ). '
      + 'На экзамене выдают только константы — формулы нужно помнить.</p>';

    $('#me-body').innerHTML = h;
  }

  function stat(v, l) { return '<div class="stat"><div class="v">' + v + '</div><div class="l">' + l + '</div></div>'; }

  /* ---------- оформление ---------- */

  function applyTheme() {
    const r = d.documentElement;
    if (set.theme === 'auto') r.removeAttribute('data-theme');
    else r.setAttribute('data-theme', set.theme);
  }

  /* ---------- события ---------- */

  d.addEventListener('click', (e) => {
    const t = e.target;
    const near = (sel) => t.closest ? t.closest(sel) : null;

    const vb = near('.vbtn');
    if (vb) {
      const open = vb.getAttribute('aria-expanded') === 'true';
      for (const o of $$('.vbtn')) o.setAttribute('aria-expanded', 'false');
      vb.setAttribute('aria-expanded', open ? 'false' : 'true');
      if (!open) litVar($('.sym', vb)); else for (const el of $$('.fbig .lit')) el.classList.remove('lit');
      return;
    }

    if (near('#hello-ok')) {
      const v = $('#exam0').value;
      set.exam = v || ''; set.hello = true;
      St.setSettings({ exam: set.exam, hello: true });
      return today0();
    }
    if (near('#hello-skip')) { set.hello = true; St.setSettings({ hello: true }); return today0(); }
    if (near('#fix-pace')) {
      const pl = S.plan(keys(), state, today(), opt());
      set.newPerDay = Math.min(20, pl.needPerDay);
      St.setSettings({ newPerDay: set.newPerDay });
      return today0();
    }
    if (near('#start-ses')) return go('#/povtor');
    if (near('#start-extra')) { ses = null; return startSession('', true); }

    const sesBtn = near('[data-ses]');
    if (sesBtn) { ses = null; return go('#/povtor/' + sesBtn.dataset.ses); }

    const pov = near('[data-pov]');
    if (pov) {
      const key = pov.dataset.pov + ':w';
      const c = card(key);
      if (c.st === 'new') { c.st = 'learn'; c.iv = 1; c.due = today(); saveCard(key, c); }
      else { c.due = today(); saveCard(key, c); }
      ses = null;
      return go('#/povtor');
    }

    const gr = near('[data-grade]');
    if (gr) return grade(gr.dataset.grade);

    if (near('#flip') || near('#fc')) {
      if (ses && !ses.open) { ses.open = true; drawCard(); }
      return;
    }

    const opt2 = near('.opt');
    if (opt2 && !opt2.disabled) return answer(+opt2.dataset.i);
    if (near('#next-q')) { run.i++; return drawQ(); }

    const rq = near('[data-requiz]');
    if (rq) return quizStart(rq.dataset.requiz);

    const goBtn = near('[data-go]');
    if (goBtn) return go(goBtn.dataset.go);

    const both = near('[data-both]');
    if (both) { set.both = both.dataset.both === '1'; St.setSettings({ both: set.both }); return meScreen(); }

    const th = near('[data-theme]');
    if (th) { set.theme = th.dataset.theme; St.setSettings({ theme: set.theme }); applyTheme(); return meScreen(); }

    if (near('#copy')) {
      const ta = $('#dump');
      ta.select();
      try { d.execCommand('copy'); } catch (err) { /* не вышло — текст всё равно выделен */ }
      if (navigator.clipboard) navigator.clipboard.writeText(ta.value).catch(() => {});
      $('#load-msg').textContent = 'Скопировано. Сохрани в заметки.';
      return;
    }
    if (near('#apply-load')) {
      const r = St.importText($('#load').value);
      $('#load-msg').textContent = r.ok ? 'Готово: загружено карточек ' + r.n + '.' : r.why;
      if (r.ok) { state = St.cards(); set = St.settings(); applyTheme(); meScreen(); }
      return;
    }
    if (near('#reset')) {
      if (!window.confirm('Стереть весь прогресс? Отменить будет нельзя.')) return;
      St.clearAll();
      state = {}; set = St.settings(); applyTheme();
      return go('#/');
    }
    if (near('#toast-go')) { location.reload(); return; }
  });

  d.addEventListener('input', (e) => {
    if (e.target.id === 'exam') { set.exam = e.target.value; St.setSettings({ exam: set.exam }); }
    if (e.target.id === 'npd') { set.newPerDay = +e.target.value; $('#npd-v').textContent = set.newPerDay; St.setSettings({ newPerDay: set.newPerDay }); }
    if (e.target.id === 'mpd') { set.maxPerDay = +e.target.value; $('#mpd-v').textContent = set.maxPerDay; St.setSettings({ maxPerDay: set.maxPerDay }); }
  });

  d.addEventListener('keydown', (e) => {
    if (e.target.matches && e.target.matches('input, textarea')) return;
    const inSes = $('#s-session').classList.contains('on') && ses;
    if (inSes && (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      if (!ses.open) { ses.open = true; drawCard(); }
      return;
    }
    if (inSes && ses.open && ['1', '2', '3'].indexOf(e.key) >= 0) {
      e.preventDefault();
      return grade(['again', 'hard', 'know'][+e.key - 1]);
    }
    if ($('#s-quiz').classList.contains('on') && run && !run.answered && /^[1-4]$/.test(e.key)) {
      e.preventDefault();
      return answer(+e.key - 1);
    }
    if ($('#s-quiz').classList.contains('on') && run && run.answered && e.key === 'Enter') {
      e.preventDefault(); run.i++; return drawQ();
    }
    if (e.key === 'Escape') { e.preventDefault(); history.back(); }
  });

  $('#back').addEventListener('click', () => history.back());
  window.addEventListener('hashchange', route);

  /* ---------- оффлайн ---------- */

  function sw() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    navigator.serviceWorker.register('sw.js', { scope: './' }).then((reg) => {
      // новая версия приехала — предлагаем обновиться, но не перезагружаем молча
      reg.addEventListener('updatefound', () => {});
      if (reg.waiting) toast();
      reg.addEventListener('updatefound', () => {
        const n = reg.installing;
        if (!n) return;
        n.addEventListener('statechange', () => { if (n.state === 'installed' && navigator.serviceWorker.controller) toast(); });
      });
    }).catch(() => { /* оффлайн просто не включится */ });
  }

  function toast() {
    if ($('#toast')) return;
    const el = d.createElement('div');
    el.className = 'toast';
    el.id = 'toast';
    el.innerHTML = '<span>Сайт обновился</span><button class="btn" id="toast-go">Обновить</button>';
    d.body.appendChild(el);
  }

  /* ---------- старт ---------- */

  applyTheme();
  route();
  sw();

  // чтобы проверки могли заглянуть внутрь
  window.App = {
    route: route, state: () => state, set: () => set, ses: () => ses, run: () => run,
    keys: keys, reload: () => { state = St.cards(); set = St.settings(); },
  };

})();
