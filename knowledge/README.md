# Roban 官方文档知识库（`knowledge/`）

这个目录是**官方文档层**：Roban 官方 PDF（使用入门、教员培训、自检、零点、拆机、版本查询、
离线镜像刷新、开机故障、ROS 节点/topic/service 清单），加上两份**本项目自己的**文档
（*产品设计技术方案 v2 修改版*、*技术调研报告 v1.0*），以及由此抽取的可搜索 Markdown。
引用时注意区分「官方手册」与「我们的方案/报告」。
它和 `kb/` 是两个东西：

| 目录 | 内容 | 谁写 | 用途 |
|---|---|---|---|
| `kb/` | 故障签名 → 修复剧本 → 复检判据（JSON） | 人工种子 + agent 自动习得 | 自动修复决策 |
| `knowledge/` | 官方手册原文 + 转换出的 Markdown + 图示 PNG + 页码索引 | 从官方 PDF 抽取 | 查「官方怎么做 / 官方规格」 |

## 目录结构

```text
knowledge/
├── README.md                 # 本文
├── INDEX.md                  # 问题 → 文档 → 页码（agent 首先读这个）
├── CHECKMAP.md               # 官方自检项 ↔ agent 自动检测项 对照表
├── CHEATSHEET.md             # 常用命令速查 + 安全分类（只读 / 非运动 / 运动 / 禁止）
├── official-baseline.json    # 官方可判定基线（规格/版本/开机/零点/镜像），被 skills/official-baseline.js 读取
└── manuals/
│   ├── pdf/                  # 12 份 PDF 原件（10 份官方手册 + 本项目的产品方案 v2 修改版 / 技术调研报告 v1.0）
│   ├── text/                 # 每份 PDF 转换出的 **Markdown 正文**（首选阅读/搜索对象），带 <!-- page N --> 标记
│   ├── figures/              # 含图页/文本层很薄的页渲染成 PNG（gitignored，可重新生成）
│   ├── pages.json            # 每页：doc / slug / page / chars / hasImages / needsLook / figure / preview
│   ├── manifest.json         # 每文档：file / mdFile / title / pages / chars / images / imagePages / keywords
│   └── topics-services.json  # ROS 节点、topic、service 结构化清单
└── ../tools/ 见 extract_manuals.py, render_manual_pages.py, manual_search.py
```

> **直接读 Markdown，不要再去解析 PDF。** `manuals/text/*.md` 已由 PDF 转换而来，
> 带标题层级、列表、终端命令代码块，并在图片页就地嵌入 PNG 链接；每页以
> `<!-- page N -->` 开头，所以「《文档》 p.N」的引用习惯完全保留。当前共 **12 份文档 / 218 页**，
> 其中 **107 页**需要看图（文本层 <160 字符）；`figures/` 下共 **207 张** PNG——
> 渲染器把「文本薄 **或** 含图」的页都出了图，多出的 100 张文本够用、仅备查。
> 是否该打开图片只看 `pages.json` 里的 `needsLook`，不要只看 `hasImages`。

## agent 怎么用（推荐顺序）

1. **先读 `INDEX.md`**，判断该问题对应哪份文档、哪几页。
2. **直接读 / grep Markdown 正文**（快、可批量）：
   ```bash
   grep -n -i "offset.yaml" knowledge/manuals/text/          # 命中行带 <!-- page N --> 上下文
   python3 tools/manual_search.py "零点" --doc 教员培训
   python3 tools/manual_search.py --list                     # 每份文档的页数 / 需看图页 / 已渲染数
   python3 tools/manual_search.py --stats                    # 校验 md 与 PNG 覆盖率是否一致
   ```
3. **需要看图示时读图**：`knowledge/manuals/figures/<slug>-pNN.png`
   （拆机 24 页、离线镜像刷新 12 页、零点调试多为图；Markdown 里已就地嵌入这些图片链接，
   文本层抽不出的内容必须 `read_image` 看 PNG）。4. **引用官方结论时写出处**：例如「《Roban_教员培训手册_20220111》 p.24 要求先跑 `check`」。
5. 官方手册里的命令**不是可自动执行的指令**。执行前必须按
   [`ATTENTION/ATTENTION.md`](../ATTENTION/ATTENTION.md) 分类：只读 / 非运动修复 / 运动 / 禁止。
   手册里出现 `reboot`、镜像烧写、卸力、写 `offset.yaml` 等步骤时，只能**建议用户手动执行**。

## 重新转换（PDF 更新后）

先生成图片、再转换正文 —— 顺序不能反，否则 Markdown 里链不到 PNG：

```bash
python3 tools/render_manual_pages.py      # 渲染图片页 → figures/ + pages.json
python3 tools/extract_manuals.py          # PDF → text/*.md + manifest.json（可选 --only 片段）
python3 tools/manual_search.py --stats    # 校验：需看图页都有 PNG，且 PNG 都存在
```

- `render_manual_pages.py` 默认渲染**所有含图页**；`--thin-only` 恢复旧的「只渲染文本很薄的页」行为。
- 新增 PDF 直接放进 `knowledge/manuals/pdf/` 后重跑上面两步即可，无需改代码。

## 已知限制

- 没有中文 OCR 环境（本机 `tesseract` 只有 `eng`），所以纯图片页的文字不可搜索；
  需要内容时直接 `read_image` 对应页的 PNG。
- 部分 PDF 本身页码与物理页码不一致（例如版本查询手册显示 “3 / 3”），
  `pages.json` 用的是**物理页序号**。
- `manifest.json` 的 `chars` 统计**真实字符**（不含空白与换行），因此各文档字符数比旧口径偏低，
  属度量口径变化，不是内容丢失。
- 官方文档日期跨度大（2022–2024），硬件/软件版本可能与当前机器人不一致；
  冲突时以机器人实测（`selfcheck` / `probe`）为准，并在报告中标注来源差异。
  本项目的两份文档（产品方案 / 技术调研报告）是*我们的*设计，**不能当作官方结论**引用。
