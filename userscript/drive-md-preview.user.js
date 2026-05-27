// ==UserScript==
// @name         Drive Markdown Preview
// @namespace    gdrive-md-preview
// @version      2.2.2
// @description  Google Drive で Markdown(.md)ファイルのプレビューを整形表示する
// @match        https://drive.google.com/*
// @run-at       document-idle
// @require      https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js
// @require      https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      cdn.jsdelivr.net
// @noframes
// ==/UserScript==

// Drive のフォルダ内プレビューは URL が /drive/folders/... のまま変化せず、
// document.title もフォルダ名になる。そのため URL からファイルを検知する
// 旧方式は使えない。代わりに、ビューア(role="dialog")内のテキストコンテナ
// (div[jsname="JOC2Se"])に既に表示されている生マークダウンを直接読み取って
// 整形する。本文取得・OAuth・ファイル ID 不要。

(() => {
  "use strict";

  const PANEL_ID = "gmd-panel";
  const PILL_ID = "gmd-pill";
  const MD_EXT = /\.(md|markdown|mdown|mkd|mdwn)$/i;
  // ビューア内の生テキストが入るコンテナ(Drive の内部 jsname)。
  const TEXT_SELECTOR = 'div[jsname="JOC2Se"]';
  // Mermaid は大きい(~3MB)ので必要時のみ遅延ロードする。
  const MERMAID_URL =
    "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js";

  // デバッグログ。原因切り分けが必要なときは DEBUG を true にすると
  // Console に "[GMD]" 付きで状態が出る(通常は静か)。
  const DEBUG = false;
  const LOG = (...a) => {
    if (DEBUG) console.log("[GMD]", ...a);
  };
  let lastStatus = "";

  // 現在検出中の Markdown ビューアの内容キー(ファイル名+本文長)。
  // 内容が変わったときだけピル/パネルを作り直す判定に使う。
  let currentKey = null;

  // --- スタイル -------------------------------------------------------------

  GM_addStyle(`
#gmd-panel{position:fixed;top:64px;left:50%;transform:translateX(-50%);
  z-index:2147483000;width:min(900px,92vw);max-height:calc(100vh - 96px);
  display:flex;flex-direction:column;background:#fff;color:#1f2328;
  border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.35);overflow:hidden;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Hiragino Sans',Meiryo,sans-serif}
#gmd-panel.gmd-loading,#gmd-panel.gmd-error{padding:16px 20px;font-size:14px;
  flex-direction:row;align-items:center;gap:12px;width:auto;max-width:92vw}
#gmd-panel.gmd-error{background:#fff0f0;color:#b3261e}
.gmd-header{display:flex;align-items:center;gap:8px;padding:10px 14px;
  background:#f6f8fa;border-bottom:1px solid #d0d7de}
.gmd-title{flex:1;min-width:0;font-size:13px;font-weight:600;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis}
.gmd-btn{flex:none;border:1px solid #d0d7de;background:#fff;color:#1f2328;
  border-radius:6px;padding:4px 10px;font-size:12px;line-height:1.4;cursor:pointer}
.gmd-btn:hover{background:#eef1f4}
.gmd-close{font-size:16px;line-height:1;padding:3px 9px;font-weight:700}
.gmd-body{padding:24px 32px 40px;overflow-y:auto;font-size:15px;line-height:1.7}
.gmd-source{margin:0;white-space:pre-wrap;word-break:break-word;
  font-family:Consolas,Menlo,monospace;font-size:13px;line-height:1.6}
#gmd-pill{position:fixed;right:24px;bottom:24px;z-index:2147483000;border:none;
  background:#1a73e8;color:#fff;border-radius:22px;padding:10px 16px;font-size:13px;
  font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.3)}
#gmd-pill:hover{background:#1666c1}
.gmd-body.markdown-body>*:first-child{margin-top:0}
.markdown-body h1,.markdown-body h2,.markdown-body h3,.markdown-body h4,
.markdown-body h5,.markdown-body h6{margin:24px 0 16px;font-weight:600;line-height:1.3}
.markdown-body h1{font-size:1.9em;padding-bottom:.3em;border-bottom:1px solid #d8dee4}
.markdown-body h2{font-size:1.5em;padding-bottom:.3em;border-bottom:1px solid #d8dee4}
.markdown-body h3{font-size:1.25em}
.markdown-body p,.markdown-body ul,.markdown-body ol,.markdown-body blockquote,
.markdown-body table,.markdown-body pre{margin:0 0 16px}
.markdown-body ul,.markdown-body ol{padding-left:2em}
.markdown-body li+li{margin-top:4px}
.markdown-body code{background:rgba(175,184,193,.2);padding:.2em .4em;border-radius:6px;
  font-size:85%;font-family:Consolas,Menlo,monospace}
.markdown-body pre{background:#f6f8fa;padding:16px;border-radius:8px;overflow-x:auto}
.markdown-body pre code{background:none;padding:0;font-size:100%}
.markdown-body blockquote{padding:0 1em;color:#57606a;border-left:4px solid #d0d7de}
.markdown-body table{border-collapse:collapse;display:block;width:max-content;
  max-width:100%;overflow:auto}
.markdown-body th,.markdown-body td{border:1px solid #d0d7de;padding:6px 13px}
.markdown-body th{background:#f6f8fa;font-weight:600}
.markdown-body tr:nth-child(2n){background:#f6f8fa}
.markdown-body img{max-width:100%}
.markdown-body a{color:#0969da;text-decoration:none}
.markdown-body a:hover{text-decoration:underline}
.markdown-body hr{height:1px;border:0;background:#d8dee4;margin:24px 0}
.gmd-mermaid{margin:0 0 16px;text-align:center;overflow-x:auto}
.gmd-mermaid svg{max-width:100%;height:auto}
`);

  // GM_addStyle が CSP 等で無効化されても最低限パネルが見えるよう、
  // 位置・重なり・背景など致命的なスタイルは CSSOM で直接当てる。
  function applyBaseStyle(el) {
    Object.assign(el.style, {
      position: "fixed",
      top: "64px",
      left: "50%",
      transform: "translateX(-50%)",
      zIndex: "2147483000",
      width: "min(900px,92vw)",
      maxHeight: "calc(100vh - 96px)",
      display: "flex",
      flexDirection: "column",
      background: "#fff",
      color: "#1f2328",
      borderRadius: "12px",
      boxShadow: "0 12px 40px rgba(0,0,0,.35)",
      overflow: "hidden",
    });
  }

  // --- 検出・抽出 -----------------------------------------------------------

  // ビューア内のテキストコンテナのうち、最も本文量が多いものを返す。
  function findViewerText() {
    let best = null;
    document.querySelectorAll(TEXT_SELECTOR).forEach((el) => {
      const t = el.innerText || "";
      if (t.trim().length > 20 && (!best || t.length > best.text.length)) {
        best = { el, text: t };
      }
    });
    return best;
  }

  // ビューアダイアログ内・本文コンテナ外にある最短の .md テキスト = ファイル名。
  // 本文中の "./03_…md" リンク参照と誤認しないよう本文コンテナは除外する。
  function findFileName(textEl) {
    const scope = textEl.closest('[role="dialog"]') || document;
    let name = null;
    let shortest = Infinity;
    scope.querySelectorAll("*").forEach((el) => {
      if (textEl.contains(el) || el.contains(textEl)) return;
      const t = (el.textContent || "").trim();
      if (t.length <= 120 && t.length < shortest && MD_EXT.test(t)) {
        name = t;
        shortest = t.length;
      }
    });
    return name;
  }

  function toHtml(markdown) {
    const dirty = marked.parse(markdown, { gfm: true, breaks: false });
    return DOMPurify.sanitize(dirty, { ADD_ATTR: ["target"] });
  }

  // --- Mermaid(遅延ロード) ------------------------------------------------

  let mermaidLib = null; // ロード済みインスタンス
  let mermaidLoading = null; // ロード中の Promise(多重ロード防止)
  let mermaidSeq = 0; // 描画 ID 採番

  // 初回の Mermaid 図検出時にだけライブラリを取得・実行する。
  // userScripts 領域はページ CSP/Trusted Types の対象外なので eval が使える。
  function loadMermaid() {
    if (mermaidLib) return Promise.resolve(mermaidLib);
    if (mermaidLoading) return mermaidLoading;
    mermaidLoading = new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest === "undefined") {
        reject(new Error("GM_xmlhttpRequest が使えません"));
        return;
      }
      GM_xmlhttpRequest({
        method: "GET",
        url: MERMAID_URL,
        onload: (res) => {
          try {
            if (res.status < 200 || res.status >= 300)
              throw new Error("HTTP " + res.status);
            // esbuild の global-name バンドルは末尾で
            //   globalThis["mermaid"] = globalThis.__esbuild_esm_xxx["mermaid"].default
            // を実行するが、strict な間接 eval では top-level の var が global に
            // 漏れず globalThis.__esbuild_esm_xxx が undefined になって落ちる。
            // そこで globalThis 経由の参照を eval 内ローカル var 参照へ書き換える。
            const code = res.responseText.replace(
              /globalThis\.(__esbuild_esm_\w+)/g,
              "$1"
            );
            // Tampermonkey サンドボックスの globalThis と eval 内(真のグローバル
            // スコープ)の globalThis は別オブジェクトのことがある。グローバル
            // 読みに頼らず、eval の戻り値(末尾式の completion value)で受け取る。
            const lib = (0, eval)(code + "\n;globalThis.mermaid;");
            if (!lib || typeof lib.initialize !== "function")
              throw new Error("mermaid を取得できませんでした");
            lib.initialize({ startOnLoad: false, securityLevel: "strict" });
            mermaidLib = lib;
            resolve(lib);
          } catch (e) {
            reject(e);
          }
        },
        onerror: () => reject(new Error("ネットワークエラー")),
      });
    });
    return mermaidLoading;
  }

  // 描画済みパネル内の ```mermaid ブロックを SVG に置き換える。
  // 失敗時はコードブロックのまま残す(全体は壊さない)。
  async function renderMermaid(container) {
    const blocks = container.querySelectorAll("code.language-mermaid");
    if (!blocks.length) return;

    let lib;
    try {
      lib = await loadMermaid();
    } catch (e) {
      LOG("mermaid load failed:", e && e.message);
      return;
    }

    for (const code of blocks) {
      if (!code.isConnected) continue; // 再描画等で外れていたらスキップ
      const pre = code.closest("pre") || code;
      const src = code.textContent;
      const id = "gmd-mmd-" + mermaidSeq++;
      try {
        const { svg } = await lib.render(id, src);
        const wrap = document.createElement("div");
        wrap.className = "gmd-mermaid";
        wrap.innerHTML = svg; // mermaid(securityLevel:strict)でサニタイズ済み
        pre.replaceWith(wrap);
      } catch (e) {
        LOG("mermaid render error:", e && e.message);
        // 失敗時に残る一時要素を掃除する。
        document.getElementById(id)?.remove();
        document.getElementById("d" + id)?.remove();
      }
    }
  }

  // --- パネル ---------------------------------------------------------------

  // パネルとピルの両方を DOM から取り除く。
  function removePanel() {
    document.getElementById(PANEL_ID)?.remove();
    document.getElementById(PILL_ID)?.remove();
  }

  function showPill() {
    document.getElementById(PANEL_ID)?.remove();
    if (document.getElementById(PILL_ID)) return;
    const pill = document.createElement("button");
    pill.id = PILL_ID;
    pill.type = "button";
    pill.textContent = "📄 Markdown を整形表示";
    pill.addEventListener("click", () => {
      // ピル押下時に現在のビューア本文を読み取ってパネルを開く。
      const found = findViewerText();
      if (!found) return;
      const fileName = findFileName(found.el) || "";
      renderPanel(fileName, found.text);
    });
    document.body.appendChild(pill);
  }

  function applyLinkTargets(root) {
    root.querySelectorAll("a[href]").forEach((a) => {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    });
  }

  function renderPanel(fileName, source) {
    removePanel();

    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    applyBaseStyle(panel);
    let showingSource = false;

    // @require のライブラリが読めていない場合は可視のエラーを出す。
    if (typeof marked === "undefined" || typeof DOMPurify === "undefined") {
      LOG("library missing", { marked: typeof marked, DOMPurify: typeof DOMPurify });
      Object.assign(panel.style, { padding: "16px 20px", background: "#fff0f0", color: "#b3261e" });
      panel.textContent =
        "marked / DOMPurify が読み込めていません(@require の取得失敗の可能性)。";
      document.body.appendChild(panel);
      return;
    }

    const html = toHtml(source);

    const header = document.createElement("div");
    header.className = "gmd-header";

    const title = document.createElement("span");
    title.className = "gmd-title";
    // タイトルは描画後にドキュメント先頭の見出しから決める(下で上書き)。
    title.textContent = "Markdown プレビュー";

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "gmd-btn";
    toggleBtn.textContent = "ソース表示";

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "gmd-btn gmd-close";
    closeBtn.setAttribute("aria-label", "閉じる");
    closeBtn.textContent = "×";

    header.append(title, toggleBtn, closeBtn);

    const body = document.createElement("div");
    body.className = "gmd-body markdown-body";

    // 整形表示を描く(初回・ソースからの復帰の両方で使う)。
    const showRendered = () => {
      body.innerHTML = html; // html は toHtml() で DOMPurify サニタイズ済み
      body.classList.add("markdown-body");
      applyLinkTargets(body);
      renderMermaid(body); // Mermaid 図があれば非同期で SVG に差し替え
    };

    showRendered();

    // タイトルは先頭の見出しテキストを使う(ファイル名の誤検知を避ける)。
    const heading = body.querySelector("h1, h2, h3");
    const headingText = heading ? heading.textContent.trim() : "";
    title.textContent = headingText || "Markdown プレビュー";

    toggleBtn.addEventListener("click", () => {
      showingSource = !showingSource;
      if (showingSource) {
        const pre = document.createElement("pre");
        pre.className = "gmd-source";
        pre.textContent = source;
        body.replaceChildren(pre);
        body.classList.remove("markdown-body");
        toggleBtn.textContent = "整形表示";
      } else {
        showRendered();
        toggleBtn.textContent = "ソース表示";
      }
    });

    closeBtn.addEventListener("click", () => {
      // 閉じたらピル表示に戻す(自動では再オープンしない)。
      showPill();
    });

    panel.append(header, body);
    document.body.appendChild(panel);
  }

  // --- 監視ループ -----------------------------------------------------------

  function check() {
    try {
      const found = findViewerText();
      // 状態が変わったときだけログを出す(1.5秒ごとの洪水を防ぐ)。
      const status = found
        ? "viewer textLen=" + found.text.length
        : "no-viewer (" + document.querySelectorAll(TEXT_SELECTOR).length + " jsname matches)";
      if (status !== lastStatus) {
        lastStatus = status;
        LOG("check:", status);
      }

      if (!found) {
        // ビューアを閉じた → パネルもピルも片付ける
        removePanel();
        currentKey = null;
        return;
      }

      const fileName = findFileName(found.el);
      if (!fileName || !MD_EXT.test(fileName)) {
        // テキストビューアだが Markdown ではない(or 名前未検出)→ 片付ける
        removePanel();
        currentKey = null;
        return;
      }

      const key = fileName + "|" + found.text.length;
      // 同じ内容なら現状(ピル or 開いているパネル)をそのまま維持する。
      if (key === currentKey) return;

      // 新しい Markdown を検出 → 既定はボタン(ピル)だけ表示。
      // パネルはユーザーがピルを押したときに開く(自動では開かない)。
      LOG("detected:", fileName);
      currentKey = key;
      showPill();
    } catch (e) {
      LOG("check ERROR:", e && e.message, e);
    }
  }

  let timer = null;
  function scheduleCheck() {
    clearTimeout(timer);
    timer = setTimeout(check, 250);
  }

  // URL は変わらないので、DOM 変化・履歴・定期実行の合わせ技で開閉を検知する。
  new MutationObserver(scheduleCheck).observe(document.body, {
    childList: true,
    subtree: true,
  });
  window.addEventListener("popstate", scheduleCheck);
  window.addEventListener("hashchange", scheduleCheck);
  setInterval(scheduleCheck, 1500);

  scheduleCheck();
})();
