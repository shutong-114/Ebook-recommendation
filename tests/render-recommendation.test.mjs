import test from "node:test";
import assert from "node:assert/strict";

import { decodeTextBuffer, renderRecommendationHtml } from "../scripts/render-recommendation.mjs";

const template = `<p>
\t<span style="color:DarkGreen;"><strong>内容简介</strong></span>：旧内容
<p>
\t<br />
</p>
<p>
\t<span style="color:DarkGreen;"><strong>作者简介</strong></span>：旧作者
<p>
\t<br />
</p>
<p>
\t<span style="color:DarkGreen;"><strong>推荐理由</strong></span>：旧理由
<p>
\t<br />
</p>
<p>
\t<span style="color:DarkGreen;"><strong>目录</strong></span> 
</p>
<p>
\t第一章 旧一
</p>
<p>
\t第二章 旧二
</p>
<p>
\t第三章 旧三
</p>
<p>
\t第四章 旧四
</p>
<p>
\t……
</p>
<p>保持不变</p>`;

test("renders only the approved recommendation fields", () => {
  const output = renderRecommendationHtml(template, {
    contentIntro: "新内容",
    authorIntro: "新作者",
    recommendation: "新理由",
    chapters: ["新一", "新二", "新三", "新四"]
  });

  assert.match(output, /内容简介<\/strong><\/span>：新内容/);
  assert.match(output, /作者简介<\/strong><\/span>：新作者/);
  assert.match(output, /推荐理由<\/strong><\/span>：新理由/);
  assert.match(output, /第一章 新一/);
  assert.match(output, /第二章 新二/);
  assert.match(output, /第三章 新三/);
  assert.match(output, /第四章 新四/);
  assert.match(output, /<p>保持不变<\/p>/);
  assert.doesNotMatch(output, /旧内容|旧作者|旧理由|旧一|旧二|旧三|旧四/);
});

test("decodes GB18030 template text", () => {
  const gb18030Bytes = Buffer.from([0xc4, 0xda, 0xc8, 0xdd, 0xbc, 0xf2, 0xbd, 0xe9]);

  assert.equal(decodeTextBuffer(gb18030Bytes), "内容简介");
});
