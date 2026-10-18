"""Достаёт из PDF кодификатора ФИПИ официальную таблицу элементов содержания.

Делает два файла:
  review/fipi/kodifikator.txt  — весь текст, чтобы искать глазами;
  site/data/elementy.js        — таблица «код → название темы и уровень».
По ней проверка tests/unit.js убеждается, что код у каждой карточки настоящий,
и показывает, какие элементы кодификатора ещё не покрыты формулами.

Запуск (из папки fizika_ege):
    $env:NO_PROXY='*'
    & "C:\\Users\\User\\Desktop\\claude\\y2k_bot\\.venv\\Scripts\\python.exe" tools/kodifikator.py

ВАЖНО: сами ФОРМУЛЫ из PDF вытащить нельзя — они выходят искажёнными
(формула линзы превращается в «Ffd 111»). Отсюда берём только коды,
названия тем и уровни, а формулы набираются руками.
"""
import json
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF = os.path.join(ROOT, "review", "fipi", "kodifikator-2026.pdf")
TXT = os.path.join(ROOT, "review", "fipi", "kodifikator.txt")
OUT = os.path.join(ROOT, "site", "data", "elementy.js")

# строки-колонтитулы, которые надо выбросить
JUNK = re.compile(
    r"^\s*(Кодификатор КИМ ЕГЭ|©\s*20\d\d|Код\s*$|раздела/|темы\s*$|элемента\s*$"
    r"|Проверяемый элемент|Уровень\s*$|программы\s*$|Наличие данного|элемента\s*$"
    r"|содержания\s*$|в кодификаторе|ЕГЭ прошлых лет)"
)

SECTION = re.compile(r"^\s*(\d)\s+([А-ЯЁ][А-ЯЁ .,\u00ab\u00bb-]{3,70})\s*$")
TOPIC = re.compile(r"^\s*(\d\.\d)\s+([А-ЯЁ][А-ЯЁ .,\u00ab\u00bb-]{3,70})\s*$")
ELEMENT = re.compile(r"^\s*(\d\.\d\.\d{1,2})\s+(.*)$")


def read_pdf():
    from pypdf import PdfReader

    r = PdfReader(PDF)
    return "\n".join((p.extract_text() or "") for p in r.pages), len(r.pages)


def clean_title(s):
    """Первая осмысленная фраза элемента — его название."""
    s = s.strip()
    s = re.split(r"[:.]\s|\s{2,}", s)[0]
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"\s*(БУ|УУ)\s*,?\s*(БУ|УУ)?\s*\+?\s*$", "", s)
    return s.strip(" .,:;-")[:120]


def main():
    if not os.path.exists(PDF):
        print("ОШИБКА: нет файла", PDF)
        print("Скачай его: curl -L -o review/fipi/kodifikator-2026.pdf <адрес из HISTORY.md>")
        return 1

    text, pages = read_pdf()
    with open(TXT, "w", encoding="utf-8") as f:
        f.write(text)
    print(f"  ok   прочитано {pages} страниц → {os.path.relpath(TXT, ROOT)}")

    # работаем только со вторым разделом: «Перечень элементов содержания»
    start = text.find("Перечень элементов содержания", 2000)
    if start < 0:
        print("  ОШИБКА не нашёл раздел 2 кодификатора")
        return 1
    body = text[start:]

    lines = [ln for ln in body.split("\n") if not JUNK.match(ln)]

    sections, topics, elements = {}, {}, []
    sec = top = ""
    cur = None

    for ln in lines:
        m = SECTION.match(ln)
        if m:
            sec = m.group(1)
            sections[sec] = m.group(2).strip().rstrip(".")
            cur = None
            continue
        m = TOPIC.match(ln)
        if m:
            top = m.group(1)
            topics[top] = m.group(2).strip().rstrip(".")
            cur = None
            continue
        m = ELEMENT.match(ln)
        if m:
            cur = {"code": m.group(1), "topic": top, "section": sec,
                   "title": clean_title(m.group(2)), "level": "", "raw": m.group(2)}
            elements.append(cur)
            continue
        if cur is not None:
            cur["raw"] += " " + ln.strip()

    # уровень: «БУ, УУ» — базовый, одно «УУ» — только углублённый
    for e in elements:
        tail = e["raw"]
        e["level"] = "БУ" if re.search(r"\bБУ\b", tail) else ("УУ" if re.search(r"\bУУ\b", tail) else "?")
        if not e["title"]:
            e["title"] = clean_title(tail)
        del e["raw"]

    # убираем случайные повторы кодов, сохраняя порядок
    seen, uniq = set(), []
    for e in elements:
        if e["code"] in seen:
            continue
        seen.add(e["code"])
        uniq.append(e)

    bad = [e["code"] for e in uniq if e["level"] == "?"]
    print(f"  ok   разделов {len(sections)}, тем {len(topics)}, элементов {len(uniq)}")
    if bad:
        print(f"  ! у {len(bad)} элементов не определился уровень: {', '.join(bad[:8])}")

    head = (
        "// Официальная таблица элементов содержания кодификатора ЕГЭ по физике 2026 (ФИПИ).\n"
        "// ЭТОТ ФАЙЛ ДЕЛАЕТ tools/kodifikator.py из review/fipi/kodifikator-2026.pdf — руками не править.\n"
        "// Формул здесь нет: из PDF они выходят искажёнными, поэтому формулы набираются руками.\n"
    )
    data = {"sections": sections, "topics": topics, "elements": uniq}
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(head + "window.ELEMENTY = " + json.dumps(data, ensure_ascii=False, indent=0) + ";\n")
    print(f"  ok   записано {os.path.relpath(OUT, ROOT)}")

    for code in sorted(topics, key=lambda s: [int(x) for x in s.split(".")]):
        n = sum(1 for e in uniq if e["topic"] == code)
        print(f"       {code}  {topics[code]:<42} {n} элементов")
    return 0


if __name__ == "__main__":
    sys.exit(main())
