# Hermes Worker 素材包图片入库增强

日期：2026-06-05

## 目标

Hermes 完整素材包内如果带回图片或交付文件，worker 需要自动拆出真实文件资产，写入用户素材库的“素材文件”栏目；完整包详情页也需要能看到这些包内图片/文件。

## Worker 改动

文件：`workers/hermes-worker/index.cjs`

新增统一资产收集逻辑：

- `collectPackageAssets(pkg)`
- `collectFromArrayFields(...)`
- `pushAsset(...)`

现在会从以下位置提取图片/文件：

- `assets.generated`
- `assets.placeholder`
- `assets.images`
- `assets.image_files`
- `assets.generated_images`
- `assets.files`
- `assets.material_files`
- `assets.attachments`
- `assets.outputs`
- `assets.deliverables`
- `package_archive`
- `content.platforms.*` 或 `platforms.*` 内的 `images`、`image_urls`、`cover_url`、`cover_image`、`attachments`、`files` 等字段

写入 `materials` 派生记录时统一使用：

- `library_section: 'asset'`
- 图片：`type: 'image'`
- 非图片文件：`type: 'archive'` 或 `type: 'copywriting'`
- `parent_material_id` 指向完整素材包
- `content` 和 `url` 都写入可展示地址
- `metadata.asset_kind` 标记为 `package_image` 或 `package_file`

文案、视频脚本、投放分析仍保留在完整包详情内部，不再作为一级素材库 tab 并列展示。

## 压缩包处理

Worker 现在不只接 JSON 索引，也会处理 Hermes 返回的 zip 压缩包：

1. 识别 `package_archive` 或资产列表中的 `.zip` / `archive` 文件。
2. 下载压缩包。
3. 解压包内图片和常规文件。
4. 上传到 CloudBase 云存储：

```text
users/{user_id}/generated/{materialId}/package-assets/images/*
users/{user_id}/generated/{materialId}/package-assets/files/*
```

5. 把解压后的图片/文件写入 `materials`：

- 图片：`type = image`
- 文件：`type = copywriting` 或 `archive`
- `library_section = asset`
- `parent_material_id = 完整包ID`
- `metadata.source = package_archive.extract`

保护限制：

- 默认最大压缩包大小：120MB。
- 默认最多处理文件数：80 个。
- 自动跳过目录、隐藏文件和 `__MACOSX`。

## 小程序改动

文件：`src/pages/materials/index.tsx`

- 图片预览从 `content`/`url` 双兜底读取。
- worker 拆出的图片显示为“素材包图片”。
- worker 拆出的文件显示为“素材包文件”。
- 如果带有 `platform_label`，素材卡片会显示平台来源。

文件：`src/pages/package-result/index.tsx`

- 完整包详情页新增“素材包图片 / 文件”区块。
- 会从 `material.assets`、`material.package_archive`、`hermes_raw.assets`、`hermes_raw.content.platforms` 中收集图片/文件并去重展示。

## 部署提醒

本地构建通过后，需要把 `workers/hermes-worker/index.cjs` 同步到远程 worker 目录：

```text
/home/ubuntu/luna-hermes-worker
```

然后重启：

```bash
sudo systemctl restart luna-hermes-worker.service
sudo systemctl status luna-hermes-worker.service
```
