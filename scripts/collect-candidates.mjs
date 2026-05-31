import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { extractFirstFourChaptersFromText } from "./chapter-extract.mjs";
import { extractJdBooksFromAnchors, filterJdBooksAgainstTencentRows } from "./jd-search.mjs";

const rootDir = process.cwd();
const artifactsDir = path.join(rootDir, "artifacts");
const configPath = path.join(rootDir, "config", "workflow.config.json");
const logPath = path.join(rootDir, "data", "recommended-log.json");

const config = JSON.parse(await fs.readFile(configPath, "utf8"));
const maxCandidates = Number(process.env.MAX_CANDIDATES || config.maxCandidates || 10);
const tencentDocUrl = process.env.TENCENT_DOC_URL;
const tencentDocCsvUrl = process.env.TENCENT_DOC_CSV_URL;
const jdSearchUrl = process.env.JD_SEARCH_URL || config.jdSearchUrl || "https://e.jd.com/view_search";
const jdSearchKeywords = parseList(process.env.JD_SEARCH_KEYWORDS || "").length > 0
  ? parseList(process.env.JD_SEARCH_KEYWORDS)
  : config.jdSearchKeywords || [];

await fs.mkdir(artifactsDir, { recursive: true });

const recommendedLog = await readJsonArray(logPath);
const sourceRows = await loadTencentRows();
const tencentBooks = sourceRows.map((row, index) => normalizeRow(row, index + 1));
const jdSearch = await searchJdBooks(maxCandidates * 4);
const selection = filterJdBooksAgainstTencentRows(jdSearch.books, tencentBooks, recommendedLog, maxCandidates);
await writeSelectionDiagnostics({ ...selection, rawRowCount: sourceRows.length, jdSearch });

const enriched = await enrichWithJd(selection.selected);
await writeArtifacts(enriched);

async function loadTencentRows() {
  if (tencentDocCsvUrl) {
    const response = await fetch(tencentDocCsvUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch TENCENT_DOC_CSV_URL: ${response.status}`);
    }
    return parseCsv(await response.text());
  }

  if (!tencentDocUrl) {
    throw new Error("Set TENCENT_DOC_CSV_URL or TENCENT_DOC_URL in repository secrets.");
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto(tencentDocUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.locator("body").waitFor({ state: "visible", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(3000);

    const tableRows = await page.locator("table tr").evaluateAll((rows) =>
      rows.map((row) => Array.from(row.querySelectorAll("th,td")).map((cell) => cell.innerText.trim()))
    ).catch(() => []);

    let parsedRows = rowsFromMatrix(tableRows);

    if (parsedRows.length === 0) {
      const visibleText = await page.locator("body").innerText();
      await writeTencentDiagnostics(page, visibleText);
      parsedRows = parseLooseTextTable(visibleText);
    }

    return parsedRows;
  } catch (error) {
    await writeTencentDiagnostics(page, `Tencent document load failed: ${error.message}`).catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
}

async function enrichWithJd(books) {
  if (books.length === 0) return [];

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const enriched = [];

  for (const book of books) {
    const jd = book.jdUrl ? await readJdBook(page, book.jdUrl) : { verified: false, reason: "缺少京东读书链接" };
    enriched.push({ ...book, jd });
  }

  await browser.close();
  return enriched;
}

async function searchJdBooks(targetCount) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const searches = jdSearchKeywords.length > 0 ? jdSearchKeywords : [""];
  const books = [];
  const diagnostics = [];

  try {
    for (const keyword of searches) {
      if (books.length >= targetCount) break;
      const result = await searchJdPage(page, keyword);
      diagnostics.push(result.diagnostic);
      books.push(...result.books);
    }
  } finally {
    await browser.close();
  }

  const unique = [];
  const seen = new Set();
  for (const book of books) {
    const key = normalize(book.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(book);
    if (unique.length >= targetCount) break;
  }

  await fs.writeFile(
    path.join(artifactsDir, "jd-search-debug.json"),
    `${JSON.stringify({ diagnostics, books: unique }, null, 2)}\n`,
    "utf8"
  );
  return { books: unique, diagnostics };
}

async function searchJdPage(page, keyword) {
  await page.goto(jdSearchUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator("body").waitFor({ state: "visible", timeout: 30000 });
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});

  if (keyword) {
    const input = page.locator("input[type='search'], input[type='text']").first();
    if (await input.count()) {
      await input.fill(keyword);
      await input.press("Enter").catch(() => {});
      await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    }
  }

  await page.waitForTimeout(2500);
  const anchors = await page.locator("a").evaluateAll((nodes) =>
    nodes.map((node) => ({
      text: node.innerText || node.textContent || "",
      href: node.href || ""
    }))
  );
  const books = extractJdBooksFromAnchors(anchors, page.url());

  await fs.writeFile(
    path.join(artifactsDir, `jd-search-${safeFilePart(keyword || "default")}.txt`),
    await page.locator("body").innerText().catch(() => ""),
    "utf8"
  );

  return {
    books,
    diagnostic: {
      keyword,
      url: page.url(),
      anchors: anchors.length,
      books: books.length
    }
  };
}

async function readJdBook(page, url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(1500);

    const finalUrl = page.url();
    const title = await firstText(page, [
      "h1",
      ".book-title",
      ".title",
      "meta[property='og:title']"
    ]);
    const description = await metaContent(page, "meta[name='description'], meta[property='og:description']");
    const image = await metaContent(page, "meta[property='og:image']");
    const visibleText = await page.locator("body").innerText().catch(() => "");
    const chapters = extractFirstFourChaptersFromText(visibleText);

    return {
      verified: /jd\.com|jdread|e-m\.jd\.com/i.test(finalUrl),
      url: finalUrl,
      title,
      description,
      image,
      chapters
    };
  } catch (error) {
    return {
      verified: false,
      url,
      reason: error.message
    };
  }
}

async function firstText(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      if (selector.startsWith("meta")) {
        const content = await locator.getAttribute("content");
        if (content) return content.trim();
      } else {
        const text = await locator.innerText().catch(() => "");
        if (text.trim()) return text.trim();
      }
    }
  }
  return "";
}

async function metaContent(page, selector) {
  const locator = page.locator(selector).first();
  if (!(await locator.count())) return "";
  return (await locator.getAttribute("content"))?.trim() || "";
}

function normalizeRow(row, sourceIndex) {
  return {
    id: sourceIndex,
    title: pick(row, config.columns.title),
    author: pick(row, config.columns.author),
    jdUrl: pick(row, config.columns.jdUrl),
    category: pick(row, config.columns.category),
    status: pick(row, config.columns.status),
    notes: pick(row, config.columns.notes),
    sourceIndex
  };
}

function pick(row, aliases) {
  for (const alias of aliases) {
    const key = Object.keys(row).find((candidate) => candidate.trim().toLowerCase() === alias.toLowerCase());
    if (key && String(row[key]).trim()) return String(row[key]).trim();
  }
  return "";
}

function isExcludedStatus(status) {
  return config.excludedStatuses.some((excluded) => status.includes(excluded));
}

function isAlreadyRecommended(book, log) {
  return log.some((entry) => {
    const sameTitle = entry.title && book.title && normalize(entry.title) === normalize(book.title);
    const sameUrl = entry.jdUrl && book.jdUrl && entry.jdUrl === book.jdUrl;
    return sameTitle || sameUrl;
  });
}

function normalize(value) {
  return String(value).trim().toLowerCase().replace(/\s+/g, "");
}

function parseList(value) {
  return String(value || "").split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
}

function safeFilePart(value) {
  return String(value || "default").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 40) || "default";
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && quoted && next === '"') {
      field += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  return rowsFromMatrix(rows);
}

function rowsFromMatrix(matrix) {
  const clean = matrix.filter((row) => row.some((cell) => String(cell).trim()));
  if (clean.length < 2) return [];

  const headers = clean[0].map((cell) => String(cell).trim());
  return clean.slice(1).map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, String(row[index] || "").trim()]))
  );
}

function parseLooseTextTable(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const headerIndex = lines.findIndex((line) => line.includes("书名") && line.includes("作者"));
  if (headerIndex < 0) return [];

  const headers = lines[headerIndex].split(/\t| {2,}/).map((item) => item.trim()).filter(Boolean);
  return lines.slice(headerIndex + 1).map((line) => {
    const cells = line.split(/\t| {2,}/).map((item) => item.trim());
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] || ""]));
  });
}

async function readJsonArray(filePath) {
  try {
    const value = JSON.parse(await fs.readFile(filePath, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function selectCandidates(rows, log) {
  const normalized = rows.map((row, index) => normalizeRow(row, index + 1));
  const withoutTitle = normalized.filter((book) => !book.title);
  const statusExcluded = normalized.filter((book) => book.title && isExcludedStatus(book.status));
  const logExcluded = normalized.filter((book) =>
    book.title && !isExcludedStatus(book.status) && isAlreadyRecommended(book, log)
  );
  const selected = normalized.filter((book) =>
    book.title && !isExcludedStatus(book.status) && !isAlreadyRecommended(book, log)
  );

  return {
    rawRowCount: rows.length,
    normalized,
    withoutTitle,
    statusExcluded,
    logExcluded,
    selected
  };
}

async function writeTencentDiagnostics(page, visibleText) {
  await fs.writeFile(path.join(artifactsDir, "tencent-doc-visible-text.txt"), visibleText, "utf8");
  await fs.writeFile(path.join(artifactsDir, "tencent-doc-page.html"), await page.content(), "utf8");
  await page.screenshot({ path: path.join(artifactsDir, "tencent-doc-page.png"), fullPage: true });
}

async function writeArtifacts(books) {
  const jsonPath = path.join(artifactsDir, "candidates.json");
  const mdPath = path.join(artifactsDir, "candidates.md");
  await fs.writeFile(jsonPath, `${JSON.stringify(books, null, 2)}\n`, "utf8");
  await fs.writeFile(mdPath, renderMarkdown(books), "utf8");
}

async function writeSelectionDiagnostics(selection) {
  await fs.writeFile(
    path.join(artifactsDir, "selection-debug.json"),
    `${JSON.stringify(selection, null, 2)}\n`,
    "utf8"
  );

  const lines = [
    "# Selection Debug",
    "",
    `Raw rows read from Tencent document: ${selection.rawRowCount}`,
    `JD books found before filtering: ${selection.jdSearch.books.length}`,
    `Rows excluded by Tencent document status: ${selection.recommendedExcluded.length}`,
    `Rows excluded by recommended log: ${selection.logExcluded.length}`,
    `Duplicate JD rows excluded: ${selection.duplicateExcluded.length}`,
    `Rows selected: ${selection.selected.length}`,
    "",
    "## Selected Rows",
    "",
    ...selection.selected.map((book) => `- ${book.title} / ${book.jdUrl || "no url"} / ${book.status || "no Tencent status"}`)
  ];

  await fs.writeFile(path.join(artifactsDir, "selection-debug.md"), `${lines.join("\n")}\n`, "utf8");
}

function renderMarkdown(books) {
  const now = new Date().toISOString();
  const lines = [
    "## 本月电子书推荐候选清单",
    "",
    `生成时间：${now}`,
    "",
    "请在 Codex App 中让 Codex 读取这个 Issue，并在你确认后生成推荐网页。确认前不要直接生成文件。",
    "",
    "建议回复格式：`确认推荐第 1、3、5 本`。",
    ""
  ];

  if (books.length === 0) {
    lines.push("没有找到符合条件的候选书。");
    return `${lines.join("\n")}\n`;
  }

  for (const book of books) {
    lines.push(`### ${book.id}. ${book.title}`);
    lines.push(`- 作者：${book.author || "未提供"}`);
    lines.push(`- 分类：${book.category || "未提供"}`);
    lines.push(`- 候选序号：${book.sourceIndex}`);
    lines.push(`- 腾讯文档状态：${book.status || "未记录为已推荐"}`);
    lines.push(`- 京东读书链接：${book.jdUrl || "未提供"}`);
    lines.push(`- 京东读书校验：${book.jd?.verified ? "通过" : "未通过"}`);
    if (book.jd?.title) lines.push(`- 京东页面标题：${book.jd.title}`);
    if (book.jd?.description) lines.push(`- 京东简介：${book.jd.description}`);
    if (book.jd?.chapters?.some(Boolean)) lines.push(`- 京东前四章：${book.jd.chapters.filter(Boolean).join("；")}`);
    if (book.jd?.image) lines.push(`- 封面：${book.jd.image}`);
    if (book.notes) lines.push(`- 备注：${book.notes}`);
    if (book.jd?.reason) lines.push(`- 抓取提示：${book.jd.reason}`);
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}
