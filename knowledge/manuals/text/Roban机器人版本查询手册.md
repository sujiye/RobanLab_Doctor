# 官方文档文本抽取：Roban机器人版本查询手册.pdf

- 源文件: `knowledge/manuals/pdf/Roban机器人版本查询手册.pdf`
- 页数: 2 · 图片对象: 4
- 抽取工具: PyMuPDF 1.28.0（文本层抽取；纯图片页可能为空，需要看图时打开源 PDF）

## 页码约定

下文每页以 `<!-- page N -->` 标记。引用文档时写「《文档名》 p.N」。

<!-- page 1 -->

3 / 3
Roban机器人在线刷新镜像手册（Roban)
一、查询机器人代码版本
·
使用vnc或者接上屏幕连接上机器人进入到桌面中
·
桌面右键选择New Terminal启动终端
·
在终端上终端输入：
cd robot_ros_application/
git log
·
输入之后会弹文字出来，查看代码仓库时间，如果时间为2023年11月29号之前则需要使用更新脚本的
命令更新仓库代码：

<!-- page 2 -->

3 / 3
二、查看Roban版本
同样的在终端下输入lsb_release -a，
Description显示Ubuntu16.04则为Roban1.0；
Description显示Ubuntu20.04则为Roban2.0；
