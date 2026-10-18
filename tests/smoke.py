"""Быстрая проверка в настоящем браузере: нет ли ошибок и рисуются ли экраны.

Сервер: python -m http.server 8767 --bind 127.0.0.1  (в папке site/)
Запуск: & "C:\\Users\\User\\Desktop\\claude\\y2k_bot\\.venv\\Scripts\\python.exe" tests/smoke.py
Это помощник для разработки; полная проверка — tests/check.py.
"""
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8767/"
SHOTS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "review", "shots")
os.makedirs(SHOTS, exist_ok=True)


def main():
    errors = []
    bad_net = []
    with sync_playwright() as p:
        b = p.chromium.launch(channel="chrome", headless=True)
        ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=3,
                            is_mobile=True, has_touch=True, locale="ru-RU")
        pg = ctx.new_page()
        pg.on("console", lambda m: errors.append("консоль: " + m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errors.append("ошибка JS: " + str(e)))
        pg.on("response", lambda r: bad_net.append(f"{r.status} {r.url}") if r.status >= 400 else None)

        pg.goto(URL, wait_until="load")
        pg.wait_for_timeout(600)

        print("заголовок:", pg.title())
        print("первый экран:", (pg.inner_text("#today-body") or "")[:200].replace("\n", " | "))
        pg.screenshot(path=os.path.join(SHOTS, "01-privet.png"))

        # первый запуск: ставим дату ЕГЭ
        if pg.locator("#hello-ok").count():
            pg.click("#hello-ok")
            pg.wait_for_timeout(400)
        print("\nСегодня:", (pg.inner_text("#today-body") or "")[:400].replace("\n", " | "))
        pg.screenshot(path=os.path.join(SHOTS, "02-segodnya.png"))

        # темы
        pg.click('.nav a[data-nav="topics"]')
        pg.wait_for_timeout(500)
        print("\nтем на экране:", pg.locator("#topics-body .tile").count())
        pg.screenshot(path=os.path.join(SHOTS, "03-temy.png"), full_page=True)

        # тема кинематика
        pg.goto(URL + "#/t/kinematika", wait_until="load")
        pg.wait_for_timeout(900)
        print("формул в теме:", pg.locator("#topic-body .frow").count())
        pg.screenshot(path=os.path.join(SHOTS, "04-tema.png"), full_page=True)

        # одна формула
        pg.goto(URL + "#/f/kin-x-ravnousk", wait_until="load")
        pg.wait_for_timeout(900)
        print("формула видна:", pg.locator("#formula-body .fbig .katex").count() > 0)
        print("букв разобрано:", pg.locator("#formula-body .vbtn").count())
        pg.screenshot(path=os.path.join(SHOTS, "05-formula.png"), full_page=True)
        # нажать на букву
        pg.locator("#formula-body .vbtn").nth(2).click()
        pg.wait_for_timeout(300)
        print("подсвечено частей формулы:", pg.locator("#formula-body .fbig .lit").count())
        pg.screenshot(path=os.path.join(SHOTS, "06-bukva.png"))

        # повторение
        pg.goto(URL + "#/povtor", wait_until="load")
        pg.wait_for_timeout(1500)
        print("\nкарточка:", (pg.inner_text("#session-body") or "")[:160].replace("\n", " | "))
        pg.screenshot(path=os.path.join(SHOTS, "07-karta-vopros.png"))
        if pg.locator("#flip").count():
            pg.click("#flip")
            pg.wait_for_timeout(400)
            print("кнопок оценки:", pg.locator("[data-grade]").count())
            pg.screenshot(path=os.path.join(SHOTS, "08-karta-otvet.png"))
            pg.click('[data-grade="know"]')
            pg.wait_for_timeout(400)
            print("после ответа:", (pg.inner_text("#session-body") or "")[:120].replace("\n", " | "))

        # квиз
        pg.goto(URL + "#/kviz/kinematika", wait_until="load")
        pg.wait_for_timeout(1500)
        print("\nвопрос:", (pg.inner_text(".qz .q") or "")[:140])
        print("вариантов:", pg.locator(".opt").count())
        pg.screenshot(path=os.path.join(SHOTS, "09-kviz.png"), full_page=True)
        pg.locator(".opt").first.click()
        pg.wait_for_timeout(400)
        print("пояснение:", (pg.inner_text(".why") or "")[:140].replace("\n", " | "))
        pg.screenshot(path=os.path.join(SHOTS, "10-kviz-otvet.png"), full_page=True)

        # я
        pg.goto(URL + "#/ya", wait_until="load")
        pg.wait_for_timeout(700)
        print("\nЯ:", (pg.inner_text("#me-body") or "")[:200].replace("\n", " | "))
        pg.screenshot(path=os.path.join(SHOTS, "11-ya.png"), full_page=True)

        # горизонтальная прокрутка
        for w in (320, 360, 390, 768, 1440):
            pg.set_viewport_size({"width": w, "height": 800})
            pg.wait_for_timeout(250)
            sw = pg.evaluate("document.documentElement.scrollWidth")
            print(f"ширина {w}: scrollWidth {sw}", "ОК" if sw <= w else "ВЫЛЕЗАЕТ")

        # справочник без JS
        ctx2 = b.new_context(java_script_enabled=False, viewport={"width": 390, "height": 844})
        pg2 = ctx2.new_page()
        pg2.goto(URL + "spravochnik.html", wait_until="load")
        print("\nбез JS, шпаргалка: формул на странице", pg2.locator(".fbig .katex").count())
        pg2.screenshot(path=os.path.join(SHOTS, "12-spravochnik-bez-js.png"))
        pg3 = ctx2.new_page()
        pg3.goto(URL, wait_until="load")
        print("без JS, главная: плиток тем", pg3.locator(".tile").count())
        ctx2.close()
        ctx.close()
        b.close()

    print("\nошибки:", "нет" if not errors else errors[:6])
    print("плохие ответы сети:", "нет" if not bad_net else bad_net[:6])
    print("скриншоты:", SHOTS)
    return 1 if errors or bad_net else 0


if __name__ == "__main__":
    sys.exit(main())
