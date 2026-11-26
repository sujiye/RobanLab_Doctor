#!/usr/bin/env python3
"""把 knowledge/manuals/pdf/*.pdf 抽取成可 grep 的 Markdown 文本（带页码标记）。

用法:
  python3 tools/extract_manuals.py
输出:
  knowledge/manuals/text/<slug>.md
  knowledge/manuals/manifest.json   (每文档: 页数/字符数/关键词/标题线索)
"""

import json
import re
import sys
from pathlib import Path

import fitz  # PyMuPDF

ROOT = Path(__file__).resolve().parent.parent
PDF_DIR = ROOT / "knowledge" / "manuals" / "pdf"
TEXT_DIR = ROOT / "knowledge" / "manuals" / "text"

KEYWORDS = [
    "零点", "舵机", "标定", "自检", "版本", "镜像", "烧写", "开机", "系统",
    "topic", "service", "ros", "BodyHub", "SensorHub", "相机", "激光", "IMU",
    "拆机", "螺丝", "电池", "急停", "故障", "恢复", "SSH", "IP", "升级",
    "关节", " servo", "伺服", "编码器", "超声波", "红外", "陀螺仪",
]


def slug(name: str) -> str:
    s = re.sub(r"\.pdf$", "", name)
    s = re.sub(r"[()\s]+", "-", s)
    return s


def main() -> int:
    TEXT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = []
    for pdf in sorted(PDF_DIR.glob("*.pdf")):
        doc = fitz.open(pdf)
        pages = []
        total_imgs = 0
        for i, page in enumerate(doc, start=1):
            text = page.get_text("text")
            text = re.sub(r"[ \t]+\n", "\n", text)
            text = re.sub(r"\n{3,}", "\n\n", text).strip()
            total_imgs += len(page.get_images())
            pages.append({"page": i, "text": text})
        out = TEXT_DIR / f"{slug(pdf.name)}.md"
        lines = [
            f"# 官方文档文本抽取：{pdf.name}",
            "",
            f"- 源文件: `knowledge/manuals/pdf/{pdf.name}`",
            f"- 页数: {len(pages)} · 图片对象: {total_imgs}",
            f"- 抽取工具: PyMuPDF {fitz.__version__}（文本层抽取；纯图片页可能为空，"
            "需要看图时打开源 PDF）",
            "",
            "## 页码约定",
            "",
            "下文每页以 `<!-- page N -->` 标记。引用文档时写「《文档名》 p.N」。",
            "",
        ]
        for p in pages:
            lines.append(f"<!-- page {p['page']} -->")
            lines.append("")
            lines.append(p["text"] or "(本页无可抽取文本，可能是纯图片页)")
            lines.append("")
        out.write_text("\n".join(lines), encoding="utf-8")

        full = "".join(p["text"] for p in pages)
        hits = sorted({k for k in KEYWORDS if k.lower() in full.lower()})
        manifest.append({
            "file": f"knowledge/manuals/pdf/{pdf.name}",
            "textFile": f"knowledge/manuals/text/{slug(pdf.name)}.md",
            "title": pdf.name.replace(".pdf", ""),
            "pages": len(pages),
            "chars": len(full),
            "images": total_imgs,
            "keywords": hits,
            "firstLines": pages[0]["text"][:200].replace("\n", " ") if pages else "",
        })
    (ROOT / "knowledge" / "manuals" / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    for m in manifest:
        print(f"{m['textFile']}  pages={m['pages']} chars={m['chars']} imgs={m['images']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
