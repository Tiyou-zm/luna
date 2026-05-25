# webapp-softreg-doc 安装说明

## 适用场景

本目录用于将 `webapp-softreg-doc` skill 迁移到另一台 Windows 办公电脑上的 Codex 环境。

## 包内内容

- `SKILL.md`
- `agents/openai.yaml`
- `assets/`
- `references/`
- `scripts/`
- `requirements.txt`
- `install_webapp_softreg_doc.ps1`

## 安装前提

需要以下基础环境：

- Windows
- Python 3.10 或更高版本
- Codex 已安装并已创建 `~/.codex/skills/` 目录

可选但推荐：

- Microsoft Word
- LibreOffice
- Poppler

## 快速安装

1. 将整个 `webapp-softreg-doc` 文件夹复制到目标电脑。
2. 右键使用 PowerShell 打开该文件夹。
3. 执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\install_webapp_softreg_doc.ps1
```

4. 安装完成后，在新对话中使用：

```text
用 $webapp-softreg-doc 审阅这个网页并生成软著说明书
```

## 安装脚本会做什么

安装脚本会：

- 自动定位目标电脑的 Codex skill 目录
- 复制当前 skill 到 `~/.codex/skills/webapp-softreg-doc`
- 安装 `requirements.txt` 中的 Python 依赖
- 输出安装完成后的调用方式

## 可选功能依赖

如果需要完整功能，请确认：

- `python-docx`
  用于将 Markdown 说明书生成 DOCX
- `pywin32`
  用于调用本地 Microsoft Word 更新目录并导出 PDF
- `pyyaml`
  用于校验 skill 结构
- Microsoft Word
  用于真实更新目录字段与导出 PDF
- LibreOffice
  用于 DOCX 转 PDF 的补充方案
- Poppler
  用于把 PDF 渲染为图片做版式检查

## 迁移后建议验证

建议在目标电脑上执行以下检查：

```powershell
python .\scripts\build_softreg_docx.py --help
python .\scripts\update_toc_and_export.py --help
```

如果还想校验 skill 结构，可在目标电脑上执行：

```powershell
python "<你的 skill-creator 路径>\\scripts\\quick_validate.py" "<你的 skill 路径>"
```
