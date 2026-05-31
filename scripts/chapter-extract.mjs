const chapterPatterns = [
  /第一[章节回]\s*[：:、.]?\s*(.+)/,
  /第二[章节回]\s*[：:、.]?\s*(.+)/,
  /第三[章节回]\s*[：:、.]?\s*(.+)/,
  /第四[章节回]\s*[：:、.]?\s*(.+)/
];

export function extractFirstFourChaptersFromText(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return chapterPatterns.map((pattern) => {
    const line = lines.find((candidate) => pattern.test(candidate));
    if (!line) return "";
    return line.match(pattern)[1].replace(/\s+/g, " ").trim();
  });
}
