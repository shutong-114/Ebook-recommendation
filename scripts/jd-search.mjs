const blockedTitlePatterns = [
  /京东读书VIP/,
  /JDRead/i,
  /阅读器/,
  /VIP[年月季周]卡/i,
  /电子书AI阅读/,
  /去购物车/,
  /京东首页/,
  /在线阅读/,
  /全部分类/
];

export function filterJdBooksAgainstTencentRows(jdBooks, tencentBooks, recommendedLog, limit) {
  const selected = [];
  const recommendedExcluded = [];
  const logExcluded = [];
  const duplicateExcluded = [];

  for (const book of jdBooks) {
    const titleKey = normalize(book.title);
    if (!titleKey) continue;

    if (selected.some((selectedBook) => normalize(selectedBook.title) === titleKey)) {
      duplicateExcluded.push(book);
      continue;
    }

    const tencentMatch = tencentBooks.find((row) => normalize(row.title) === titleKey);
    if (tencentMatch && isRecommendedStatus(tencentMatch.status)) {
      recommendedExcluded.push({ ...book, tencentMatch });
      continue;
    }

    const logMatch = recommendedLog.find((entry) => normalize(entry.title) === titleKey || (entry.jdUrl && entry.jdUrl === book.jdUrl));
    if (logMatch) {
      logExcluded.push({ ...book, logMatch });
      continue;
    }

    selected.push({ ...book, status: tencentMatch?.status || "", sourceIndex: selected.length + 1 });
    if (selected.length >= limit) break;
  }

  return {
    selected,
    recommendedExcluded,
    logExcluded,
    duplicateExcluded
  };
}

export function extractJdBooksFromAnchors(anchors, baseUrl) {
  const books = [];
  const seen = new Set();

  for (const anchor of anchors) {
    const title = cleanTitle(anchor.text);
    if (!isLikelyBookTitle(title)) continue;

    const jdUrl = normalizeUrl(anchor.href, baseUrl);
    const key = `${normalize(title)}|${jdUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);

    books.push({
      title,
      author: "",
      jdUrl,
      category: "京东读书搜索",
      status: "",
      notes: ""
    });
  }

  return books;
}

export function isRecommendedStatus(status) {
  return ["已推荐", "跳过", "不推荐"].some((excluded) => String(status || "").includes(excluded));
}

function isLikelyBookTitle(title) {
  if (!title || title.length < 2 || title.length > 80) return false;
  if (/^￥|\d+期免息|好评率|多买优惠|爆款|趋势好物|满减|加载中/.test(title)) return false;
  return !blockedTitlePatterns.some((pattern) => pattern.test(title));
}

function cleanTitle(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^Image:\s*/i, "")
    .trim();
}

function normalizeUrl(value, baseUrl) {
  if (!value) return "";
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function normalize(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
}
