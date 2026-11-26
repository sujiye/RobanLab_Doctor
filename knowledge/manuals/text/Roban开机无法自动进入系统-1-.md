# 官方文档文本抽取：Roban开机无法自动进入系统(1).pdf

- 源文件: `knowledge/manuals/pdf/Roban开机无法自动进入系统(1).pdf`
- 页数: 1 · 图片对象: 1
- 抽取工具: PyMuPDF 1.28.0（文本层抽取；纯图片页可能为空，需要看图时打开源 PDF）

## 页码约定

下文每页以 `<!-- page N -->` 标记。引用文档时写「《文档名》 p.N」。

<!-- page 1 -->

start.md
2024-12-17
1 / 1
故障现象：
Roban开机后无法自动进入系统，需要连接鼠标，键盘，显示器电机login才能进入。
##解决方案：
终端输入指令
 sudo nano /etc/lightdm/lightdm.conf
在autologin-user=lemon代码下输入
autologin-user-timeout=0
修改完成后，先ctrl+o保存(如果不修改文件名直接回车），再按回车最后ctrl +x退出
