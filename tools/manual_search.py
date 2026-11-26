#!/usr/bin/env python3
"""在官方手册文本层里搜索关键词，返回「文档 · 页码 · 片段」。

用法:
  python3 tools/manual_search.py "零点"
  python3 tools/manual_search.py "offset.yaml" --doc 教员 --context 3
  python3 tools/manual_search.py "check" --pages-only
  python3 tools/manual_search.py --list            # 列出所有文档
"""

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEXT_DIR = ROOT / "knowledge" / "manuals" / "text"
PAGES = ROOT / "knowledge" / "manuals" / "pages.json"


def load_pages():
    if PAGES.exists():
        return json.loads(PAGES.read_text(encoding="utf-8"))
    return None


def search(query: str, doc_filter: str | None, context: int) -> list[dict]:
    hits = []
    for f in sorted(TEXT_DIR.glob("*.md")):
        if doc_filter and doc_filter.lower() not in f.stem.lower():
            continue
        lines = f.read_text(encoding="utf-8").splitlines()
        page = None
        for i, line in enumerate(lines):
            m = re.match(r"<!-- page (\d+) -->", line.strip())
            if m:
                page = int(m.group(1))
                continue
            if query.lower() in line.lower():
                lo = max(0, i - context)
                hi = min(len(lines), i + context + 1)
                snippet = " ".join(l.strip() for l in lines[lo:hi] if l.strip())
                hits.append({
                    "doc": f.stem,
                    "page": page,
                    "line": i + 1,
                    "snippet": snippet[:400],
                })
    return hits


def main() -> int:
    ap = argparse.ArgumentParser(description="搜索 Roban 官方手册文本层")
    ap.add_argument("query", nargs="?", help="关键词（中文或英文）")
    ap.add_argument("--doc", help="只搜索某个文档（文件名片段）")
    ap.add_argument("--context", type=int, default=1, help="片段上下行数（默认 1）")
    ap.add_argument("--limit", type=int, default=20)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--list", action="store_true", help="列出所有文档及其页数")
    args = ap.parse_args()

    if args.list:
        pages = load_pages()
        if pages:
            docs: dict[str, int] = {}
            for p in pages:
                docs[p["doc"]] = docs.get(p["doc"], 0) + 1
            for d, n in sorted(docs.items()):
                print(f"{d}  {n} 页")
        else:
            for f in sorted(TEXT_DIR.glob("*.md")):
                print(f.stem)
        return 0

    if not args.query:
        ap.error("需要 query，或用 --list")

    hits = search(args.query, args.doc, args.context)
    if args.json:
        print(json.dumps(hits[: args.limit], ensure_ascii=False, indent=2))
        return 0
    if not hits:
        print(f"未找到「{args.query}」；试试 --list 看有哪些文档。")
        return 1
    for h in hits[: args.limit]:
        fig = ""
        pages = load_pages()
        if pages:
            for p in pages:
                if p["slug"] == h["doc"] and p["page"] == h["page"] and p["figure"]:
                    fig = f"  [图: {p['figure']}]"
                    break
        print(f"《{h['doc']}》 p.{h['page']}: {h['snippet']}{fig}")
    if len(hits) > args.limit:
        print(f"… 共 {len(hits)} 处命中，已显示前 {args.limit} 条")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
