# Roban开机无法自动进入系统(1)

- 源文件：`knowledge/manuals/pdf/Roban开机无法自动进入系统(1).pdf`
- 页数：1 · 图片对象：1
- 转换工具：`tools/extract_manuals.py`（PyMuPDF 1.28.0）
- 页码标记：下文每页以 `<!-- page N -->` 开头，引用时写「《文档名》 p.N」。
- 图片页（文本层 <160 字符）：已渲染为 `knowledge/manuals/figures/` 下的 PNG 并以图片链接嵌入。

---
<!-- page 1 -->

`2024-12-17`

## 故障现象：

Roban开机后无法自动进入系统，需要连接鼠标，键盘，显示器电机login才能进入。

##解决方案：

终端输入指令

`sudo nano /etc/lightdm/lightdm.conf`

在autologin-user=lemon代码下输入

`autologin-user-timeout=0`

修改完成后，先ctrl+o保存(如果不修改文件名直接回车），再按回车最后ctrl +x退出
