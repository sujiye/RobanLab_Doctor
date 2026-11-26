#!/usr/bin/env python3
"""把官方 PDF 的图片页渲染成 PNG，便于用 read_image 查看，并被 Markdown 引用。

此前只渲染「文本层很薄」的页（195 页里 107 页），导致 77 页含图但无 PNG，
INDEX.md 也据此写错为「共 183 页」。现在默认渲染所有含图页。

用法:
  python3 tools/render_manual_pages.py                  # 渲染所有含图页（默认）
  python3 tools/render_manual_pages.py --thin-only      # 只渲染文本层很薄的页
  python3 tools/render_manual_pages.py --all            # 渲染全部页
  python3 tools/render_manual_pages.py --dpi 150
输出:
  knowledge/manuals/figures/<slug>-p<NN>.png
  knowledge/manuals/pages.json   (每页: 文本字符数 / 是否有图 / 渲染路径 / 是否需看图)
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
    ap.add_argument("--min-chars", type=int, default=160,
                    help="文本层低于此值视为「需看图」（默认 160）")
    ap.add_argument("--dpi", type=int, default=150)
    ap.add_argument("--all", action="store_true", help="渲染所有页")
    ap.add_argument("--thin-only", action="store_true",
                    help="只渲染文本层薄的页（旧行为）")
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
            thin = len(text) < args.min_chars

            if args.all:
                want = True
            elif args.thin_only:
                want = thin
            else:
                # 默认：文本薄 或 含图 的页都渲染，保证 md 里的图片引用不悬空
                want = thin or has_images

            figure = None
            if want:
                out = FIG_DIR / f"{s}-p{i:02d}.png"
                pix = page.get_pixmap(dpi=args.dpi)
                pix.save(out)
                figure = f"knowledge/manuals/figures/{out.name}"
                rendered += 1
            index.append({
                "doc": pdf.name,
                "slug": s,
                "page": i,
                "chars": len(text),
                "hasImages": has_images,
                "needsLook": thin,
                "figure": figure,
                "preview": text[:120],
            })
    (ROOT / "knowledge" / "manuals" / "pages.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"rendered {rendered} pages -> {FIG_DIR}")
    print(f"index -> knowledge/manuals/pages.json ({len(index)} pages)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
