import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const chapterLabels = ["第一章", "第二章", "第三章", "第四章"];

export function renderRecommendationHtml(template, book) {
  assertBookShape(book);

  let output = template;
  output = replaceSection(output, "内容简介", book.contentIntro);
  output = replaceSection(output, "作者简介", book.authorIntro);
  output = replaceSection(output, "推荐理由", book.recommendation);

  book.chapters.slice(0, 4).forEach((chapterName, index) => {
    output = replaceChapter(output, chapterLabels[index], chapterName);
  });

  return output;
}

export function decodeTextBuffer(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(buffer);
  }
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(buffer);
  }

  const utf8 = new TextDecoder("utf-8").decode(buffer);
  if (!utf8.includes("\uFFFD")) {
    return utf8;
  }

  return new TextDecoder("gb18030").decode(buffer);
}

function replaceSection(template, label, value) {
  const marker = `<strong>${label}</strong></span>：`;
  const markerIndex = template.indexOf(marker);
  if (markerIndex < 0) {
    throw new Error(`Template section not found: ${label}`);
  }

  const contentStart = markerIndex + marker.length;
  const contentEnd = template.indexOf("\n<p>", contentStart);
  if (contentEnd < 0) {
    throw new Error(`Template section end not found: ${label}`);
  }

  return `${template.slice(0, contentStart)}${escapeHtml(value)}${template.slice(contentEnd)}`;
}

function replaceChapter(template, label, value) {
  const expression = new RegExp(`(\\n\\s*)${label}[^\\n<]*(\\n\\s*</p>)`);
  if (!expression.test(template)) {
    throw new Error(`Template chapter not found: ${label}`);
  }
  return template.replace(expression, `$1${label} ${escapeHtml(value)}$2`);
}

function assertBookShape(book) {
  const requiredTextFields = ["contentIntro", "authorIntro", "recommendation"];
  for (const field of requiredTextFields) {
    if (!book[field] || typeof book[field] !== "string") {
      throw new Error(`Missing required text field: ${field}`);
    }
  }

  if (!Array.isArray(book.chapters) || book.chapters.length < 4) {
    throw new Error("Missing required chapters array with at least 4 items.");
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function main() {
  const [, , inputPath, outputPathArg] = process.argv;
  if (!inputPath) {
    throw new Error("Usage: node scripts/render-recommendation.mjs <book.json> [output.html]");
  }

  const rootDir = process.cwd();
  const config = JSON.parse(await fs.readFile(path.join(rootDir, "config", "workflow.config.json"), "utf8"));
  const template = decodeTextBuffer(await fs.readFile(path.join(rootDir, config.templatePath)));
  const book = JSON.parse(await fs.readFile(path.resolve(inputPath), "utf8"));
  const output = renderRecommendationHtml(template, book);
  const outputPath = outputPathArg || path.join(rootDir, "output", `${safeName(book.title || "book")}.html`);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, output, "utf8");
  console.log(`Wrote ${outputPath}`);
}

function safeName(value) {
  return String(value).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim() || "book";
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
