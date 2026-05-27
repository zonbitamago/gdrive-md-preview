# Drive Markdown Preview

[![CI](https://github.com/zonbitamago/gdrive-md-preview/actions/workflows/ci.yml/badge.svg)](https://github.com/zonbitamago/gdrive-md-preview/actions/workflows/ci.yml)

Google Drive で `.md`(Markdown)ファイルのプレビューを開いたとき、プレーン
テキストの代わりに**整形済みの表示**を重ねて見せる Tampermonkey ユーザー
スクリプトです。

- 見出し・リスト・表・コードブロック・リンクなどを GitHub 風にレンダリング
- **Mermaid 図(` ```mermaid ` ブロック)を SVG に描画**(必要時のみ遅延ロード)
- 「ソース表示 / 整形表示」をワンクリックで切り替え
- パネルは**ヘッダーをドラッグで移動 / 右下でサイズ変更**(位置・サイズはセッション中記憶)
- 「**⧉ 別タブ**」ボタンで整形済み内容(Mermaid 図含む)を独立タブに表示
- `.md` プレビューを開くとボタンを表示し、押すとパネルが開く。OAuth・API キー不要

## 前提

組織管理下の Chrome などでデベロッパーモードが使えず、自作拡張の「未パッケージ
読み込み」ができない環境を想定しています。Chrome ウェブストアからの拡張
インストールが許可されていれば利用できます。

## 導入手順

1. Chrome ウェブストアから **Tampermonkey** をインストール
2. **重要**: `chrome://extensions` → Tampermonkey の **「詳細」** →
   **「ユーザースクリプトを許可(Allow user scripts)」を ON** にする
   （これは組織で禁止されがちな「デベロッパーモード」とは別のトグル。
   OFF のままだと後述の Trusted Types により**スクリプトが一切動きません**）
3. スクリプトを入れる（どちらかの方法で）

   **方法 A: ワンクリック（推奨）**
   次のリンクを開くと Tampermonkey のインストール画面が出ます:
   <https://raw.githubusercontent.com/zonbitamago/gdrive-md-preview/main/userscript/drive-md-preview.user.js>

   **方法 B: 手動貼り付け**
   Tampermonkey → ダッシュボード → **＋（新規スクリプト）** → テンプレートを
   全削除 → `userscript/drive-md-preview.user.js` の中身を全文貼り付けて保存

4. **Drive のタブを再読み込み**（保存だけでは反映されません）

> `@updateURL` を設定済みなので、一度インストールすれば以降は Tampermonkey が
> GitHub の最新版を自動でチェック・更新します。

## 使い方

1. Google Drive で `.md` ファイルをダブルクリックして開く
2. 右下に表示される **「📄 Markdown を整形表示」ボタン** を押す
3. 整形パネルが開く。操作:
   - **ヘッダーをドラッグ**: パネルを移動 / **右下隅をドラッグ**: サイズ変更
   - **⧉ 別タブ**: 整形済み内容を独立したブラウザタブで開く
   - **ソース表示**: 元の Markdown テキストに切り替え
   - **×**: パネルを閉じる（右下のボタンから再表示可能）

## 仕組み

Drive のフォルダ内プレビューは URL が `/drive/folders/...` のまま変化せず、
`document.title` もフォルダ名になるため、URL からファイルを検知できません。
そこで本スクリプトは、ビューア（`role="dialog"`）内のテキストコンテナ
（`div[jsname="JOC2Se"]`）に既に表示されている**生 Markdown を直接読み取って**
整形します。本文取得・OAuth・ファイル ID は不要です。

- レンダリング: `marked`（`@require` で CDN から読み込み）
- サニタイズ: `DOMPurify`（XSS 対策）
- Mermaid: 図を含む Markdown を開いたときだけ `GM_xmlhttpRequest` で
  `mermaid`（~3MB）を取得・実行する遅延ロード。図を含まない閲覧は重くならない
- 開閉・切り替えの検知: `MutationObserver` + 定期実行
- パネルのタイトル: ドキュメント先頭の見出し（h1〜h3）
- 配布・更新: `@downloadURL` / `@updateURL`（GitHub raw）で Tampermonkey が自動更新

## トラブルシューティング

- **何も表示されない / Console に Trusted Types のエラーが出る**
  （`This document requires 'TrustedScript' assignment.`）
  → 導入手順 2 の「ユーザースクリプトを許可」が OFF。ON にして Drive を再読み込み。
- **`@require` のライブラリが読めない**（組織が `cdn.jsdelivr.net` を遮断）
  → marked / DOMPurify をスクリプトに直接埋め込んだ自己完結版に切り替え可能。
- **デバッグ**: スクリプト冒頭の `DEBUG` を `true` にすると、Console に
  `[GMD]` 付きで検知状況が出力されます。

## 開発・テスト

ユーザースクリプトは**単一ファイルのまま** Node から `require` できる形にしてあり
(Tampermonkey 上では `module` が無いので export はスキップ)、純粋関数を
`node:test` でテストできます。**依存パッケージはありません。**

```
npm run check   # 構文チェック(node --check)
npm test        # ユニットテスト(node --test)
```

GitHub Actions(`.github/workflows/ci.yml`)で push / Pull Request 時に自動実行します。

テスト対象は純粋ロジック(`transformMermaidGlobals` / `isMarkdownName` /
`makeKey` など)に絞っています。Drive の DOM 構造の検知や Tampermonkey の
挙動(Trusted Types など)といった統合部分は、本質的に実機での確認が必要です。

## ファイル構成

```
userscript/drive-md-preview.user.js  … ユーザースクリプト本体
test/userscript.test.js              … 純粋ロジックのユニットテスト
package.json                         … テスト/構文チェックのスクリプト
.github/workflows/ci.yml             … CI(構文チェック + テスト)
README.md                            … このファイル
LICENSE                              … MIT ライセンス
```

## ライセンス

[MIT License](LICENSE)
