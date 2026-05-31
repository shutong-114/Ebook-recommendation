import test from "node:test";
import assert from "node:assert/strict";

import { extractFirstFourChaptersFromText } from "../scripts/chapter-extract.mjs";
import { extractJdBooksFromAnchors, filterJdBooksAgainstTencentRows } from "../scripts/jd-search.mjs";

test("extracts the first four Chinese chapter names from page text", () => {
  const text = `
    目录
    第一章 心理史学家
    第二章 百科全书编者
    第三章 市长
    第四章 行商
    第五章 商业王侯
  `;

  assert.deepEqual(extractFirstFourChaptersFromText(text), [
    "心理史学家",
    "百科全书编者",
    "市长",
    "行商"
  ]);
});

test("filters JD search books against Tencent recommended statuses", () => {
  const jdBooks = [
    { title: "已推书", jdUrl: "https://e.jd.com/a" },
    { title: "新书", jdUrl: "https://e.jd.com/b" },
    { title: "日志已有", jdUrl: "https://e.jd.com/c" }
  ];
  const tencentBooks = [
    { title: "已推书", status: "已推荐" },
    { title: "新书", status: "" }
  ];
  const log = [{ title: "日志已有" }];

  const result = filterJdBooksAgainstTencentRows(jdBooks, tencentBooks, log, 10);

  assert.deepEqual(result.selected.map((book) => book.title), ["新书"]);
  assert.equal(result.recommendedExcluded.length, 1);
  assert.equal(result.logExcluded.length, 1);
});

test("extracts likely book titles from JD anchors", () => {
  const result = extractJdBooksFromAnchors([
    { text: "￥31.58", href: "" },
    { text: "宝贵的人生建议", href: "/123.html" },
    { text: "京东读书VIP年卡", href: "/vip.html" }
  ], "https://e.jd.com/view_search");

  assert.deepEqual(result.map((book) => book.title), ["宝贵的人生建议"]);
  assert.equal(result[0].jdUrl, "https://e.jd.com/123.html");
});
