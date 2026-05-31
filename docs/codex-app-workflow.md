# Codex App 确认工作流

这个仓库的自动化分成两段：

1. GitHub Actions 每月运行 Playwright，读取腾讯文档和京东读书页面，并创建候选书 Issue。
2. 你打开 Codex App，让 Codex 读取候选 Issue。你确认书籍后，Codex 再生成推荐网页文件。

## 仓库 Secrets

进入 GitHub 仓库的 `Settings -> Secrets and variables -> Actions`，添加以下 Secret：

- `TENCENT_DOC_CSV_URL`：推荐使用。腾讯文档导出的 CSV 链接或其他可公开读取的 CSV 地址。
- `TENCENT_DOC_URL`：可选。腾讯文档网页链接，脚本会用 Playwright 尝试读取页面表格。

如果两个都配置，脚本优先使用 `TENCENT_DOC_CSV_URL`。

## 腾讯文档表头

建议维护这些列：

```text
书名, 作者, 京东读书链接, 分类, 推荐状态, 备注
```

`推荐状态` 中包含 `已推荐`、`跳过`、`不推荐` 的行会被排除。

## Codex App 自动化提示词

可以在 Codex App 中创建一个定期提醒，提示词建议使用：

```text
检查 GitHub 仓库 shutong-114/Ebook-recommendation 中带有 ebook-candidates 和 pending-confirmation 标签的最新 Issue。读取候选书资料，整理成待确认清单，并询问我确认哪些书。确认前不要生成文件。确认后，使用仓库中的 template/book-template.html 为每本确认书籍生成推荐网页，写入 output/YYYY-MM/书名/index.html，并更新 data/recommended-log.json。
```

## 手动触发

在 GitHub 仓库页面打开 `Actions -> Monthly ebook candidates -> Run workflow`，可以手动生成一次候选 Issue。
