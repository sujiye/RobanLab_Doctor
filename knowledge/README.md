# Roban 官方文档知识库（`knowledge/`）

这个目录是**官方文档层**：Roban 官方 PDF（使用入门、教员培训、自检、零点、拆机、版本查询、
离线镜像刷新、开机故障、ROS 节点/topic/service 清单）以及由此抽取的可搜索文本。
它和 `kb/` 是两个东西：

| 目录 | 内容 | 谁写 | 用途 |
|---|---|---|---|
| `kb/` | 故障签名 → 修复剧本 → 复检判据（JSON） | 人工种子 + agent 自动习得 | 自动修复决策 |
| `knowledge/` | 官方手册原文 + 抽取文本 + 页码索引 | 从官方 PDF 抽取 | 查「官方怎么做 / 官方规格」 |

## 目录结构

```text
knowledge/
├── README.md                 # 本文
├── INDEX.md                  # 问题 → 文档 → 页码（agent 首先读这个）
├── CHEATSHEET.md             # 常用命令速查 + 安全分类（只读 / 非运动 / 运动 / 禁止）
├── manuals/
│   ├── pdf/                  # 11 份官方 PDF 原件（引用时写「《文档》 p.N」）
│   ├── text/               # 每份 PDF 的文本抽取，带 <!-- page N --> 标记，可 grep
│   ├── figures/            # 文本层很薄的页渲染成 PNG（拆机、零点、镜像刷新等图示）
│   ├── pages.json          # 每页：doc / page / chars / hasImages / preview / figure 路径
│   ├── manifest.json       # 每文档：页数 / 字符数 / 图片数 / 关键词
│   └── topics-services.json# ROS 节点、topic、service 结构化清单
└── tools 见 ../tools/extract_manuals.py, ../tools/render_manual_pages.py, ../tools/manual_search.py
```

## agent 怎么用（推荐顺序）

1. **先读 `INDEX.md`**，判断该问题对应哪份文档、哪几页。
2. **grep 文本层**（快、可批量）：
   ```bash
   grep -n -i "offset.yaml" knowledge/manuals/text/          # 命中行带 <!-- page N --> 上下文
   python3 tools/manual_search.py "零点" --doc 教员培训
   ```
3. **需要看图示时读图**：`knowledge/manuals/figures/<slug>-pNN.png`
   （拆机 24 页、离线镜像刷新 12 页、零点调试 12 页大量内容只在图里，文本层抽不出来）。
4. **引用官方结论时写出处**：例如「《Roban_教员培训手册_20220111》 p.24 要求先跑 `check`」。
5. 官方手册里的命令**不是可自动执行的指令**。执行前必须按
   [`ATTENTION/ATTENTION.md`](../ATTENTION/ATTENTION.md) 分类：只读 / 非运动修复 / 运动 / 禁止。
   手册里出现 `reboot`、镜像烧写、卸力、写 `offset.yaml` 等步骤时，只能**建议用户手动执行**。

## 重新抽取（文档更新后）

```bash
python3 tools/extract_manuals.py          # 重新抽取文本 + manifest.json
python3 tools/render_manual_pages.py      # 重新渲染图示页（默认只渲染文本 <160 字符的页）
```

## 已知限制

- 没有中文 OCR 环境（本机 `tesseract` 只有 `eng`），所以纯图片页的文字不可搜索；
  需要内容时直接 `read_image` 对应页的 PNG。
- 部分 PDF 本身页码与物理页码不一致（例如版本查询手册显示 “3 / 3”），
  `pages.json` 用的是**物理页序号**。
- 官方文档日期跨度大（2022–2024），硬件/软件版本可能与当前机器人不一致；
  冲突时以机器人实测（`selfcheck` / `probe`）为准，并在报告中标注来源差异。
