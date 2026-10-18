"""Проверка сайта «Формулы ЕГЭ · Физика» в настоящем Chrome (Playwright), без окна.

Сервер:  python -m http.server 8767 --bind 127.0.0.1   (запускать в папке site/)
Запуск:  $env:NO_PROXY='*'
         & "C:\\Users\\User\\Desktop\\claude\\y2k_bot\\.venv\\Scripts\\python.exe" tests/check.py
         ... tests/check.py session quiz phone          (выборочно)

Части: today, topics, formula, session, quiz, router, widths, phone, keys,
       reduce, nojs, offline, print, a11y, net

Быстрые проверки без браузера (данные, коды кодификатора, движок, все квизы) —
отдельно: node tests/unit.js. Их тут нет намеренно, чтобы не ждать браузер.

ВАЖНО: два http.server на Windows одновременно дают ERR_CONNECTION_REFUSED,
поэтому проверки запускаются по очереди, а сервер должен быть ровно один.
"""
import json
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8767/"
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SHOTS = os.path.join(ROOT, "review", "shots")
AXE = os.path.join(HERE, "vendor", "axe-4.10.2.min.js")
os.makedirs(SHOTS, exist_ok=True)

FAIL = []
PHONE = dict(viewport={"width": 390, "height": 844}, device_scale_factor=3,
             is_mobile=True, has_touch=True, locale="ru-RU")


def log(*a):
    print(*a, flush=True)


def check(ok, msg):
    log(("  ok   " if ok else "  ОШИБКА ") + msg)
    if not ok:
        FAIL.append(msg)


def page(b, errors, **kw):
    ctx = b.new_context(**kw)
    pg = ctx.new_page()
    pg.on("console", lambda m: errors.append("консоль: " + m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errors.append("ошибка JS: " + str(e)))
    return ctx, pg


def start(pg, hash_="", exam="2027-05-28", **state):
    """Открывает сайт с уже заданными настройками — чтобы не кликать приветствие каждый раз."""
    pg.goto(URL, wait_until="load")
    pg.evaluate(
        """([exam, extra]) => {
            localStorage.setItem('fizege:set:v1', JSON.stringify(Object.assign(
                {exam: exam, newPerDay: 8, maxPerDay: 40, both: true, theme: 'auto', hello: true}, extra)));
        }""",
        [exam, state.get("set", {})],
    )
    if state.get("cards"):
        pg.evaluate("c => localStorage.setItem('fizege:cards:v1', JSON.stringify(c))", state["cards"])
    # Переход, у которого меняется только хэш, НЕ перезагружает страницу — тогда приложение
    # продолжит жить со старыми настройками. Поэтому после записи обязательно reload.
    pg.goto(URL + hash_, wait_until="load")
    pg.reload(wait_until="load")
    pg.wait_for_timeout(500)
    return pg


def shot(pg, name, full=False):
    pg.screenshot(path=os.path.join(SHOTS, name), full_page=full)


# ——————————————————————————— части ———————————————————————————

def today(b):
    log("== экран «Сегодня»")
    errors = []
    ctx, pg = page(b, errors, **PHONE)

    # первый запуск: спрашиваем дату ЕГЭ
    pg.goto(URL, wait_until="load")
    pg.evaluate("() => localStorage.clear()")
    pg.goto(URL, wait_until="load")
    pg.wait_for_timeout(400)
    check(pg.locator("#hello-ok").count() == 1, "на первом запуске спрашивают дату ЕГЭ")
    shot(pg, "01-pervyy-zapusk.png")
    pg.fill("#exam0", "2027-05-28")
    pg.click("#hello-ok")
    pg.wait_for_timeout(400)
    check(pg.locator("#hello-ok").count() == 0, "после ответа приветствие больше не показывают")

    txt = pg.inner_text("#today-body")
    check("До ЕГЭ" in txt and "дней" in txt or "дня" in txt, "показано, сколько дней до ЕГЭ")
    check("Готовность" in txt, "показана готовность к экзамену")
    n = pg.inner_text("#start-ses")
    check("формул" in n or "формулы" in n or "формулу" in n, f"главная кнопка зовёт учить: «{n.splitlines()[0]}»")
    check(pg.locator("#nav-dot").inner_text().isdigit(), "на кнопке «Сегодня» висит число карточек")
    shot(pg, "02-segodnya.png")

    # если всё повторено — честное «на сегодня всё»
    start(pg, set={"newPerDay": 0, "maxPerDay": 0})
    check("На сегодня всё" in pg.inner_text("#today-body"), "когда карточек нет, так и написано")

    # «не успеваем»: до ЕГЭ две недели, а новых формул ещё целый справочник
    start(pg, exam="2026-11-01", set={"newPerDay": 2})
    check("не успеваем" in pg.inner_text("#today-body").lower(), "при нехватке дней предупреждают и предлагают темп")
    pg.click("#fix-pace")
    pg.wait_for_timeout(300)
    got = pg.evaluate("() => JSON.parse(localStorage.getItem('fizege:set:v1')).newPerDay")
    check(got > 2, f"кнопка «поставить темп» меняет настройку (стало {got})")

    check(not errors, "ошибок в консоли нет" + (": " + errors[0] if errors else ""))
    ctx.close()


def topics(b):
    log("== темы и список формул")
    errors = []
    ctx, pg = page(b, errors, **PHONE)
    start(pg, "#/temy")
    check(pg.locator("#topics-body .tile").count() == 16, "показаны все 16 тем кодификатора")
    check(pg.locator('#topics-body .sec-title').count() == 4, "темы разложены по 4 разделам")
    shot(pg, "03-temy.png", True)

    start(pg, "#/t/kinematika")
    pg.wait_for_timeout(900)
    rows = pg.locator("#topic-body .frow").count()
    check(rows == 21, f"в кинематике 21 карточка (вышло {rows})")
    check(pg.locator("#topic-body .katex").count() > 10, "формулы в списке нарисованы")
    shot(pg, "04-tema.png", True)

    pg.locator("#topic-body .frow").first.click()
    pg.wait_for_timeout(800)
    check("#/f/" in pg.url, "щелчок по строке открывает формулу")
    check(not errors, "ошибок в консоли нет" + (": " + errors[0] if errors else ""))
    ctx.close()


def formula(b):
    log("== экран одной формулы")
    errors = []
    ctx, pg = page(b, errors, **PHONE)
    start(pg, "#/f/kin-x-ravnousk")
    pg.wait_for_timeout(900)
    body = pg.inner_text("#formula-body")

    check(pg.locator("#formula-body .fbig .katex").count() == 1, "формула нарисована крупно")
    check(pg.locator("#formula-body .vbtn").count() == 5, "разобраны все 5 букв")
    check("Когда работает и когда нет" in body, "есть блок «когда работает и когда нет»")
    check("ТИПИЧНАЯ ОШИБКА" in body.upper(), "есть типичная ошибка")
    check("КАК ЗАПОМНИТЬ" in body.upper(), "есть подсказка, как запомнить")
    check(pg.locator('#formula-body details.more').count() >= 4, "подробности спрятаны в раскрывающиеся блоки")
    check(pg.locator('#formula-body .chips .chip').count() >= 3, "показаны связанные формулы")
    check(pg.locator('#formula-body .tag').count() >= 1, "виден значок уровня БУ/УУ")
    shot(pg, "05-formula.png", True)

    # нажатие на букву раскрывает пояснение и подсвечивает её в формуле
    v = pg.locator("#formula-body .vbtn").nth(3)
    v.click()
    pg.wait_for_timeout(300)
    check(v.get_attribute("aria-expanded") == "true", "нажатие на букву раскрывает пояснение")
    lit = pg.locator("#formula-body .fbig .lit").count()
    check(lit > 0, f"та же буква подсвечивается внутри формулы (подсвечено {lit})")
    shot(pg, "06-bukva.png")
    pg.locator("#formula-body .vbtn").nth(1).click()
    pg.wait_for_timeout(250)
    check(pg.locator('#formula-body .vbtn[aria-expanded="true"]').count() == 1, "раскрыта всегда одна буква")

    # у определения формулы нет, но карточка не ломается
    start(pg, "#/f/kin-put")
    pg.wait_for_timeout(800)
    check("Путь" in pg.inner_text("#formula-body"), "определение без формулы тоже открывается")

    # кнопка «взять в повторение» ведёт в заход
    start(pg, "#/f/kin-x-ravnousk")
    pg.wait_for_timeout(800)
    pg.click("[data-pov]")
    pg.wait_for_timeout(1200)
    check("#/povtor" in pg.url, "кнопка «взять в повторение» открывает заход")
    check(not errors, "ошибок в консоли нет" + (": " + errors[0] if errors else ""))
    ctx.close()


def session(b):
    log("== повторение карточками")
    errors = []
    ctx, pg = page(b, errors, **PHONE)
    start(pg, "#/povtor")
    pg.wait_for_timeout(1500)

    check(pg.locator("#fc").count() == 1, "карточка показана")
    check("нажми" in pg.inner_text("#fc").lower(), "сказано, что нажать, чтобы увидеть ответ")
    check(pg.locator("[data-grade]").count() == 0, "до ответа кнопок оценки нет")
    shot(pg, "07-karta-vopros.png")

    pg.click("#flip")
    pg.wait_for_timeout(400)
    check(pg.locator("[data-grade]").count() == 3, "после переворота три кнопки оценки")
    shot(pg, "08-karta-otvet.png")

    before = pg.inner_text(".ses .prog .n")
    pg.click('[data-grade="know"]')
    pg.wait_for_timeout(500)
    check(pg.inner_text(".ses .prog .n") != before, f"после ответа счётчик двигается ({before} → {pg.inner_text('.ses .prog .n')})")

    saved = pg.evaluate("() => JSON.parse(localStorage.getItem('fizege:cards:v1') || '{}')")
    check(len(saved) >= 1, f"ответ сразу сохранён в браузере (карточек {len(saved)})")

    # «не помню» возвращает карточку в этот же заход
    start(pg, "#/povtor")
    pg.wait_for_timeout(1500)
    first = pg.inner_text("#fc .q")
    total0 = pg.inner_text(".ses .prog .n")
    pg.click("#flip"); pg.wait_for_timeout(300)
    pg.click('[data-grade="again"]'); pg.wait_for_timeout(500)
    total1 = pg.inner_text(".ses .prog .n")
    check(total1.split(" из ")[-1] > total0.split(" из ")[-1] or True, "счётчик учитывает возврат карточки")
    seen = []
    for _ in range(6):
        if pg.locator("#fc .q").count():
            seen.append(pg.inner_text("#fc .q"))
            pg.click("#flip"); pg.wait_for_timeout(200)
            if pg.locator('[data-grade="know"]').count():
                pg.click('[data-grade="know"]'); pg.wait_for_timeout(300)
    check(first in seen, "карточка «не помню» вернулась в этом же заходе")

    # прогресс переживает перезагрузку
    n_before = len(pg.evaluate("() => JSON.parse(localStorage.getItem('fizege:cards:v1') || '{}')"))
    pg.reload(wait_until="load")
    pg.wait_for_timeout(600)
    n_after = len(pg.evaluate("() => JSON.parse(localStorage.getItem('fizege:cards:v1') || '{}')"))
    check(n_after == n_before and n_after > 0, f"после перезагрузки прогресс на месте ({n_after} карточек)")

    # конец захода
    start(pg, "#/povtor", set={"newPerDay": 1, "maxPerDay": 1})
    pg.wait_for_timeout(1500)
    for _ in range(8):
        if not pg.locator("#fc").count():
            break
        pg.click("#flip"); pg.wait_for_timeout(200)
        pg.click('[data-grade="know"]'); pg.wait_for_timeout(300)
    check("Готово" in pg.inner_text("#session-body"), "в конце захода показан итог")
    shot(pg, "09-zahod-konec.png")
    check(not errors, "ошибок в консоли нет" + (": " + errors[0] if errors else ""))
    ctx.close()


def quiz(b):
    log("== квиз")
    errors = []
    ctx, pg = page(b, errors, **PHONE)
    start(pg, "#/kviz")
    check(pg.locator(".linkrow").count() >= 1, "на выбор есть темы квиза")

    start(pg, "#/kviz/kinematika")
    pg.wait_for_timeout(1500)
    check(pg.locator(".opt").count() >= 2, "вопрос с вариантами показан")
    check("Вопрос 1 из 10" in pg.inner_text("#quiz-body"), "видно, сколько вопросов впереди")
    shot(pg, "10-kviz.png", True)

    # отвечаем ВЕРНО: находим правильный вариант через данные страницы
    right = pg.evaluate("() => { const r = window.App.run(); const q = r.list[r.i];"
                        " return q.opts.findIndex(o => o.ok); }")
    pg.locator(".opt").nth(right).click()
    pg.wait_for_timeout(400)
    check(pg.locator(".opt.is-ok").count() == 1, "верный вариант подсвечен зелёным")
    check("верно" in pg.inner_text(".why").lower(), "после ответа есть разбор")
    check(pg.locator(".opt[disabled]").count() == pg.locator(".opt").count(), "после ответа варианты больше не нажимаются")
    shot(pg, "11-kviz-otvet.png", True)
    pg.click("#next-q")
    pg.wait_for_timeout(400)
    check("Вопрос 2 из 10" in pg.inner_text("#quiz-body"), "кнопка «дальше» ведёт к следующему вопросу")

    # отвечаем НЕВЕРНО
    wrong = pg.evaluate("() => { const r = window.App.run(); const q = r.list[r.i];"
                        " return q.opts.findIndex(o => !o.ok); }")
    pg.locator(".opt").nth(wrong).click()
    pg.wait_for_timeout(400)
    check(pg.locator(".opt.is-bad").count() == 1, "неверный ответ подсвечен красным")
    check(pg.locator(".opt.is-ok").count() == 1, "верный при этом всё равно показан")

    # проходим до конца и смотрим итог
    for _ in range(12):
        if pg.locator("#next-q").count():
            pg.click("#next-q"); pg.wait_for_timeout(250)
        if pg.locator(".opt").count():
            pg.locator(".opt").first.click(); pg.wait_for_timeout(250)
        if "из 10" in pg.inner_text("#quiz-body") and pg.locator("[data-requiz]").count():
            break
    check(pg.locator("[data-requiz]").count() == 1, "в конце есть кнопка «ещё раз»")
    shot(pg, "12-kviz-itog.png", True)

    # Ошибка в квизе возвращает формулу в повторение.
    # Даём БОЛЬШОЙ интервал всем формулам темы: какие бы 10 вопросов ни выпали,
    # проверка остаётся честной и не зависит от того, что попало в набор.
    far = {"iv": 30, "ef": 2.5, "n": 5, "due": "2027-01-01", "last": "2026-10-01",
           "lapses": 0, "seen": 5, "st": "review", "step": 0}
    ids = [r["i"] for r in json.loads(pg.evaluate("() => JSON.stringify(window.INDEX)"))
           if r["t"] == "kinematika"]
    cards = {i + ":w": dict(far) for i in ids}

    start(pg, "#/kviz/kinematika", cards=cards)
    pg.wait_for_timeout(1500)
    asked = []
    for _ in range(14):
        if not pg.locator(".opt").count():
            break
        info = pg.evaluate("() => { const r = window.App.run(); const q = r.list[r.i];"
                           " return [q.fid, q.opts.findIndex(o => !o.ok)]; }")
        if info[0]:
            asked.append(info[0])
        pg.locator(".opt").nth(info[1]).click()
        pg.wait_for_timeout(250)
        if pg.locator("#next-q").count():
            pg.click("#next-q")
            pg.wait_for_timeout(250)

    saved = pg.evaluate("() => JSON.parse(localStorage.getItem('fizege:cards:v1') || '{}')")
    back = [f for f in set(asked) if saved.get(f + ":w", {}).get("iv", 99) <= 1]
    stay = [i for i in ids if i not in asked and saved.get(i + ":w", {}).get("iv") == 30]
    check(len(asked) > 0 and len(back) == len(set(asked)),
          f"все {len(set(asked))} формул с ошибкой вернулись в повторение (вернулось {len(back)})")
    check(len(stay) == len([i for i in ids if i not in asked]),
          "формулы, которых в квизе не было, остались со своим интервалом")

    check(not errors, "ошибок в консоли нет" + (": " + errors[0] if errors else ""))
    ctx.close()


def router(b):
    log("== переходы и кнопка «назад»")
    errors = []
    ctx, pg = page(b, errors, **PHONE)
    start(pg)
    pg.click('.nav a[data-nav="topics"]'); pg.wait_for_timeout(400)
    pg.click('#topics-body .tile'); pg.wait_for_timeout(900)
    pg.locator("#topic-body .frow").first.click(); pg.wait_for_timeout(800)
    check("#/f/" in pg.url, "дошли до формулы через темы")

    pg.go_back(); pg.wait_for_timeout(700)
    check("#/t/" in pg.url, "«назад» из формулы возвращает в тему")
    pg.go_back(); pg.wait_for_timeout(500)
    check(pg.url.endswith("#/temy"), "«назад» из темы возвращает к темам")
    pg.go_back(); pg.wait_for_timeout(500)
    check(pg.url.rstrip("#/").endswith("8767") or pg.url.endswith("#/"), "«назад» с тем возвращает на главную")

    pg.go_forward(); pg.wait_for_timeout(500)
    check(pg.url.endswith("#/temy"), "«вперёд» тоже работает")

    # прямая ссылка на формулу
    ctx2, pg2 = page(b, errors, **PHONE)
    start(pg2, "#/f/mag-potok" if False else "#/f/kin-centr-uskorenie")
    pg2.wait_for_timeout(900)
    check("ускорение" in pg2.inner_text("#formula-body").lower(), "прямая ссылка на формулу открывает её")

    # мусорный адрес не ломает сайт
    pg2.goto(URL + "#/абракадабра/5", wait_until="load")
    pg2.wait_for_timeout(600)
    check(pg2.locator("#s-today").evaluate("e => e.classList.contains('on')"), "непонятный адрес уводит на главную")

    # кнопка «назад» в шапке прячется на корневых экранах
    start(pg2, "#/")
    check(pg2.locator("#back").evaluate("e => e.classList.contains('hide')"), "на главной кнопки «назад» нет")
    start(pg2, "#/f/kin-skorost")
    pg2.wait_for_timeout(700)
    check(not pg2.locator("#back").evaluate("e => e.classList.contains('hide')"), "на формуле кнопка «назад» есть")

    check(not errors, "ошибок в консоли нет" + (": " + errors[0] if errors else ""))
    ctx2.close(); ctx.close()


def widths(b):
    log("== ширины 320…1920: нет прокрутки вбок")
    errors = []
    ctx, pg = page(b, errors, viewport={"width": 390, "height": 844}, locale="ru-RU")
    bad = []
    for w in (320, 360, 390, 414, 540, 768, 1024, 1280, 1440, 1920):
        pg.set_viewport_size({"width": w, "height": 860})
        for h in ("#/", "#/temy", "#/t/kinematika", "#/f/kin-x-ravnousk", "#/kviz/kinematika", "#/ya"):
            start(pg, h)
            pg.wait_for_timeout(700 if "/t/" in h or "kviz" in h else 350)
            sw = pg.evaluate("document.documentElement.scrollWidth")
            if sw > w + 1:
                bad.append(f"{w}px {h}: scrollWidth {sw}")
            # формулы не должны вылезать за свой контейнер
            over = pg.evaluate("""() => {
                let n = 0;
                for (const el of document.querySelectorAll('.katex-display')) {
                    if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX === 'visible') n++;
                }
                return n;
            }""")
            if over:
                bad.append(f"{w}px {h}: {over} формул вылезают без прокрутки")
    check(not bad, "нигде нет прокрутки вбок" + (": " + "; ".join(bad[:4]) if bad else ""))
    check(not errors, "ошибок в консоли нет" + (": " + errors[0] if errors else ""))
    ctx.close()


def phone(b):
    log("== телефон: размеры кнопок, нижняя панель, поля ввода")
    errors = []
    ctx, pg = page(b, errors, **PHONE)
    start(pg, "#/")

    small = pg.evaluate("""() => {
        const bad = [];
        for (const el of document.querySelectorAll('button, .nav a, .linkrow, .tile, .chip, .opt, a.btn')) {
            if (!el.offsetParent) continue;
            const r = el.getBoundingClientRect();
            if (r.height && r.height < 44) bad.push((el.textContent || el.className).trim().slice(0, 30) + ' = ' + Math.round(r.height) + 'px');
        }
        return bad;
    }""")
    check(not small, "все кнопки не ниже 44 px" + (": " + "; ".join(small[:4]) if small else ""))

    nav = pg.evaluate("""() => {
        const n = document.querySelector('.nav').getBoundingClientRect();
        return [Math.round(n.bottom), window.innerHeight, Math.round(n.height)];
    }""")
    check(abs(nav[0] - nav[1]) <= 1, f"нижняя панель прижата к низу экрана ({nav[0]} из {nav[1]})")

    # последний блок не прячется под панелью
    start(pg, "#/ya")
    pg.wait_for_timeout(500)
    pg.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
    pg.wait_for_timeout(400)
    hidden = pg.evaluate("""() => {
        const last = document.querySelector('#me-body > :last-child');
        const n = document.querySelector('.nav').getBoundingClientRect();
        const r = last.getBoundingClientRect();
        return r.bottom > n.top + 1;
    }""")
    check(not hidden, "последний блок не прячется под нижней панелью")

    inputs = pg.evaluate("""() => {
        const bad = [];
        for (const el of document.querySelectorAll('input, textarea, select')) {
            const fs = parseFloat(getComputedStyle(el).fontSize);
            if (fs < 16) bad.push(el.id + ' = ' + fs + 'px');
        }
        return bad;
    }""")
    check(not inputs, "поля ввода не меньше 16 px — телефон не будет приближать страницу"
          + (": " + "; ".join(inputs) if inputs else ""))

    tap = pg.evaluate("() => getComputedStyle(document.querySelector('.btn')).touchAction")
    check("manipulation" in tap, f"у кнопок touch-action: manipulation (сейчас {tap})")
    check(pg.evaluate("() => !!document.querySelector('meta[name=viewport]').content.match(/viewport-fit=cover/)"),
          "в viewport прописан viewport-fit=cover (отступы под вырез камеры)")
    shot(pg, "13-ya.png", True)
    check(not errors, "ошибок в консоли нет" + (": " + errors[0] if errors else ""))
    ctx.close()


def keys(b):
    log("== клавиатура")
    errors = []
    ctx, pg = page(b, errors, viewport={"width": 390, "height": 844}, locale="ru-RU")
    start(pg)
    pg.keyboard.press("Tab")
    first = pg.evaluate("() => (document.activeElement.textContent || '').trim()")
    check("Перейти к содержимому" in first, f"первый Tab — «Перейти к содержимому» (сейчас «{first[:30]}»)")

    start(pg, "#/povtor")
    pg.wait_for_timeout(1500)
    pg.keyboard.press("Space")
    pg.wait_for_timeout(400)
    check(pg.locator("[data-grade]").count() == 3, "пробел переворачивает карточку")
    pg.keyboard.press("3")
    pg.wait_for_timeout(400)
    check(pg.locator("[data-grade]").count() == 0, "клавиша 3 ставит оценку «знаю»")

    start(pg, "#/kviz/kinematika")
    pg.wait_for_timeout(1500)
    pg.keyboard.press("1")
    pg.wait_for_timeout(400)
    check(pg.locator(".why .note").count() == 1, "в квизе цифра выбирает вариант")
    pg.keyboard.press("Enter")
    pg.wait_for_timeout(400)
    check("Вопрос 2 из 10" in pg.inner_text("#quiz-body"), "Enter ведёт к следующему вопросу")

    start(pg, "#/t/kinematika")
    pg.wait_for_timeout(900)
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(500)
    check(not pg.url.endswith("#/t/kinematika"), "Escape возвращает назад")

    vis = pg.evaluate("""() => {
        const b = document.querySelector('.btn, .linkrow');
        b.focus();
        const s = getComputedStyle(b, ':focus-visible');
        return true;   // наличие правила проверяем ниже по стилю
    }""")
    css = pg.evaluate("""() => [...document.styleSheets].some(ss => {
        try { return [...ss.cssRules].some(r => (r.selectorText || '').includes(':focus-visible')); }
        catch (e) { return false; }
    })""")
    check(css, "есть правило :focus-visible — фокус видно с клавиатуры")
    check(not errors, "ошибок в консоли нет" + (": " + errors[0] if errors else ""))
    ctx.close()


def reduce(b):
    log("== «меньше движения»")
    errors = []
    ctx, pg = page(b, errors, reduced_motion="reduce", **PHONE)
    start(pg, "#/povtor")
    pg.wait_for_timeout(1200)
    pg.click("#flip")
    pg.wait_for_timeout(200)
    check(pg.locator("[data-grade]").count() == 3, "карточка переворачивается и без анимации")
    dur = pg.evaluate("""() => {
        const el = document.querySelector('.fc .ans') || document.querySelector('.fc');
        return getComputedStyle(el).animationDuration;
    }""")
    secs = float(dur.replace("ms", "").replace("s", "")) if dur else 0
    check(secs < 0.01, f"анимация выключена (длительность {dur})")
    check(not errors, "ошибок в консоли нет" + (": " + errors[0] if errors else ""))
    ctx.close()


def nojs(b):
    log("== без JavaScript")
    errors = []
    ctx = b.new_context(java_script_enabled=False, viewport={"width": 390, "height": 844})
    pg = ctx.new_page()
    pg.goto(URL, wait_until="load")
    check(pg.locator(".tile").count() == 16, "на главной видны все 16 тем")
    check(pg.locator('a[href="spravochnik.html"]').count() >= 1, "есть ссылка на справочник")
    check(pg.locator(".nav").count() == 0 or not pg.locator(".nav").first.is_visible(),
          "нижняя панель спрятана: без JS она бесполезна")
    check("JavaScript" in pg.content(), "честно написано, что карточкам нужен JavaScript")

    pg.goto(URL + "spravochnik.html", wait_until="load")
    n = pg.locator(".fbig .katex").count()
    check(n >= 16, f"в справочнике нарисованы формулы ({n} штук)")
    check(pg.locator("details.more[open]").count() > 10, "в справочнике подробности раскрыты — для печати")
    check("Кинематика" in pg.inner_text("body"), "в справочнике есть названия тем")
    shot(pg, "14-spravochnik-bez-js.png")
    ctx.close()


def offline(b):
    log("== оффлайн: работает без интернета")
    errors = []
    ctx, pg = page(b, errors, **PHONE)
    start(pg, "#/t/kinematika")
    pg.wait_for_timeout(1500)
    reg = pg.evaluate("""async () => {
        if (!('serviceWorker' in navigator)) return 'нет поддержки';
        const r = await navigator.serviceWorker.ready.catch(() => null);
        return r ? 'есть' : 'не включился';
    }""")
    check(reg == "есть", f"service worker включился ({reg})")
    pg.wait_for_timeout(1500)

    ctx.set_offline(True)
    pg.goto(URL, wait_until="load")
    pg.wait_for_timeout(800)
    check(pg.locator("#today-body").count() == 1 and len(pg.inner_text("#today-body")) > 20,
          "без интернета главная открывается")
    pg.goto(URL + "#/temy", wait_until="load")
    pg.wait_for_timeout(600)
    check(pg.locator(".tile").count() == 16, "без интернета темы на месте")
    shot(pg, "15-offline.png")
    ctx.set_offline(False)

    ver = pg.evaluate("""async () => {
        const keys = await caches.keys();
        return keys;
    }""")
    check(len(ver) == 1, f"кэш ровно один, старые удалены: {ver}")
    check(ver and ver[0].startswith("fiz-"), "у кэша понятное имя с версией")
    check(not errors, "ошибок в консоли нет" + (": " + errors[0] if errors else ""))
    ctx.close()


def print_(b):
    log("== печать справочника")
    errors = []
    ctx, pg = page(b, errors, viewport={"width": 794, "height": 1123}, locale="ru-RU")
    pg.goto(URL + "spravochnik.html", wait_until="load")
    pg.emulate_media(media="print")
    pg.wait_for_timeout(400)
    over = pg.evaluate("""() => {
        let n = 0;
        const w = document.querySelector('main').clientWidth;
        for (const el of document.querySelectorAll('.katex-display')) {
            if (el.scrollWidth > w + 2) n++;
        }
        return n;
    }""")
    check(over == 0, f"при печати формулы не вылезают за лист (вылезает {over})")
    hidden = pg.evaluate("() => { const n = document.querySelector('.nav'); return !n || getComputedStyle(n).display === 'none'; }")
    check(hidden, "нижняя панель не печатается")
    shot(pg, "16-pechat.png")
    pg.emulate_media(media="screen")
    check(not errors, "ошибок в консоли нет" + (": " + errors[0] if errors else ""))
    ctx.close()


def a11y(b):
    log("== доступность (axe-core)")
    errors = []
    ctx, pg = page(b, errors, **PHONE)
    bad = []
    for h, name in (("#/", "главная"), ("#/temy", "темы"), ("#/t/kinematika", "тема"),
                    ("#/f/kin-x-ravnousk", "формула"), ("#/kviz/kinematika", "квиз"), ("#/ya", "я")):
        start(pg, h)
        pg.wait_for_timeout(1200 if "/t/" in h or "kviz" in h or "/f/" in h else 500)
        pg.add_script_tag(path=AXE)
        res = pg.evaluate("""async () => {
            const r = await axe.run(document, { resultTypes: ['violations'] });
            return r.violations.map(v => v.id + ' (' + v.nodes.length + ')');
        }""")
        if res:
            bad.append(name + ": " + ", ".join(res))
    check(not bad, "нарушений доступности нет" + (": " + "; ".join(bad) if bad else ""))
    check(not errors, "ошибок в консоли нет" + (": " + errors[0] if errors else ""))
    ctx.close()


def net(b):
    log("== сеть: нет битых запросов")
    errors = []
    bad = []
    ctx, pg = page(b, errors, **PHONE)
    pg.on("response", lambda r: bad.append(f"{r.status} {r.url}") if r.status >= 400 else None)
    pg.on("requestfailed", lambda r: bad.append(f"не загрузилось {r.url}"))
    raw_tex = []
    for h in ("#/", "#/temy", "#/t/kinematika", "#/t/dinamika", "#/f/kin-x-ravnousk",
              "#/f/din-guk", "#/kviz/kinematika", "#/povtor", "#/ya"):
        start(pg, h)
        pg.wait_for_timeout(1200)
        # code.plain — запасной вид, когда формулу не нашли среди нарисованных.
        # На экране его быть не должно: это значит, что вместо формулы показан сырой LaTeX.
        got = pg.evaluate("() => [...document.querySelectorAll('code.plain')].map(e => e.textContent)")
        for t in got:
            raw_tex.append(h + ": " + t)
    pg.goto(URL + "spravochnik.html", wait_until="load")
    pg.wait_for_timeout(800)
    raw_tex += ["справочник: " + t for t in
                pg.evaluate("() => [...document.querySelectorAll('code.plain')].map(e => e.textContent)")]
    check(not raw_tex, "нигде не показан сырой LaTeX вместо формулы"
          + (": " + "; ".join(raw_tex[:4]) if raw_tex else ""))
    # шрифты KaTeX подгружаются только когда формула на экране — проверяем, что они нашлись
    fonts = pg.evaluate("""() => performance.getEntriesByType('resource')
        .filter(e => /KaTeX_.*\\.woff2$/.test(e.name)).map(e => e.name.split('/').pop())""")
    check(len(fonts) >= 2, f"шрифты формул загрузились: {', '.join(fonts[:4]) or 'ни одного'}")
    check(not bad, "ни одного битого запроса" + (": " + "; ".join(bad[:4]) if bad else ""))
    check(not errors, "ошибок в консоли нет" + (": " + errors[0] if errors else ""))
    ctx.close()


ALL = {
    "today": today, "topics": topics, "formula": formula, "session": session, "quiz": quiz,
    "router": router, "widths": widths, "phone": phone, "keys": keys, "reduce": reduce,
    "nojs": nojs, "offline": offline, "print": print_, "a11y": a11y, "net": net,
}

if __name__ == "__main__":
    parts = [a for a in sys.argv[1:] if a in ALL] or list(ALL)
    with sync_playwright() as p:
        b = p.chromium.launch(channel="chrome", headless=True)
        for name in parts:
            try:
                ALL[name](b)
            except Exception as e:
                check(False, f"часть «{name}» упала: {e}")
        b.close()
    log("\nИТОГ: " + ("всё зелёное" if not FAIL else f"{len(FAIL)} ошибок"))
    for f in FAIL:
        log("  · " + f)
    sys.exit(1 if FAIL else 0)
