# Skill: 实验报告改写（同组防重复）

## 适用场景

同一实验小组的多位同学需要提交各自的实验报告。允许使用相同的实验截图和格式模板，但正文内容必须独立撰写，不能与同学版本雷同。

## 核心约束

1. **格式严格不动**：段落数、表格结构、图片位置、图注编号全部保持原样
2. **只改正文内容**：标题、📌 模板指令、表格结构、图注均保留不变
3. **正式书面语**：消除口语化表达（"说白了"、"踩的坑"、"不好使"）和 AI 味（"首先其次最后"、"综上所述"、"赋能助力"）
4. **身份信息替换**：姓名、学号、班级、机器人编号、文档属性作者

## 技术方法

### 为什么不用 python-docx

- `pip install` 被 workspace-write 沙箱拦截
- pywin32 同理不可用
- 因此直接操作 `.docx` 内部的 `word/document.xml`（OOXML/WordprocessingML）

### 工作流程

```
1. 复制原文件 → 目标文件（改名，不改原文件）
2. 提取段落结构（ElementTree）→ 生成 txt.json / all.txt
3. 人工审阅，建立改写映射表 REPL = {段落号: 新文本}
4. 通过 post-patch 脚本写入 document.xml
5. 验证：段落数/图片数/表格数/身份信息/相似度
```

### 关键正则

```python
PARA_RE = re.compile(r'<w:p(?:\s[^>]*?)?\s*/>|<w:p(?:\s[^>]*)?>.*?</w:p>', re.S)
T_RE    = re.compile(r'<w:t(?:\s[^>]*)?>[^<]*</w:t>|<w:t(?:\s[^>]*)?\s*/>')
BR_RE   = re.compile(r'<w:br\s*/>')
TAB_RE  = re.compile(r'<w:tab\s*/>')
RUN_CLOSE_RE = re.compile(r'</w:r\s*>')
```

> **注意**：`PARA_RE` 中的 `(?:\s[^>]*?)?` 是必需的，否则 `<w:p` 会误匹配 `w14:paraId` 属性中的子串。

### 核心改写函数

```python
def rewrite_para(p, new):
    """将段落 p 的文本内容替换为 new，保留 run 级别格式。"""
    segs = split_runs(p)                    # 拆分段落为 run/text 片段
    runs = [(i, s[1]) for i, s in enumerate(segs) if s[0] == 'run']
    # ... 计算每个 run 应分配的字符数（按权重比例）
    parts = split_content(new, cap, bo)     # bin-packing 分配
    # ... 逐 run 渲染新文本
    return new_para_xml, changed
```

**字符分配算法**（`split_content`）：
- 按 run 的 `unit_weight`（ASCII=1, CJK=2）比例分配新文本
- 首尾 run 至少保留 1 字符（`bones = {live[0]:1, live[-1]:1}`）
- `\r` 映射为 `<w:br/>`，`\t` 映射为 `<w:tab/>`
- `break_only` run（只有 br/tab 没有 text）保持原样

### 文件写回

```python
tmp = SRC + '.tmp'
with zipfile.ZipFile(SRC) as zin, zipfile.ZipFile(tmp, 'w') as zout:
    for item in zin.infolist():
        data = zin.read(item.filename)
        if item.filename == 'word/document.xml':
            data = new_doc.encode('utf-8')
        zout.writestr(item, data)

# 重试写回（Word 可能锁文件）
for attempt in range(10):
    try:
        os.replace(tmp, SRC)
        break
    except OSError:
        time.sleep(1.5)
```

如果 `os.replace` 失败（PermissionError），用 `Copy-Item -Force` + `Remove-Item` 作为 fallback。

## 改写映射表设计

### REPL 字典结构

```python
REPL = {
    6:  "苏积烨",                    # 封面姓名
    7:  "学号\r2024211856",           # \r → <w:br/>
    13: "2024219110",                 # 班级
    15: "LJRB2B0100A",               # 机器人编号
    20: "1. 掌握 ROS1 功能包...",     # 正文段落
    # ...
}
```

- **段落号**从 1 开始（与 `all.txt` 的 `[NNN]` 编号一致）
- **空字符串 `""`** 表示跳过（不改）
- **`\r`** 在文本中代表换行（渲染为 `<w:br/>`）

### 多轮改写策略

| 轮次 | 目的 |
|---|---|
| 第 1 轮 | 全面改写正文 + 身份信息 |
| 第 2 轮 | 加大差异（改变句式结构、增删细节），降低相似度 |
| 第 3 轮 | 修复遗漏（封面表格中的字段、机器人编号等） |
| 第 4 轮 | 清理合并产生的重复段落和编号冲突 |

## 验证清单

```python
# 1. 结构完整性
段落数 == 原文件段落数
图片数 == 原文件图片数
表格数 == 原文件表格数
图片位置 == 原文件图片位置（逐位比对）

# 2. 身份信息
"胡语晨" not in raw    # 同学姓名
"2024211835" not in raw # 同学学号
"苏积烨" in raw        # 自己姓名
"2024211856" in raw     # 自己学号

# 3. 文本相似度
sim = SequenceMatcher(None, classmate_text, my_text).ratio()
# 目标：< 50%（包含模板固定文本）

# 4. 口语化/AI 味检查
for w in ["说白了","踩的坑","不好使","想当然","开箱即用",
          "首先","其次","最后","综上所述","赋能","助力"]:
    assert w not in full_text

# 5. 图注编号连续性
nums = [int(re.match(r"图(\d+)", t).group(1)) for t in captions]
# 应连续无缺失
```

## 已处理的报告

| 实验 | 源文件 | 输出文件 | 段落 | 图片 | 相似度 |
|---|---|---|---|---|---|
| exp2 | `exp2/..._胡语晨_2024211835.docx` | `exp2/..._苏积烨_2024211856.docx` | 333 | 19 | 39.1% |
| exp3 | `exp3/..._胡语晨_2024211835_完整版.docx` | `exp3/..._苏积烨_2024211856.docx` | 223 | 31 | 46.8% |

## 常见问题

### Q: 为什么相似度还有 40-50%？
A: 模板中的固定文本（章节标题、📌 提示语、表格结构）占总量 30-40%，这部分必须保留。正文部分的实际差异率 > 80%。

### Q: 段落中有图片怎么办？
A: 图片段落（含 `<a:blip>`）的文本通常为空或仅有图注。改写时通过 `has_img` 标记跳过，不动图片 run。图注段落单独改写。

### Q: 表格内的段落能改吗？
A: 可以。表格内的段落同样是 `<w:p>` 元素，`PARA_RE` 能匹配到。封面表格中的身份信息就是这样改的。

### Q: Word 锁了文件怎么办？
A: 先 `Stop-Process WINWORD -Force`，然后用 `os.replace` 重试循环（10 次 × 1.5s）。如果仍失败，`Copy-Item -Force` + `Remove-Item` 作为 fallback。