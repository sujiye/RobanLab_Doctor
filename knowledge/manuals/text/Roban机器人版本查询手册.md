# Roban机器人版本查询手册

- 源文件：`knowledge/manuals/pdf/Roban机器人版本查询手册.pdf`
- 页数：2 · 图片对象：4
- 转换工具：`tools/extract_manuals.py`（PyMuPDF 1.28.0）
- 页码标记：下文每页以 `<!-- page N -->` 开头，引用时写「《文档名》 p.N」。
- 图片页（文本层 <160 字符）：已渲染为 `knowledge/manuals/figures/` 下的 PNG 并以图片链接嵌入。

---
<!-- page 1 -->

# Roban机器人在线刷新镜像手册（Roban)

### 一、查询机器人代码版本

- 使用vnc或者接上屏幕连接上机器人进入到桌面中
- 桌面右键选择New Terminal启动终端
- 在终端上终端输入：
```text
cd robot_ros_application/
git log
```

- 输入之后会弹文字出来，查看代码仓库时间，如果时间为2023年11月29号之前则需要使用更新脚本的

命令更新仓库代码：

<!-- page 2 -->

### 二、查看Roban版本

同样的在终端下输入lsb_release -a，

Description显示Ubuntu16.04则为Roban1.0；

Description显示Ubuntu20.04则为Roban2.0；

![Roban机器人版本查询手册-p02.png](../figures/Roban机器人版本查询手册-p02.png)

> 图示：`knowledge/manuals/figures/Roban机器人版本查询手册-p02.png`（文本层较薄，细节请用 `read_image` 查看）
