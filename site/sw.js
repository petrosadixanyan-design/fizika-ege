// Оффлайн: сайт открывается без интернета. Файл маленький и намеренно простой.
//
// Версию и список оболочки вписывает tools/make-sw.js при каждой выкладке —
// иначе у человека навсегда остался бы старый index.html. Это главная ловушка
// GitHub Pages, поэтому строки ниже помечены и правятся скриптом, а не руками.

const V = 'fiz-91acafe5';                                  /* make-sw: version */
const SHELL = [                                          /* make-sw: shell */
  './',
  './index.html',
  './spravochnik.html',
  './css/style.css',
  './vendor/katex-0.19.0.min.css',
  './manifest.webmanifest',
  './assets/icon.svg',
  './assets/icon-192.png',
  './js/srs.js',
  './js/store.js',
  './js/quizgen.js',
  './js/data.js',
  './js/render.js',
  './js/app.js',
  './data/topics.js',
  './data/index.js',
];

// Оболочку кладём в кэш сразу. Шрифты KaTeX и данные тем — по мере использования:
// иначе первая загрузка потащила бы лишние сотни килобайт.
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(V)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())      // один недостающий файл не должен ломать установку
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== V).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  const isPage = req.mode === 'navigate' || /\.html$/.test(url.pathname) || url.pathname.endsWith('/');

  if (isPage) {
    // страницы: сначала сеть (чтобы вёрстка обновлялась), при неудаче — кэш
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(V).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // всё остальное: сначала кэш, потом сеть — и то, что пришло, кладём в кэш
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res && res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(V).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }))
  );
});
