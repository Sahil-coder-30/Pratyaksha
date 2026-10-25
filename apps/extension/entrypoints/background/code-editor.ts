// Code editors (Monaco on LeetCode, CodeMirror, Ace) keep their text in a JS
// object, not in the DOM: Monaco only renders the visible lines, and typing
// into its hidden textarea adds auto-closed brackets and indents twice. So the
// editor is driven through its own API, in the page's MAIN world where that
// object lives (the content script's isolated world cannot see it).
import { waitForTabLoad } from "./page.js";

export type EditorOp = "read" | "write" | "format" | "wait_change";

export type PageEditorResult =
  | { ok: true; kind: string; language: string; code: string; lines: number; format?: string; changed?: boolean }
  | { ok: false; error: "NO_EDITOR" | "READ_ONLY" | "WRITE_FAILED"; reason: string };

// Time to wait for a changed text, after a format.
const FORMAT_WAIT_MS = 5_000;

export async function pageEditor(tabId: number, op: EditorOp, text = ""): Promise<PageEditorResult> {
  await waitForTabLoad(tabId);
  const [frame] = await browser.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: runInPage,
    args: [op, text, FORMAT_WAIT_MS],
  });
  return (frame?.result as PageEditorResult | undefined) ?? { ok: false, error: "NO_EDITOR", reason: "the page gave no answer" };
}

// Serialized into the page: it must not use anything from outside its own body.
// - read: the biggest visible editor's language and code.
// - write: replace all of its code (one undo step), then check it took.
// - format: run the editor's own format action (LeetCode's "Format code", or
//   Monaco's Format Document), then wait for the text to change.
// - wait_change: wait for the text to differ from `text` (after a Format click).
async function runInPage(op: EditorOp, text: string, waitMs: number): Promise<PageEditorResult> {
  interface Editor {
    kind: string;
    area: number;
    readOnly: boolean;
    language: () => string;
    get: () => string;
    set: (code: string) => void;
    format?: () => Promise<string | null>;
  }
  const w = window as any;
  const areaOf = (el: Element | null | undefined) => {
    const r = el?.getBoundingClientRect();
    return r && r.width > 0 && r.height > 0 ? r.width * r.height : 0;
  };
  const editors: Editor[] = [];

  const monaco = w.monaco?.editor;
  for (const ed of monaco?.getEditors?.() ?? []) {
    const model = ed.getModel?.();
    if (!model || typeof ed.executeEdits !== "function") continue;
    const readOnlyOption = monaco.EditorOption?.readOnly;
    editors.push({
      kind: "Monaco",
      area: areaOf(ed.getDomNode?.()),
      readOnly: readOnlyOption !== undefined && Boolean(ed.getOption(readOnlyOption)),
      language: () => model.getLanguageId?.() ?? model.getModeId?.() ?? "",
      get: () => model.getValue(),
      set: (code) => {
        // executeEdits, not typing: no auto-closed brackets, no auto-indent, and one undo step.
        ed.pushUndoStop();
        ed.executeEdits("bigfish", [{ range: model.getFullModelRange(), text: code, forceMoveMarkers: true }]);
        ed.pushUndoStop();
        ed.setPosition({ lineNumber: 1, column: 1 });
        ed.revealLine(1);
      },
      format: async () => {
        // A site's own format action (LeetCode registers "format-code") first, then Monaco's built-in one.
        const actions: any[] = ed.getSupportedActions?.() ?? [];
        const own = actions.find((a) => !String(a.id).startsWith("editor.action.") && /^format( code| document)?$/i.test(String(a.label ?? "").trim()));
        const builtIn = ed.getAction?.("editor.action.formatDocument");
        const action = own ?? (builtIn?.isSupported?.() ? builtIn : null);
        if (!action) return null;
        await action.run();
        return String(action.label ?? "Format");
      },
    });
  }
  // An older Monaco without getEditors: only the models are known.
  if (editors.length === 0 && monaco?.getModels) {
    for (const model of monaco.getModels()) {
      editors.push({
        kind: "Monaco",
        area: 0,
        readOnly: false,
        language: () => model.getLanguageId?.() ?? model.getModeId?.() ?? "",
        get: () => model.getValue(),
        set: (code) => model.pushEditOperations([], [{ range: model.getFullModelRange(), text: code }], () => null),
      });
    }
  }

  // CodeMirror 6 keeps its EditorView on the content element.
  for (const el of Array.from(document.querySelectorAll(".cm-content"))) {
    const view = (el as any).cmView?.view ?? (el as any).cmView?.rootView?.view;
    if (!view?.state?.doc) continue;
    editors.push({
      kind: "CodeMirror",
      area: areaOf(el.closest(".cm-editor") ?? el),
      readOnly: Boolean(view.state.readOnly),
      language: () => (el as HTMLElement).dataset.language ?? "",
      get: () => view.state.doc.toString(),
      set: (code) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } }),
    });
  }

  // CodeMirror 5.
  for (const el of Array.from(document.querySelectorAll(".CodeMirror"))) {
    const cm = (el as any).CodeMirror;
    if (!cm?.getValue) continue;
    editors.push({
      kind: "CodeMirror",
      area: areaOf(el),
      readOnly: Boolean(cm.getOption?.("readOnly")),
      language: () => {
        const mode = cm.getOption?.("mode");
        return String(typeof mode === "string" ? mode : mode?.name ?? "");
      },
      get: () => cm.getValue(),
      set: (code) => cm.setValue(code),
    });
  }

  // Ace (Codeforces, GeeksforGeeks).
  for (const el of Array.from(document.querySelectorAll(".ace_editor"))) {
    const ace = (el as any).env?.editor;
    if (!ace?.getValue) continue;
    editors.push({
      kind: "Ace",
      area: areaOf(el),
      readOnly: Boolean(ace.getReadOnly?.()),
      language: () => String(ace.session?.getMode?.()?.$id ?? "").replace(/^ace\/mode\//, ""),
      get: () => ace.getValue(),
      set: (code) => ace.setValue(code, -1),
    });
  }

  // The biggest visible one is the main editor (LeetCode also has a hidden one for test input).
  const editor = editors.sort((a, b) => b.area - a.area)[0];
  if (!editor) return { ok: false, error: "NO_EDITOR", reason: "no Monaco, CodeMirror or Ace editor on this page" };
  const normalize = (s: string) => s.replace(/\r\n?/g, "\n");
  const answer = (extra: { format?: string; changed?: boolean } = {}): PageEditorResult => {
    const code = normalize(editor.get());
    return { ok: true, kind: editor.kind, language: editor.language(), code, lines: code.split("\n").length, ...extra };
  };
  const waitForChange = async (before: string) => {
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      if (normalize(editor.get()) !== before) return true;
      await new Promise((r) => setTimeout(r, 150));
    }
    return false;
  };

  if (op === "read") return answer();
  if (op === "write") {
    if (editor.readOnly) return { ok: false, error: "READ_ONLY", reason: `the ${editor.kind} editor is read-only` };
    editor.set(text);
    if (normalize(editor.get()) !== normalize(text)) return { ok: false, error: "WRITE_FAILED", reason: "the editor did not keep the new code" };
    return answer();
  }
  const before = normalize(op === "format" ? editor.get() : text);
  if (op === "format") {
    const label = editor.format ? await editor.format() : null;
    if (!label) return answer();
    return answer({ format: label, changed: await waitForChange(before) });
  }
  return answer({ changed: await waitForChange(before) });
}
