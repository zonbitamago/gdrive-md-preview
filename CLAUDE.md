# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

Google Drive の `.md` プレビューがプレーンテキストのままで読みにくい問題を解決する
**Tampermonkey ユーザースクリプト**(`userscript/drive-md-preview.user.js`)。
ビルド工程は無く、この 1 ファイルがそのまま配布物。本体は約 1 ファイルに完結する。

## コマンド

```bash
npm run check                                  # 構文チェック(node --check)
npm test                                       # 全ユニットテスト(node --test)
node --test test/userscript.test.js            # ファイル単位で実行
node --test --test-name-pattern="transformMermaidGlobals"  # 名前で1テストだけ実行
```

依存パッケージは無い(`node:test` のみ)。CI(`.github/workflows/ci.yml`、Node 20)で
push / PR 時に `npm run check` と `npm test` を実行する。

## アーキテクチャ(重要)

### 単一ファイル + テスト可能の両立
`drive-md-preview.user.js` は **factory 形式**でラップしてある:

```js
(function (factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api; // Node(テスト)
  if (typeof document !== "undefined") api.__bootstrap();                    // ブラウザ/Tampermonkey
})(function () { /* ... */ return { /* 純粋関数 */, __bootstrap }; });
```

- **副作用(スタイル注入・監視ループ起動)は `__bootstrap()` に隔離**してあり、`document`
  がある環境でのみ走る。Tampermonkey では `module` が無いので export はスキップされる。
- このため **Node から `require` しても副作用が起きず**、`return` で公開した純粋関数を
  そのままテストできる。**ビルドステップ無しで「単一ファイル配布」と「ユニットテスト」を両立**
  させている。この構造を壊さないこと(関数を別ファイルに切り出すと build が必要になる)。

### テスト対象は純粋関数のみ
`test/userscript.test.js` がテストするのは export された純粋関数だけ:
`isMarkdownName` / `makeKey` / `transformMermaidGlobals` / `computePanelBox` /
`clampPanelPosition` / `buildStandaloneDoc` / `MD_EXT`。
**DOM 検知・Tampermonkey 連携・Drive の挙動は本質的に実機確認が必要**でユニットテスト対象外
(後述の「環境依存の罠」を参照)。新しいロジックを足すときは、可能な限り純粋関数として
切り出し export してテストする方針。

### 実行時の流れ(DOM 側、テスト対象外)
1. `__bootstrap()` が `MutationObserver`(document.body subtree)+ `setInterval(1500)` +
   `popstate`/`hashchange` で `check()` を起動。**URL は当てにできない**(後述)。
2. `check()` が `findViewerText()`(`div[jsname="JOC2Se"]` の innerText)でビューア本文を検出し、
   `findFileName()`(`[role="dialog"]` 内の最短 `.md` テキスト)でファイル名を得る。
   内容キー `currentKey`(ファイル名+本文長)で重複描画を抑止。
3. 既定では右下に **2 ボタンのピル**(📄 整形表示 / ⧉ 別タブ)を表示。自動でパネルは開かない。
4. 「整形表示」→ `renderPanel()`(`marked`→`DOMPurify`→innerHTML、ヘッダーでドラッグ移動・
   右下リサイズ・ソース切替)。「別タブ」→ `openHtmlInNewTab()`(blob で独立タブ)。

## 環境依存の罠(このプロジェクト最大の知見。変更時に再発させないこと)

- **Drive のプレビューは URL が変わらない**: フォルダ内プレビューでも URL は
  `/drive/folders/...` のままで `/file/d/<ID>/` にならず、`document.title` もフォルダ名。
  → 検知は URL ではなく `div[jsname="JOC2Se"]`(ビューア内テキスト)を直接読む。
- **Trusted Types による注入ブロック**: Drive は `require-trusted-types-for 'script'` を有効化。
  Tampermonkey の通常注入は弾かれ、ユーザースクリプトが**一切実行されない**(起動ログも出ない)。
  → 利用者は `chrome://extensions` → Tampermonkey 詳細 → **「ユーザースクリプトを許可」を ON**
  にする必要がある(組織で禁止されがちな「デベロッパーモード」とは別物)。
- **Mermaid の遅延ロード(eval 方式)の 2 つの罠**(`loadMermaid`):
  1. esbuild の global-name バンドル末尾 `globalThis.__esbuild_esm_xxx[...]` が、strict な間接
     eval では top-level var が global に漏れず undefined で落ちる →
     `transformMermaidGlobals` で `globalThis.(__esbuild_esm_\w+)` をローカル参照へ置換。
  2. Tampermonkey サンドボックスの `globalThis` と eval 内の `globalThis` が別物 →
     グローバル読みに頼らず `(0,eval)(code + "\n;globalThis.mermaid;")` の**戻り値**で受け取る。
- **別タブ(blob)は開いた文書(Drive)の CSP を継承する**: Drive の `script-src` は
  `strict-dynamic` + nonce のため、新タブに `<script src>` やインライン `<script>` を入れても
  **実行できない**(v2.6.0 でこれを踏んで Mermaid が出なくなった)。
  → 新タブはスクリプトを一切含めない静的 HTML にする。Mermaid は userScripts 領域
  (CSP 対象外)側で SVG に**事前描画**して埋め込む(`renderMarkdownToStaticHtml`)。
  非同期描画とポップアップブロックの両立のため、`window.open("","_blank")` で空タブを
  **同期的に**開いてから、描画完了後に `win.location.href = blobURL` で遷移させる。
  (inline `<style>` は通る = style-src は許容。ブロックされるのは script だけ。)
- **GM_addStyle が CSP で無効化される可能性**に備え、パネルの致命的スタイル(位置・サイズ・
  重なり)は `applyBaseStyle` が **CSSOM で直接当てる**(stylesheet と二重化)。
- **ポップアップブロック回避**: 別タブを開く処理は `await` を挟まず**ユーザー操作と同期的に**
  `window.open` する。Mermaid は新タブ側でレンダリングする(userscript 側で待たない)。

## 変更時の約束ごと

- 機能/挙動を変えたら **`@version`(userscript)と `package.json` の version を両方上げる**。
  `@downloadURL`/`@updateURL` は GitHub raw を指しており、これで Tampermonkey が自動更新する。
- 純粋ロジックを追加・修正したら `test/userscript.test.js` を更新し、`npm test` を通す。
- DOM/連携部分は CI では検証できない。実機(Drive で `.md` プレビュー)での確認が必要。
- 公開リポジトリ。コミット作者はローカル git config で `zonbitamago <…@users.noreply.github.com>`
  を使用(会社メールを公開しない)。
