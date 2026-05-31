# Codex App 确认工作流

这个仓库的自动化分成两段：

1. GitHub Actions 每月运行 Playwright，在京东读书中搜索候选书，再读取腾讯文档判断是否已推荐，并创建候选书 Issue。
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

## 京东读书搜索

候选书来源于京东读书。默认会读取 `https://e.jd.com/view_search` 页面中的图书候选，并返回最多 10 本未推荐书。可以在 GitHub 仓库的 `Settings -> Secrets and variables -> Actions -> Variables` 中添加：

- `JD_SEARCH_URL`：可选。自定义京东读书搜索入口，默认是 `https://e.jd.com/view_search`。
- `JD_SEARCH_KEYWORDS`：可选。搜索关键词，多个关键词用逗号分隔，例如 `文学,历史,科幻`。
- `MAX_CANDIDATES`：可选。返回候选数量，默认是 `10`。

脚本会用腾讯文档中的 `推荐状态` 判断是否已推荐；只有未命中 `已推荐`、`跳过`、`不推荐` 的京东读书结果会进入候选清单。

## Codex App 自动化提示词

可以在 Codex App 中创建一个定期提醒，提示词建议使用：

```text
检查 GitHub 仓库 shutong-114/Ebook-recommendation 中带有 ebook-candidates 和 pending-confirmation 标签的最新 Issue。读取候选书资料，整理成待确认清单，并询问我确认哪些书。确认前不要生成文件。确认后，使用仓库中的正式模板生成推荐网页；只允许修改内容简介、作者简介、推荐理由，以及按照京东读书资料修改前四章名称，不要改动模板的其他结构、样式或说明文字。输出写入 output/YYYY-MM/书名/index.html，并更新 data/recommended-log.json。
```

## 正式模板修改边界

正式模板位于 `template/template-银河帝国1：基地.txt`。生成推荐页时只允许替换以下内容：

- `内容简介`
- `作者简介`
- `推荐理由`
- 目录中的第一章、第二章、第三章、第四章名称

不要修改模板中的其他 HTML、样式、获取方式、封面上传提示或二维码说明。

如需用脚本渲染，可以准备一个 JSON 文件：

```json
{
  "title": "书名",
  "contentIntro": "内容简介文案",
  "authorIntro": "作者简介文案",
  "recommendation": "推荐理由文案",
  "chapters": ["第一章名称", "第二章名称", "第三章名称", "第四章名称"]
}
```

然后运行：

```text
npm run render:recommendation -- book.json output/YYYY-MM/书名/index.html
```

## 手动触发

在 GitHub 仓库页面打开 `Actions -> Monthly ebook candidates -> Run workflow`，可以手动生成一次候选 Issue。
