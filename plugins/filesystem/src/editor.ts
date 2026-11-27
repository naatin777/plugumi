// editor panelのview entry。CodeMirror 6でfileを編集する。
// 開くfileはcontext.inputの{path}。read/writeはview channelで
// runtime（filesystem provider）へ委ねる — fs操作の二重実装を置かない。
import { defineView } from "@plugumi/view";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { go } from "@codemirror/lang-go";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { cpp } from "@codemirror/lang-cpp";
import type { RuntimeMessage, ViewMessage } from "./shared.js";

// 拡張子からlanguageを選ぶ。不明なものはplain textのまま。
const languageFor = (path: string) => {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  switch (ext) {
    case "js": case "mjs": case "cjs": return javascript();
    case "ts": case "mts": case "cts": return javascript({ typescript: true });
    case "jsx": return javascript({ jsx: true });
    case "tsx": return javascript({ typescript: true, jsx: true });
    case "json": return json();
    case "md": case "markdown": return markdown();
    case "py": return python();
    case "rs": return rust();
    case "go": return go();
    case "css": return css();
    case "html": case "htm": return html();
    case "c": case "h": case "cpp": case "cc": case "hpp": case "cxx": return cpp();
    default: return [];
  }
};

// hostのtokenに追従する最小のtheme。色はvar(--plugumi-*)だけ使う。
const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "var(--plugumi-font-size-md, 13px)",
    backgroundColor: "transparent",
    color: "var(--plugumi-colors-text)",
  },
  ".cm-content": {
    fontFamily: "var(--plugumi-fonts-mono, monospace)",
    caretColor: "var(--plugumi-colors-accent)",
    padding: "var(--plugumi-spacing-sm) 0",
  },
  ".cm-cursor": { borderLeftColor: "var(--plugumi-colors-accent)" },
  "&.cm-focused": { outline: "none" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--plugumi-colors-text-muted)",
    border: "none",
    fontFamily: "var(--plugumi-fonts-mono, monospace)",
  },
  ".cm-activeLine": { backgroundColor: "color-mix(in oklab, var(--plugumi-colors-accent) 6%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent" },
  "& .cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "color-mix(in oklab, var(--plugumi-colors-accent) 22%, transparent)",
  },
}, { dark: false });

export const mount = defineView<ViewMessage, RuntimeMessage>((host, channel, context) => {
  const input = context.input as { path?: string } | undefined;
  const filePath = input?.path;

  const container = document.createElement("div");
  container.style.height = "100%";
  container.style.display = "flex";
  container.style.flexDirection = "column";

  // 上部のstatus行 — file名とdirty/save状態。editor本体の一部として出す。
  const status = document.createElement("div");
  status.style.padding = "2px var(--plugumi-spacing-sm)";
  status.style.fontSize = "var(--plugumi-font-size-sm, 12px)";
  status.style.color = "var(--plugumi-colors-text-muted)";
  status.style.fontFamily = "var(--plugumi-fonts-mono, monospace)";
  status.style.flexShrink = "0";

  const editorParent = document.createElement("div");
  editorParent.style.flex = "1";
  editorParent.style.minHeight = "0";
  container.append(status, editorParent);
  host.replaceChildren(container);

  let dirty = false;
  const renderStatus = () => {
    status.textContent = filePath
      ? `${filePath}${dirty ? " ●" : ""}`
      : "（inputにpathがありません — Files panelから開いてください）";
  };

  const view = new EditorView({
    parent: editorParent,
    state: EditorState.create({
      doc: "",
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        bracketMatching(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        editorTheme,
        filePath ? languageFor(filePath) : [],
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !dirty) {
            dirty = true;
            renderStatus();
          }
        }),
      ],
    }),
  });

  const save = () => {
    if (!filePath) return;
    channel.send({ type: "write", path: filePath, content: view.state.doc.toString() });
  };
  // Cmd/Ctrl+Sでsave。browserのsave dialogを止めるためcaptureする。
  const onKeydown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "s") {
      event.preventDefault();
      save();
    }
  };
  window.addEventListener("keydown", onKeydown, true);

  renderStatus();
  if (filePath) channel.send({ type: "read", path: filePath });

  channel.onMessage((message) => {
    if (message.type === "content" && message.path === filePath) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: message.content } });
      dirty = false;
      renderStatus();
    }
    if (message.type === "saved" && message.path === filePath) {
      dirty = false;
      renderStatus();
    }
    if (message.type === "error") {
      status.textContent = `error: ${message.message}`;
    }
  });

  return {
    destroy() {
      window.removeEventListener("keydown", onKeydown, true);
      view.destroy();
      host.replaceChildren();
    },
  };
});
