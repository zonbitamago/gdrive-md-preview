# Drive Markdown Preview

Google Drive で `.md`(Markdown)ファイルのプレビューを開いたとき、プレーン
テキストの代わりに**整形済みの表示**を重ねて見せる Tampermonkey ユーザー
スクリプトです。

- 見出し・リスト・表・コードブロック・リンクなどを GitHub 風にレンダリング
- **Mermaid 図(` ```mermaid ` ブロック)を SVG に描画**(必要時のみ遅延ロード)
- 「ソース表示 / 整形表示」をワンクリックで切り替え
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
3. Tampermonkey アイコン → **ダッシュボード** を開く
4. **＋(新規スクリプトを追加)** をクリックし、表示されるテンプレートを全削除
5. `userscript/drive-md-preview.user.js` の中身を全文貼り付け、保存（`Cmd/Ctrl + S`）
6. **Drive のタブを再読み込み**（保存だけでは反映されません）

## 使い方

1. Google Drive で `.md` ファイルをダブルクリックして開く
2. プレビューの上に整形済みパネルが**自動で**表示される
3. ヘッダーのボタン:
   - **ソース表示**: 元の Markdown テキストに切り替え
   - **×**: パネルを閉じる（右下のピルから再表示可能）

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

## トラブルシューティング

- **何も表示されない / Console に Trusted Types のエラーが出る**
  （`This document requires 'TrustedScript' assignment.`）
  → 導入手順 2 の「ユーザースクリプトを許可」が OFF。ON にして Drive を再読み込み。
- **`@require` のライブラリが読めない**（組織が `cdn.jsdelivr.net` を遮断）
  → marked / DOMPurify をスクリプトに直接埋め込んだ自己完結版に切り替え可能。
- **デバッグ**: スクリプト冒頭の `DEBUG` を `true` にすると、Console に
  `[GMD]` 付きで検知状況が出力されます。

## ファイル構成

```
userscript/drive-md-preview.user.js  … ユーザースクリプト本体
README.md                            … このファイル
```
