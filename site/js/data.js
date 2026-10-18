// Доступ к данным. Темы догружаются по мере надобности: сразу нужен только
// короткий список всех формул (data/index.js), а тяжёлые файлы темы — когда в неё зашли.
// Благодаря этому первая загрузка остаётся лёгкой даже при 16 темах.

(function (root) {
  'use strict';

  var cardsByTopic = {};   // тема → массив карточек
  var cardById = {};
  var TEXD = {}, TEXI = {};
  var pending = {};        // тема → список ожидающих обработчиков

  function up(id) { return id.toUpperCase().replace(/-/g, '_'); }

  function index() { return root.INDEX || []; }
  function topics() { return root.TOPICS || []; }
  function sections() { return root.SECTIONS || []; }

  function topic(id) {
    var t = topics();
    for (var i = 0; i < t.length; i++) if (t[i].id === id) return t[i];
    return null;
  }

  // Какие формулы есть в теме — видно из короткого списка, без загрузки данных.
  function indexOfTopic(id) {
    return index().filter(function (r) { return r.t === id; });
  }

  function topicOf(cardId) {
    var ix = index();
    for (var i = 0; i < ix.length; i++) if (ix[i].i === cardId) return ix[i].t;
    return null;
  }

  function loaded(id) { return !!cardsByTopic[id]; }

  function take(id) {
    var arr = root['T_' + up(id)];
    if (!arr) return false;
    for (var i = 0; i < arr.length; i++) {
      if (!arr[i].topic) arr[i].topic = id;      // тема берётся из имени файла
      cardById[arr[i].id] = arr[i];
    }
    cardsByTopic[id] = arr;
    var tx = root['TEX_' + up(id)];
    if (tx) {
      for (var k in tx.d) TEXD[k] = tx.d[k];
      for (var n in tx.i) TEXI[n] = tx.i[n];
    }
    return true;
  }

  function addScript(src, ok, fail) {
    var s = document.createElement('script');
    s.src = src;
    s.onload = ok;
    s.onerror = fail;
    document.head.appendChild(s);
  }

  // Грузит данные одной темы и зовёт cb(ошибка). Повторные вызовы не качают дважды.
  function loadTopic(id, cb) {
    if (loaded(id)) return cb(null);
    if (take(id)) return cb(null);               // файл уже на странице (например, после пререндера)
    if (pending[id]) { pending[id].push(cb); return; }
    pending[id] = [cb];
    var left = 2, bad = null;
    var done = function () {
      if (--left) return;
      if (!bad) take(id);
      var list = pending[id]; pending[id] = null;
      for (var i = 0; i < list.length; i++) list[i](bad);
    };
    addScript('data/t-' + id + '.js', done, function () { bad = 'не загрузилась тема ' + id; done(); });
    addScript('data/tex-' + id + '.js', done, function () { bad = 'не загрузились формулы темы ' + id; done(); });
  }

  // Грузит сразу несколько тем (нужно для повторения, где формулы из разных тем).
  function need(ids, cb) {
    var list = [];
    for (var i = 0; i < ids.length; i++) if (ids[i] && list.indexOf(ids[i]) < 0) list.push(ids[i]);
    if (!list.length) return cb(null);
    var left = list.length, bad = null;
    for (var j = 0; j < list.length; j++) {
      loadTopic(list[j], function (e) {
        if (e) bad = e;
        if (!--left) cb(bad);
      });
    }
  }

  function cards(id) { return cardsByTopic[id] || []; }
  function card(id) { return cardById[id] || null; }

  // Все загруженные карточки — для сборки квизов.
  function allLoaded() {
    var out = [];
    for (var t in cardsByTopic) out = out.concat(cardsByTopic[t]);
    return out;
  }

  root.Data = {
    index: index, topics: topics, sections: sections, topic: topic,
    indexOfTopic: indexOfTopic, topicOf: topicOf,
    need: need, loaded: loaded, take: take,
    cards: cards, card: card, allLoaded: allLoaded,
    d: function (tex) { return TEXD[tex]; },
    i: function (tex) { return TEXI[tex]; },
  };

})(typeof window !== 'undefined' ? window : globalThis);
