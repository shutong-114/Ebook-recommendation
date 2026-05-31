import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { extractFirstFourChaptersFromText } from "./chapter-extract.mjs";

const rootDir = process.cwd();
const artifactsDir = path.join(rootDir, "artifacts");
const configPath = path.join(rootDir, "config", "workflow.config.json");
const logPath = path.join(rootDir, "data", "recommended-log.json");

const config = JSON.parse(await fs.readFile(configPath, "utf8"));
const maxCandidates = Number(process.env.MAX_CANDIDATES || config.maxCandidates || 10);
const tencentDocUrl = process.env.TENCENT_DOC_URL;
const tencentDocCsvUrl = process.env.TENCENT_DOC_CSV_URL;

await fs.mkdir(artifactsDir, { recursive: true });

const recommendedLog = await readJsonArray(logPath);
const sourceRows = await loadTencentRows();
const candidates = sourceRows
  .map((row, index) => normalizeRow(row, index + 1))
  .filter((book) => book.title)
  .filter((book) => !isExcludedStatus(book.status))
  .filter((book) => !isAlreadyRecommended(book, recommendedLog))
  .slice(0, maxCandidates);

const enriched = await enrichWithJd(candidates);
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
    lines.push(`- 腾讯文档来源行：${book.sourceIndex}`);
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
