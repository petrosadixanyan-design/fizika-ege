"""Проверка ЖИВОГО сайта на GitHub Pages (а не локального).

Запуск: $env:NO_PROXY='*'
        & "C:\\Users\\User\\Desktop\\claude\\y2k_bot\\.venv\\Scripts\\python.exe" tests/live.py
        ... tests/live.py https://другой-адрес/   — проверить другой адрес

Смотрит глазами телефона: открывается ли, рисуются ли формулы, грузятся ли данные тем,
включается ли оффлайн, нет ли битых запросов. Нужна после каждой выкладки.
"""
import sys
import time

sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "https://petrosadixanyan-design.github.io/fizika-ege/"
FAIL = []


def check(ok, msg):
    print(("  ok   " if ok else "  ОШИБКА ") + msg, flush=True)
    if not ok:
        FAIL.append(msg)


def main():
    print(f"Проверяю {URL}\n")
    errors, bad = [], []
    with sync_playwright() as p:
        b = p.chromium.launch(channel="chrome", headless=True)
        ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=3,
                            is_mobile=True, has_touch=True, locale="ru-RU")
        pg = ctx.new_page()
        pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.on("response", lambda r: bad.append(f"{r.status} {r.url}") if r.status >= 400 else None)
        pg.on("requestfailed", lambda r: bad.append(f"не загрузилось {r.url}"))

        t0 = time.time()
        pg.goto(URL, wait_until="load")
        load = time.time() - t0
        check(load < 6, f"страница загрузилась за {load:.1f} с")
        check("Формулы" in pg.title(), f"заголовок: {pg.title()}")
        check(pg.locator("#hello-ok").count() == 1 or pg.locator("#start-ses").count() == 1,
              "первый экран показался")

        if pg.locator("#hello-ok").count():
            pg.click("#hello-ok")
            pg.wait_for_timeout(500)
        check("До ЕГЭ" in pg.inner_text("#today-body"), "главный экран собрался")

        pg.goto(URL + "#/temy", wait_until="load")
        pg.wait_for_timeout(600)
        check(pg.locator(".tile").count() == 16, f"тем на экране: {pg.locator('.tile').count()}")

        pg.goto(URL + "#/t/kinematika", wait_until="load")
        pg.wait_for_timeout(1800)
        n = pg.locator("#topic-body .frow").count()
        check(n == 21, f"данные темы догрузились: карточек {n}")
        check(pg.locator("#topic-body .katex").count() > 10, "формулы в списке нарисованы")

        pg.goto(URL + "#/f/kin-x-ravnousk", wait_until="load")
        pg.wait_for_timeout(1500)
        check(pg.locator("#formula-body .fbig .katex").count() == 1, "формула нарисована крупно")
        check(pg.locator("code.plain").count() == 0, "нигде нет сырого LaTeX вместо формулы")
        fonts = pg.evaluate("""() => performance.getEntriesByType('resource')
            .filter(e => /KaTeX_.*\\.woff2$/.test(e.name)).length""")
        check(fonts >= 2, f"шрифты формул пришли: {fonts}")

        pg.goto(URL + "spravochnik.html", wait_until="load")
        pg.wait_for_timeout(800)
        check(pg.locator(".fbig .katex").count() >= 25, "шпаргалка собралась")

        # оффлайн
        pg.goto(URL, wait_until="load")
        sw = pg.evaluate("""async () => {
            if (!('serviceWorker' in navigator)) return 'нет поддержки';
            const r = await navigator.serviceWorker.ready.catch(() => null);
            return r ? 'есть' : 'не включился';
        }""")
        check(sw == "есть", f"оффлайн включился ({sw})")
        pg.wait_for_timeout(2500)
        ctx.set_offline(True)
        pg.goto(URL, wait_until="load")
        pg.wait_for_timeout(800)
        check(len(pg.inner_text("#today-body")) > 20, "без интернета сайт открывается")
        ctx.set_offline(False)

        check(not bad, "нет битых запросов" + (": " + "; ".join(bad[:4]) if bad else ""))
        check(not errors, "нет ошибок в консоли" + (": " + errors[0] if errors else ""))
        b.close()

    print("\nИТОГ: " + ("живой сайт работает" if not FAIL else f"{len(FAIL)} ошибок"))
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
