# Roban机器人自检手册

- 源文件：`knowledge/manuals/pdf/Roban机器人自检手册.pdf`
- 页数：2 · 图片对象：4
- 转换工具：`tools/extract_manuals.py`（PyMuPDF 1.28.0）
- 页码标记：下文每页以 `<!-- page N -->` 开头，引用时写「《文档名》 p.N」。
- 图片页（文本层 <160 字符）：已渲染为 `knowledge/manuals/figures/` 下的 PNG 并以图片链接嵌入。

---
<!-- page 1 -->

## Roban机器人自检手册

### 一、启动自检程序

- 使用vnc或者接上屏幕连接上机器人进入到桌面中
- 桌面右键选择New Terminal启动终端
- 在终端下输入check+回车：
- 进入自检程序后依次选择编号查看是否有报错，有报错可以先进行截图反馈。

![Roban机器人自检手册-p01.png](../figures/Roban机器人自检手册-p01.png)

> 图示：`knowledge/manuals/figures/Roban机器人自检手册-p01.png`（文本层较薄，细节请用 `read_image` 查看）

<!-- page 2 -->

### 二、查看终端报错

- 在终端上启动./start.sh或者开机查看终端是否有红字报错，例如：

翻看终端，看到有红字报错就截图下来进行反馈

![Roban机器人自检手册-p02.png](../figures/Roban机器人自检手册-p02.png)

> 图示：`knowledge/manuals/figures/Roban机器人自检手册-p02.png`（文本层较薄，细节请用 `read_image` 查看）
