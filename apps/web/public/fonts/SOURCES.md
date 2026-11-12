# 字体来源

复用用户本机 Socrates 已有字体资产，不引入外部字体请求：

- `frontend/src/assets/fonts/geist-sans-variable.woff2`：Geist，许可见 `GEIST_OFL.txt`。
- `frontend/src/styles/foundations/fonts-cjk.css` 引用的 101 个 `site/media/fonts/noto-sans-sc-*-var.woff2`：Noto Sans SC，保留原始 unicode-range、变量字重与 swap；许可见 `NOTO_SANS_SC_OFL.txt`。

总计约 4.6 MB；按 unicode-range 请求当前文本所需分片，不在首屏下载全部文件。未重新绘制、裁改字形。未覆盖的字符继续使用系统回退。
