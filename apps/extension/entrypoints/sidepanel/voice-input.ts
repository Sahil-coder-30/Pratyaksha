// Voice to text for the prompt box, using Chrome's built-in Web Speech API.
// The side panel cannot show the mic permission prompt, so on "not-allowed"
// we open mic-permission.html in a tab once. The grant then applies to the
// whole extension origin, side panel included.

// TypeScript's DOM lib does not ship Web Speech types. Only what we use.
interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly 0: { readonly transcript: string };
}

interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: { readonly length: number; readonly [index: number]: SpeechRecognitionResultLike | undefined };
}

interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
}

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const LISTENING_HINT = "Listening... tap the mic to stop";
const ERROR_HINT_MS = 6000;

const ERROR_MESSAGES: Record<string, string> = {
  "not-allowed": "Allow the microphone in the tab that opened, then tap the mic again.",
  "no-speech": "No speech heard. Try again.",
  "audio-capture": "No microphone found.",
  network: "Voice input needs an internet connection.",
  "service-not-allowed": "Voice input is not available in this browser.",
  "language-not-supported": "Your browser language is not supported for voice input.",
};

export interface VoiceInputOptions {
  input: HTMLTextAreaElement;
  button: HTMLButtonElement;
  // Small text next to the input. Shows "Listening" and errors, then goes back to its own text.
  hint: HTMLElement;
}

export interface VoiceInput {
  // Stop listening and drop any pending speech. Call before clearing the box.
  cancel(): void;
}

export function setupVoiceInput({ input, button, hint }: VoiceInputOptions): VoiceInput {
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  const Recognition = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Recognition) {
    button.hidden = true;
    return { cancel() {} };
  }

  const idleHint = hint.textContent ?? "";
  let hintTimer: ReturnType<typeof setTimeout> | undefined;
  let recognition: SpeechRecognitionLike | null = null;
  // Text in the box before dictation started. Speech is appended after it.
  let baseText = "";
  let finalText = "";
  let discarded = false;

  const setHint = (text: string, state: "idle" | "listening" | "error") => {
    clearTimeout(hintTimer);
    hint.textContent = text;
    hint.dataset.state = state;
    if (state === "error") hintTimer = setTimeout(() => setHint(idleHint, "idle"), ERROR_HINT_MS);
  };

  const setListening = (on: boolean) => {
    button.dataset.listening = String(on);
    button.title = on ? "Stop voice input" : "Voice input";
    button.setAttribute("aria-pressed", String(on));
  };

  const render = (interim: string) => {
    const spoken = `${finalText}${interim}`.trim();
    input.value = baseText && spoken ? `${baseText} ${spoken}` : baseText || spoken;
    // Reuse the textarea's auto-resize handler.
    input.dispatchEvent(new Event("input"));
  };

  const start = () => {
    const rec = new Recognition();
    rec.lang = navigator.language || "en-US";
    rec.continuous = true;
    rec.interimResults = true;

    baseText = input.value.trim();
    finalText = "";
    discarded = false;

    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (!result) continue;
        if (result.isFinal) finalText += `${result[0].transcript} `;
        else interim += result[0].transcript;
      }
      render(interim);
    };

    rec.onerror = (e) => {
      if (e.error === "aborted") return;
      setHint(ERROR_MESSAGES[e.error] ?? `Voice input failed: ${e.error}`, "error");
      if (e.error === "not-allowed") {
        void browser.tabs.create({ url: browser.runtime.getURL("/mic-permission.html") });
      }
    };

    rec.onend = () => {
      recognition = null;
      setListening(false);
      if (hint.dataset.state === "listening") setHint(idleHint, "idle");
      if (discarded) return;
      render("");
      input.focus();
    };

    try {
      rec.start();
    } catch (err) {
      setHint(`Voice input failed: ${err instanceof Error ? err.message : String(err)}`, "error");
      return;
    }
    recognition = rec;
    setListening(true);
    setHint(LISTENING_HINT, "listening");
  };

  button.addEventListener("click", () => {
    if (recognition) recognition.stop();
    else start();
  });

  return {
    cancel() {
      if (!recognition || discarded) return;
      discarded = true;
      recognition.abort();
    },
  };
}
