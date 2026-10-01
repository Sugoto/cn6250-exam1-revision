"""Extract questions, answers, reasoning and figures from the module PDFs into data.js.

Usage: python tools/extract.py <dir-with-pdfs>
Requires: pymupdf
"""
import hashlib
import json
import re
import sys
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent.parent
IMG_DIR = ROOT / "img"
RIGHT_EDGE = 470  # a line ending left of this x ends a paragraph


def line_text(line):
    return "".join(s["text"] for s in line["spans"])


def parse(pdf_path, module_no):
    doc = pymupdf.open(pdf_path)
    lesson, section, questions = "", "", []
    q, field = None, None
    prev_x1 = None

    def add_text(target, text, x1):
        nonlocal prev_x1
        text = text.strip()
        if not text:
            return
        if q[target] and prev_x1 is not None and prev_x1 < RIGHT_EDGE:
            q[target] += "\n" + text
        elif q[target]:
            q[target] += ("" if q[target].endswith("-") else " ") + text
        else:
            q[target] = text
        prev_x1 = x1

    for page in doc:
        blocks = sorted(page.get_text("dict")["blocks"], key=lambda b: (b["bbox"][1], b["bbox"][0]))
        for b in blocks:
            if b["type"] == 1:
                if q is None:
                    continue
                name = hashlib.sha1(b["image"]).hexdigest()[:12] + "." + b["ext"]
                (IMG_DIR / name).write_bytes(b["image"])
                q["figures"].append({"src": f"img/{name}", "caption": ""})
                continue
            for line in b["lines"]:
                spans = [s for s in line["spans"] if s["text"].strip()]
                if not spans:
                    continue
                text = line_text(line).strip()
                font, size = spans[0]["font"], round(spans[0]["size"])
                x1 = line["bbox"][2]

                if font == "Calibri" and size == 26:
                    continue
                if font == "Cambria-Italic" and size == 11:
                    if text.startswith("Lesson"):
                        lesson = text
                    continue
                if font == "Calibri-Bold" and size == 14:
                    section = text
                    continue
                m = re.match(r"Q(\d+)\.\s*\[(\w+)\]", text)
                if font == "Cambria-Bold" and size == 12 and m:
                    q = {
                        "id": f"m{module_no}q{m.group(1)}",
                        "n": int(m.group(1)),
                        "type": m.group(2),
                        "section": section,
                        "stem": "",
                        "figures": [],
                        "options": [],
                        "answer": "",
                        "why": "",
                    }
                    questions.append(q)
                    field, prev_x1 = "stem", None
                    continue
                if q is None:
                    continue
                if font == "SymbolMT":
                    field = "option"
                    rest = text.lstrip("•").strip()
                    if rest:  # TF options ride on the bullet line
                        q["options"].append({"key": rest, "text": rest})
                    else:
                        q["options"].append({"key": "", "text": ""})
                    continue
                if text.startswith("Correct answer:"):
                    q["answer"] = text.split(":", 1)[1].strip()
                    field = None
                    continue
                if text.startswith("Why:"):
                    field, prev_x1 = "why", None
                    text = text[4:]
                if text.startswith("Figure:") and q["figures"]:
                    q["figures"][-1]["caption"] = re.sub(r"\s*\(Module \d+\)\s*$", "", text[7:].strip())
                    continue

                if field == "option":
                    opt = q["options"][-1]
                    om = re.match(r"([A-D])\.\s+(.*)", text)
                    if not opt["key"] and om:
                        opt["key"], opt["text"] = om.group(1), om.group(2).strip()
                    elif not opt["key"]:
                        opt["key"] = opt["text"] = text
                    else:
                        opt["text"] += ("" if opt["text"].endswith("-") else " ") + text
                elif field in ("stem", "why"):
                    add_text(field, text, x1)

    for q in questions:
        for o in q["options"]:
            o["text"] = o["text"].strip()
        assert q["answer"] in [o["key"] for o in q["options"]], (pdf_path, q["id"], q["answer"], q["options"])
        assert q["why"], q["id"]
    title = lesson.split(":", 1)[1].strip() if ":" in lesson else lesson
    return {"n": module_no, "title": title, "questions": questions}


def main():
    src = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    IMG_DIR.mkdir(exist_ok=True)
    for f in IMG_DIR.iterdir():
        f.unlink()
    modules = [parse(src / f"Module {i} Question Pool.pdf", i) for i in range(1, 7)]
    js = "window.MODULES = " + json.dumps(modules, ensure_ascii=False, indent=1) + ";\n"
    (ROOT / "data.js").write_text(js)
    for m in modules:
        print(m["n"], m["title"], len(m["questions"]), "questions,", sum(len(q["figures"]) for q in m["questions"]), "figures")


if __name__ == "__main__":
    main()
