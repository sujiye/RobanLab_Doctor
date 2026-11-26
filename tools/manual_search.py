#!/usr/bin/env python3
"""在官方手册 Markdown 里搜索关键词，返回「文档 · 页码 · 片段」。

数据源是 `knowledge/manuals/text/*.md`（由 `tools/extract_manuals.py` 从 PDF
转换而来，每页以 `<!-- page N -->` 标记），页级元数据/图示来自
`knowledge/manuals/pages.json`（由 `tools/render_manual_pages.py` 生成）。

用法:
  python3 tools/manual_search.py "零点"
  python3 tools/manual_search.py "offset.yaml" --doc 教员 --context 3
  python3 tools/manual_search.py "check" --pages-only
  python3 tools/manual_search.py --list            # 列出所有文档
  python3 tools/manual_search.py --stats           # 覆盖率统计
"""

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEXT_DIR = ROOT / "knowledge" / "manuals" / "text"
PAGES = ROOT / "knowledge" / "manuals" / "pages.json"

PAGE_RE = re.compile(r"^<!--\s*page\s+(\d+)\s*-->$")


def load_pages() -> list[dict] | None:
    if not PAGES.exists():
        return None
    try:
        data = json.loads(PAGES.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else None
    except (json.JSONDecodeError, OSError):
        return None


def build_fig_index(pages: list[dict] | None) -> dict[tuple[str, int], str]:
    """(slug, page) -> 图片相对路径；兼容旧 schema（只有 figure 字段）。"""
    idx: dict[tuple[str, int], str] = {}
    for p in pages or []:
        fig = p.get("figure")
        if fig:
            idx[(p.get("slug", ""), p.get("page"))] = fig
    return idx


def strip_md(line: str) -> str:
    """去掉 Markdown 标记，只留可读文本，避免片段里全是语法符号。"""
    s = re.sub(r"^#{1,6}\s*", "", line)
    s = re.sub(r"^>\s*", "", s)
    s = re.sub(r"^[-*]\s+", "", s)
    s = re.sub(r"!\[[^\]]*\]\([^)]*\)", "[图]", s)
    s = re.sub(r"`([^`]*)`", r"\1", s)
    s = re.sub(r"^\d+\.\s+", "", s)
    return s.strip()


def search(query: str, doc_filter: str | None, context: int) -> list[dict]:
    hits = []
    q = query.lower()
    for f in sorted(TEXT_DIR.glob("*.md")):
        if doc_filter and doc_filter.lower() not in f.stem.lower():
            continue
        lines = f.read_text(encoding="utf-8").splitlines()
        page = None
        skip_fence = False
        for i, line in enumerate(lines):
            raw = line.strip()
            m = PAGE_RE.match(raw)
            if m:
                page = int(m.group(1))
                continue
            if raw.startswith("```"):
                skip_fence = not skip_fence
                continue
            if skip_fence:
                continue  # 代码块内部不算正文命中
            if q in line.lower():
                lo, hi = max(0, i - context), min(len(lines), i + context + 1)
                snippet = " ".join(
                    t for t in (strip_md(l) for l in lines[lo:hi])
                    if t and not t.startswith("<!--") and t != "---"
                )
                hits.append({
                    "doc": f.stem,
                    "page": page,
                    "line": i + 1,
                    "snippet": snippet[:400],
                })
    return hits


def cmd_list(pages: list[dict] | None) -> int:
    if pages:
        docs: dict[str, dict] = {}
        for p in pages:
            d = docs.setdefault(p["doc"], {
                "slug": p.get("slug", ""),
                "pages": 0,
                "needsLook": 0,
                "figures": 0,
            })
            d["pages"] += 1
            if p.get("needsLook"):
                d["needsLook"] += 1
            if p.get("figure"):
                d["figures"] += 1
        for doc, d in sorted(docs.items()):
            md = TEXT_DIR / f"{d['slug']}.md"
            mark = "" if md.exists() else "  ⚠ 缺 md"
            print(f"{doc}\n    {d['pages']} 页 · 需看图 {d['needsLook']} 页 · "
                  f"已渲染 {d['figures']} 张{mark}")
    else:
        for f in sorted(TEXT_DIR.glob("*.md")):
            n = sum(1 for l in f.read_text(encoding="utf-8").splitlines()
                    if PAGE_RE.match(l.strip()))
            print(f"{f.stem}  {n} 页")
    return 0


def cmd_stats(pages: list[dict] | None) -> int:
    mds = sorted(TEXT_DIR.glob("*.md"))
    missing = []
    if pages:
        for p in pages:
            if p.get("needsLook") and not p.get("figure"):
                missing.append(f"{p['doc']} p.{p['page']}")
        for p in pages:
            if p.get("figure") and not (ROOT / p["figure"]).exists():
                missing.append(f"{p['doc']} p.{p['page']} (PNG 不存在)")
    total = len(pages) if pages else 0
    print(f"Markdown 文档: {len(mds)}")
    print(f"总页数: {total}")
    if pages:
        need = sum(1 for p in pages if p.get("needsLook"))
        fig = sum(1 for p in pages if p.get("figure"))
        print(f"需看图页: {need} · 已渲染 PNG: {fig}")
    if missing:
        print("⚠ 问题:")
        for m in missing:
            print("  -", m)
        return 1
    print("✓ 覆盖一致：所有需看图页都有 PNG，所有 PNG 都存在")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="搜索 Roban 官方手册（Markdown）")
    ap.add_argument("query", nargs="?", help="关键词（中文或英文）")
    ap.add_argument("--doc", help="只搜索某个文档（文件名片段）")
    ap.add_argument("--context", type=int, default=1, help="片段上下行数（默认 1）")
    ap.add_argument("--limit", type=int, default=20)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--pages-only", action="store_true", help="只输出文档与页码")
    ap.add_argument("--list", action="store_true", help="列出所有文档及其页数")
    ap.add_argument("--stats", action="store_true", help="检查 md/图片覆盖率")
    args = ap.parse_args()

    pages = load_pages()
    if args.list:
        return cmd_list(pages)
    if args.stats:
        return cmd_stats(pages)

    if not args.query:
        ap.error("需要 query，或用 --list / --stats")

    hits = search(args.query, args.doc, args.context)
    if args.json:
        print(json.dumps(hits[: args.limit], ensure_ascii=False, indent=2))
        return 0
    if not hits:
        print(f"未找到「{args.query}」；试试 --list 看有哪些文档。")
        return 1

    figs = build_fig_index(pages)
    if args.pages_only:
        seen = []
        for h in hits:
            key = (h["doc"], h["page"])
            if key not in seen:
                seen.append(key)
        for doc, page in seen:
            print(f"《{doc}》 p.{page}")
        return 0

    for h in hits[: args.limit]:
        fig = figs.get((h["doc"], h["page"]))
        tag = f"  [图: {fig}]" if fig else ""
        print(f"《{h['doc']}》 p.{h['page']}: {h['snippet']}{tag}")
    if len(hits) > args.limit:
        print(f"… 共 {len(hits)} 处命中，已显示前 {args.limit} 条")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
