import test from "node:test";
import assert from "node:assert/strict";

import { extractFirstFourChaptersFromText } from "../scripts/chapter-extract.mjs";

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
