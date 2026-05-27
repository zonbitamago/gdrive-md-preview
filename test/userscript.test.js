// 純粋ロジックのユニットテスト(依存なし・node:test)。
//   npm test  /  node --test
//
// 注意: ここでテストできるのは DOM/Tampermonkey に依存しない純粋関数のみ。
// Drive の DOM 構造検知や Tampermonkey の実挙動(Trusted Types 等)は
// 本質的に実機でしか確認できない。

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  isMarkdownName,
  makeKey,
  transformMermaidGlobals,
  MD_EXT,
} = require("../userscript/drive-md-preview.user.js");

test("isMarkdownName: Markdown 拡張子を判定する", () => {
  for (const ok of [
    "a.md",
    "README.markdown",
    "x.mdown",
    "y.mkd",
    "z.mdwn",
    "01_システム要件定義書.md",
    "A.MD",
  ]) {
    assert.equal(isMarkdownName(ok), true, `${ok} は md であるべき`);
  }
  for (const ng of [
    "a.txt",
    "a.mdx",
    "a.pdf",
    "noext",
    "md",
    "a.md.txt",
    "",
    null,
    undefined,
    123,
  ]) {
    assert.equal(isMarkdownName(ng), false, `${String(ng)} は md でないべき`);
  }
});

test("makeKey: ファイル名と本文長で内容キーを作る", () => {
  assert.equal(makeKey("a.md", 100), "a.md|100");
  // 本文長が変われば別キー(= 再描画される)
  assert.notEqual(makeKey("a.md", 100), makeKey("a.md", 101));
  // ファイル名が変われば別キー
  assert.notEqual(makeKey("a.md", 100), makeKey("b.md", 100));
});

test("transformMermaidGlobals: globalThis.__esbuild_esm_* をローカル参照へ書き換える", () => {
  const src =
    'globalThis["mermaid"]=globalThis.__esbuild_esm_mermaid_nm["mermaid"].default;';
  assert.equal(
    transformMermaidGlobals(src),
    'globalThis["mermaid"]=__esbuild_esm_mermaid_nm["mermaid"].default;'
  );
});

test("transformMermaidGlobals: 対象が無ければ何も変えない", () => {
  const src = "window.mermaid = (function () { return {}; })();";
  assert.equal(transformMermaidGlobals(src), src);
});

test("transformMermaidGlobals: 実際の esbuild パターンが eval で解決できる", () => {
  // mermaid@11 dist/mermaid.min.js の構造を模した最小ケース
  const bundle =
    '"use strict";var __esbuild_esm_mermaid_nm;' +
    "(__esbuild_esm_mermaid_nm||={}).mermaid=(()=>({default:{initialize(){},render(){}}}))();" +
    'globalThis["mermaid"]=globalThis.__esbuild_esm_mermaid_nm["mermaid"].default;';

  // 前提を固定(他テストの副作用に影響されないように)
  delete globalThis.__esbuild_esm_mermaid_nm;
  delete globalThis.mermaid;

  // 書き換え前: strict な間接 eval では top-level var が global に漏れず落ちる
  assert.throws(() => (0, eval)(bundle), /Cannot read properties of undefined/);

  // 書き換え後: eval の戻り値(末尾式)で mermaid を受け取れる
  const lib = (0, eval)(
    transformMermaidGlobals(bundle) + "\n;globalThis.mermaid;"
  );
  assert.equal(typeof lib.initialize, "function");
  assert.equal(typeof lib.render, "function");

  delete globalThis.mermaid; // 後始末
});

test("MD_EXT: エクスポートした正規表現が直接使える", () => {
  assert.ok(MD_EXT.test("a.md"));
  assert.ok(!MD_EXT.test("a.txt"));
});
