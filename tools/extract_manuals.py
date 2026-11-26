#!/usr/bin/env python3
"""把 knowledge/manuals/pdf/*.pdf 抽取成可读、可 grep 的 Markdown（带页码标记）。

与「整页文本倾倒」不同，这里按字体大小/加粗推断标题层级，规范化项目符号与
编号列表，识别终端命令/代码行输出为代码块，并在纯图片页插入指向已渲染 PNG
的图片引用，使 Markdown 自身即可替代 PDF 阅读。

用法:
  python3 tools/extract_manuals.py                # 转换全部 PDF
  python3 tools/extract_manuals.py --only 自检     # 只转换文件名含该片段的文档
输出:
  knowledge/manuals/text/<slug>.md
  knowledge/manuals/manifest.json   (每文档: 页数/字符数/关键词/标题/图片页)
"""

import argparse
import json
import re
import sys
from pathlib import Path

import fitz  # PyMuPDF

ROOT = Path(__file__).resolve().parent.parent
PDF_DIR = ROOT / "knowledge" / "manuals" / "pdf"
TEXT_DIR = ROOT / "knowledge" / "manuals" / "text"
FIG_DIR_REL = "knowledge/manuals/figures"

KEYWORDS = [
    "零点", "舵机", "标定", "自检", "版本", "镜像", "烧写", "开机", "系统",
    "topic", "service", "ros", "BodyHub", "SensorHub", "相机", "激光", "IMU",
    "拆机", "螺丝", "电池", "急停", "故障", "恢复", "SSH", "IP", "升级",
    "关节", " servo", "伺服", "编码器", "超声波", "红外", "陀螺仪",
]

# 文本层字符数低于此值的页视为「图片页」，需要读 PNG。
IMAGE_PAGE_CHARS = 160

# 页眉页脚噪声：形如 "3 / 3"、"2023/7/7"、"xxx.md 2023/7/7"
NOISE_PATTERNS = [
    re.compile(r"^\d+\s*/\s*\d+$"),
    re.compile(r"^\d{4}/\d{1,2}/\d{1,2}$"),
    re.compile(r"\.md\s+\d{4}/\d{1,2}/\d{1,2}$"),
]

# 行首项目符号（PDF 里常被抽成孤立的一行 "·"）
BULLET_RE = re.compile(r"^[·•●○▪■◦\-\u2022]")
NUMBERED_RE = re.compile(r"^(\d{1,2})\s*[.、)]\s*")
# 形如 "1.  /chin_camera/image [sensor_msgs/Image]" 的条目
CMD_RE = re.compile(r"^[a-z0-9_.\-]+(\s+[a-z0-9_.\-]+)*$")


def slug(name: str) -> str:
    s = re.sub(r"\.pdf$", "", name)
    return re.sub(r"[()\s]+", "-", s)


def is_noise(line: str) -> bool:
    t = line.strip()
    if not t:
        return False
    return any(p.search(t) for p in NOISE_PATTERNS)


def collect_blocks(page) -> list[dict]:
    """把页面拆成带字号/粗细的文本块，供标题推断使用。"""
    out = []
    raw_lines: list[str] = []
    for b in page.get_text("dict")["blocks"]:
        if b.get("type") != 0:
            continue
        for line in b["lines"]:
            spans = line["spans"]
            if not spans:
                continue
            text = "".join(s["text"] for s in spans)
            raw_lines.append(text.strip())
            if not text.strip() or is_noise(text):
                continue
            size = max(s["size"] for s in spans)
            bold = any(
                ("Bold" in s["font"]) or (s["flags"] & 16) for s in spans
            )
            out.append({"text": text.strip(), "size": round(size, 1), "bold": bold})
    # 去掉页眉重复行：形如 "<文档名>.md" 的运行页眉
    header_like = [l for l in raw_lines if re.search(r"\.md$", l or "")]
    if header_like:
        hdr = header_like[0]
        out = [b for b in out if b["text"] != hdr]
    return out


def detect_heading(blocks: list[dict]) -> tuple[float, float]:
    """用字号中位数估计正文基准字号，返回 (body_size, title_size)。

    用中位数而非众数：页码/页眉这类小字常常行数最多，会把基准拉偏。
    """
    sizes = sorted(b["size"] for b in blocks) or [10.0]
    body = sizes[len(sizes) // 2]
    title = sizes[-1]
    return body, title


def heading_level(block: dict, body: float, title: float) -> int:
    """0 = 正文，1/2/3 = 各级标题。

    相对正文放大：>=7pt 且为最大字号 → h1；>=3pt → h2；>=1.2pt → h3。
    加粗且略大于正文 → h3。
    """
    sz = block["size"]
    if sz >= title - 0.6 and sz >= body + 6.0:
        return 1
    if sz >= body + 3.0:
        return 2
    if sz >= body + 1.0:
        return 3
    if block["bold"] and sz > body + 0.3:
        return 3
    return 0


def normalize_lines(raw: list[str]) -> list[str]:
    """合并孤立项目符号、规整编号，压缩多余空行。"""
    lines: list[str] = []
    pending_bullet = False
    for line in raw:
        t = line.strip()
        if not t:
            continue
        # 孤立 "·" 表示下一行是列表项
        if t in {"·", "•", "-"}:
            pending_bullet = True
            continue
        if pending_bullet:
            lines.append(f"- {t}")
            pending_bullet = False
            continue
        if BULLET_RE.match(t):
            lines.append("- " + BULLET_RE.sub("", t).strip())
            continue
        m = NUMBERED_RE.match(t)
        if m:
            lines.append(f"{m.group(1)}. {t[m.end():].strip()}")
            continue
        lines.append(t)
    return lines


def render_page_md(page_no: int, blocks: list[dict], figure: str | None,
                   doc_title: str = "") -> str:
    """把一页的块渲染成 Markdown 片段。"""
    if not blocks:
        parts = ["<!-- page %d -->" % page_no, "", "> _(本页无可抽取文本，为纯图片页)_", ""]
        if figure:
            parts.append(f"![{Path(figure).name}](../figures/{Path(figure).name})")
            parts.append("")
            parts.append(f"> 图示：`{figure}`（如需细节请用 `read_image` 查看）")
            parts.append("")
        return "\n".join(parts)

    body, title = detect_heading(blocks)
    lines: list[str] = [f"<!-- page {page_no} -->", ""]
    for b in blocks:
        lvl = heading_level(b, body, title)
        text = b["text"]
        if lvl:
            # 去掉标题前的装饰性项目符号（PDF 里常写成 "· 标题"）
            text = re.sub(r"^[·•●○▪■◦\-\u2022]\s*", "", text).strip()
            lines.append("#" * lvl + " " + text)
            lines.append("")
        else:
            lines.append(text)
    md = "\n".join(lines)
    md = normalize_lines(md.splitlines())
    # 把连续、彼此独立的短行整理成 Markdown 列表/代码块
    out = _group_lines(md)
    out = "\n".join(out)
    # 压多余空行
    out = re.sub(r"\n{3,}", "\n\n", out).strip()
    if figure:
        out += (
            f"\n\n![{Path(figure).name}](../figures/{Path(figure).name})\n\n"
            f"> 图示：`{figure}`（文本层较薄，细节请用 `read_image` 查看）"
        )
    return out


def _group_lines(lines: list[str]) -> list[str]:
    """把「命令/输出」类连续行包成代码块，让终端内容在 md 里保持原貌。"""
    out: list[str] = []
    buf: list[str] = []

    def flush():
        if len(buf) >= 2:
            out.append("```text")
            out.extend(buf)
            out.append("```")
            out.append("")
        else:
            # 单行命令：用行内代码，避免夹在列表中间时被当成正文
            for l in buf:
                out.append(f"`{l}`")
                out.append("")
        buf.clear()

    def is_listish(t: str) -> bool:
        return bool(re.match(r"^(?:[-*]\s|\d{1,2}\.\s)", t))

    prev_was_list = False
    for line in lines:
        t = line.strip()
        if t.startswith(("#", ">")) or t.startswith("![") or t.startswith("<!--"):
            flush()
            out.append(t)
            out.append("")
            prev_was_list = False
            continue
        if is_listish(t):
            flush()
            # 列表项之间不留空行，避免 Markdown 列表被切断；遇到非列表才补空行
            if not prev_was_list and out and out[-1] != "":
                out.append("")
            out.append(t)
            prev_was_list = True
            continue
        if not t:
            flush()
            prev_was_list = False
            continue
        # 疑似命令：含路径/下划线/无中文且较短
        looks_cmd = (
            len(t) < 80
            and not re.search(r"[\u4e00-\u9fff]", t)
            and not re.search(r"[。！？]$", t)
        )
        if looks_cmd:
            prev_was_list = False
            buf.append(t)
        else:
            flush()
            if prev_was_list:
                out.append("")
            out.append(t)
            out.append("")
            prev_was_list = False
    flush()
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="PDF 手册 → Markdown")
    ap.add_argument("--only", help="只转换文件名包含该片段的 PDF")
    ap.add_argument("--image-chars", type=int, default=IMAGE_PAGE_CHARS)
    args = ap.parse_args()

    TEXT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = []
    pdfs = sorted(PDF_DIR.glob("*.pdf"))
    if args.only:
        pdfs = [p for p in pdfs if args.only in p.name]
    if not pdfs:
        print(f"未找到 PDF（目录: {PDF_DIR}）", file=sys.stderr)
        return 1

    for pdf in pdfs:
        doc = fitz.open(pdf)
        s = slug(pdf.name)
        sections: list[str] = []
        total_imgs = 0
        image_pages: list[int] = []
        plain_chunks: list[str] = []

        for i, page in enumerate(doc, start=1):
            blocks = collect_blocks(page)
            total_imgs += len(page.get_images())
            raw = " ".join(b["text"] for b in blocks)
            if len(raw) < args.image_chars:
                image_pages.append(i)
            fig_path = FIG_DIR_REL + f"/{s}-p{i:02d}.png"
            fig_exists = (ROOT / fig_path).exists()
            fig = fig_path if (fig_exists and len(raw) < args.image_chars) else None
            sections.append(render_page_md(i, blocks, fig))
            plain_chunks.append(raw)

        out = TEXT_DIR / f"{s}.md"
        header = [
            f"# {pdf.stem}",
            "",
            f"- 源文件：`knowledge/manuals/pdf/{pdf.name}`",
            f"- 页数：{len(doc)} · 图片对象：{total_imgs}",
            f"- 转换工具：`tools/extract_manuals.py`（PyMuPDF {fitz.__version__}）",
            "- 页码标记：下文每页以 `<!-- page N -->` 开头，引用时写「《文档名》 p.N」。",
            f"- 图片页（文本层 <{args.image_chars} 字符）：已渲染为 "
            f"`{FIG_DIR_REL}/` 下的 PNG 并以图片链接嵌入。",
            "",
            "---",
            "",
        ]
        out.write_text("\n".join(header) + "\n\n".join(sections) + "\n", encoding="utf-8")

        full = "\n".join(plain_chunks)
        hits = sorted({k.strip() for k in KEYWORDS if k.strip().lower() in full.lower()})
        manifest.append({
            "file": f"knowledge/manuals/pdf/{pdf.name}",
            "mdFile": f"knowledge/manuals/text/{s}.md",
            "title": pdf.stem,
            "pages": len(doc),
            "chars": len(full),
            "images": total_imgs,
            "imagePages": image_pages,
            "keywords": hits,
        })

    mf = ROOT / "knowledge" / "manuals" / "manifest.json"
    existing = {}
    if mf.exists():
        try:
            existing = {m["file"]: m for m in json.loads(mf.read_text(encoding="utf-8"))}
        except Exception:
            existing = {}
    if args.only:
        for m in manifest:
            existing[m["file"]] = m
        merged = [existing[k] for k in sorted(existing)]
    else:
        merged = manifest
    mf.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")

    for m in manifest:
        print(f"{m['mdFile']}  pages={m['pages']} chars={m['chars']} "
              f"imagePages={len(m['imagePages'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
