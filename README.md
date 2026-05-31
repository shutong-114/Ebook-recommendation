# Ebook Recommendation

这个仓库用于自动收集电子书推荐候选资料，并配合 Codex App 生成人工确认后的电子书推荐页面。

## 工作流

1. GitHub Actions 每月运行一次。
2. Playwright 读取腾讯文档中的候选书。
3. Playwright 打开京东读书链接，校验来源并抓取页面信息。
4. Action 创建带有 `ebook-candidates` 和 `pending-confirmation` 标签的 GitHub Issue。
5. 你在 Codex App 中确认推荐书籍。
6. Codex App 根据模板生成推荐网页并更新推荐日志。

详细说明见 [docs/codex-app-workflow.md](docs/codex-app-workflow.md)。
