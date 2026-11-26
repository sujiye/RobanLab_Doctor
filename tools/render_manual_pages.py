#!/usr/bin/env python3
"""把官方 PDF 中「文本层很薄」的页渲染成 PNG，便于代理用 read_image 查看。

用法:
  python3 tools/render_manual_pages.py [--min-chars 160] [--dpi 150]
输出:
  knowledge/manuals/figures/<slug>-p<NN>.png
  knowledge/manuals/pages.json   (每页: 文本字符数 / 是否有图 / 渲染路径)
"""

import argparse
import json
import re
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parent.parent
PDF_DIR = ROOT / "knowledge" / "manuals" / "pdf"
FIG_DIR = ROOT / "knowledge" / "manuals" / "figures"


def slug(name: str) -> str:
    s = re.sub(r"\.pdf$", "", name)
    return re.sub(r"[()\s]+", "-", s)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-chars", type=int, default=160)
    ap.add_argument("--dpi", type=int, default=150)
    ap.add_argument("--all", action="store_true", help="渲染所有页（默认只渲染文本薄的页）")
    args = ap.parse_args()

    FIG_DIR.mkdir(parents=True, exist_ok=True)
    index = []
    rendered = 0
    for pdf in sorted(PDF_DIR.glob("*.pdf")):
        doc = fitz.open(pdf)
        s = slug(pdf.name)
        for i, page in enumerate(doc, start=1):
            text = re.sub(r"\s+", " ", page.get_text("text")).strip()
            has_images = bool(page.get_images())
            entry = {
                "doc": pdf.name,
                "slug": s,
                "page": i,
                "chars": len(text),
                "hasImages": has_images,
                "preview": text[:120],
                "figure": None,
            }
            if args.all or len(text) < args.min_chars:
                out = FIG_DIR / f"{s}-p{i:02d}.png"
                pix = page.get_pixmap(dpi=args.dpi)
                pix.save(out)
                entry["figure"] = f"knowledge/manuals/figures/{out.name}"
                rendered += 1
            index.append(entry)
    (ROOT / "knowledge" / "manuals" / "pages.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"rendered {rendered} pages -> {FIG_DIR}")
    print(f"index -> knowledge/manuals/pages.json ({len(index)} pages)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
