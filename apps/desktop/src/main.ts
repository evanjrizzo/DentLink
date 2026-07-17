import "./styles.css";

type MacroContext = {
  active: boolean;
  apps: string[];
  muted: boolean;
  error: string;
};

type MacroResult = {
  ok: boolean;
  message: string;
};

type TauriCore = {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
};

declare global {
  interface Window {
    __TAURI__?: {
      core?: TauriCore;
    };
  }
}

const DENTLINK_WEB_URL =
  import.meta.env.VITE_DENTLINK_WEB_URL ?? "https://dentlink-web-preview.pages.dev";
const DENTLINK_WEB_ORIGIN = new URL(DENTLINK_WEB_URL).origin;
const DESKTOP_SESSION_STORAGE_KEY = "dentlink.desktop.auth.session.v1";
const DENTLINK_DESKTOP_URL = desktopUrl(DENTLINK_WEB_URL);

const DEFAULT_MACROS = [
  { label: "Phone", action: "command:scrcpy", icon: "phone" },
  { label: "Files", action: "open_files", icon: "files" },
  { label: "Terminal", action: "command:cosmic-term", icon: "terminal" },
  { label: "Assistant", action: "assistant", icon: "assistant" }
] as const;

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing app root");

app.innerHTML = `
  <main class="desktop-shell">
    <section class="web-pane" aria-label="DentLink">
      <iframe
        id="dentlink-frame"
        title="DentLink"
        src="${DENTLINK_DESKTOP_URL}"
        allow="clipboard-read; clipboard-write"
      ></iframe>
    </section>
    <aside class="macro-pad" aria-label="Macro pad">
      <div id="context-actions" class="macro-section"></div>
      <div id="macro-actions" class="macro-section"></div>
    </aside>
  </main>
`;

const frame = requireElement<HTMLIFrameElement>("#dentlink-frame");
const contextActions = requireElement<HTMLDivElement>("#context-actions");
const macroActions = requireElement<HTMLDivElement>("#macro-actions");

function desktopUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("dentlinkDesktop", "1");
  url.searchParams.set("desktopRevision", String(Date.now()));
  return url.toString();
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Desktop UI failed to initialize ${selector}`);
  return element;
}

function tauriCore(): TauriCore | null {
  return window.__TAURI__?.core ?? null;
}

function renderMacroButtons(context: MacroContext | null): void {
  contextActions.innerHTML = "";
  if (context?.active) {
    const call = document.createElement("span");
    call.className = "call-context";
    call.textContent = `Call: ${context.apps.slice(0, 2).join(", ")}`;
    contextActions.append(call);
    contextActions.append(
      macroButton(context.muted ? "Unmute" : "Mute", "mute_toggle", "mute"),
      macroButton("Voice FX", "voice_fx_toggle", "voice")
    );
  }

  macroActions.innerHTML = "";
  for (const macro of DEFAULT_MACROS) {
    macroActions.append(macroButton(macro.label, macro.action, macro.icon));
  }
}

function macroButton(label: string, action: string, icon: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "macro-button";
  button.dataset.action = action;
  button.setAttribute("aria-label", label);
  button.title = label;
  button.innerHTML = `<span class="macro-icon">${iconGlyph(icon)}</span><strong class="macro-label">${label}</strong>`;
  button.addEventListener("click", () => void runMacro(action));
  return button;
}

async function runMacro(action: string): Promise<void> {
  if (action === "refresh") {
    const currentUrl = frame.src;
    frame.src = currentUrl;
    setStatus("Refreshed DentLink", true);
    return;
  }
  if (
    action === "assistant" ||
    action === "history" ||
    action === "settings" ||
    action === "rerank"
  ) {
    frame.contentWindow?.postMessage(
      { type: "dentlink.desktop.macro", action },
      DENTLINK_WEB_ORIGIN
    );
    if (action === "assistant") return;
  }

  const core = tauriCore();
  if (!core) {
    return;
  }
  try {
    const result = await core.invoke<MacroResult>("run_macro", { action });
    setStatus(result.message, result.ok);
    if (action === "mute_toggle" || action === "voice_fx_toggle") await refreshContext();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), false);
  }
}

async function refreshContext(): Promise<void> {
  const core = tauriCore();
  if (!core) {
    renderMacroButtons(null);
    return;
  }
  try {
    const context = await core.invoke<MacroContext>("macro_context");
    renderMacroButtons(context);
  } catch (error) {
    renderMacroButtons(null);
    setStatus(error instanceof Error ? error.message : String(error), false);
  }
}

function setStatus(message: string, ok: boolean): void {
  void message;
  void ok;
  // Status is intentionally hidden on the touchscreen macro pad.
}

function sendStoredSession(): void {
  frame.contentWindow?.postMessage(
    {
      type: "dentlink.desktop.session.response",
      session: storedDesktopSession()
    },
    DENTLINK_WEB_ORIGIN
  );
}

function storedDesktopSession(): unknown {
  const rawSession = window.localStorage.getItem(DESKTOP_SESSION_STORAGE_KEY);
  if (!rawSession) return null;
  try {
    return JSON.parse(rawSession);
  } catch {
    window.localStorage.removeItem(DESKTOP_SESSION_STORAGE_KEY);
    return null;
  }
}

window.addEventListener("message", (event) => {
  if (event.source !== frame.contentWindow || event.origin !== DENTLINK_WEB_ORIGIN) return;
  const data = event.data as { type?: string; session?: unknown } | null;
  if (!data) return;
  if (data.type === "dentlink.web.session.request") {
    sendStoredSession();
    return;
  }
  if (data.type === "dentlink.web.session.store") {
    window.localStorage.setItem(DESKTOP_SESSION_STORAGE_KEY, JSON.stringify(data.session));
    return;
  }
  if (data.type === "dentlink.web.session.clear") {
    window.localStorage.removeItem(DESKTOP_SESSION_STORAGE_KEY);
  }
});

frame.addEventListener("load", sendStoredSession);

function iconGlyph(icon: string): string {
  const common =
    'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';
  if (icon === "phone") {
    return `<svg ${common}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.32 1.77.59 2.61a2 2 0 0 1-.45 2.11L8 9.69a16 16 0 0 0 6.31 6.31l1.25-1.25a2 2 0 0 1 2.11-.45c.84.27 1.71.47 2.61.59A2 2 0 0 1 22 16.92Z"/></svg>`;
  }
  if (icon === "files") {
    return `<svg ${common}><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.1a2 2 0 0 1-1.6-.8l-.6-.8A2 2 0 0 0 9.1 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z"/><path d="M2 10h20"/></svg>`;
  }
  if (icon === "terminal") {
    return `<svg ${common}><path d="m7 8 4 4-4 4"/><path d="M12 16h5"/><rect x="3" y="4" width="18" height="16" rx="2"/></svg>`;
  }
  if (icon === "mute") {
    return `<svg ${common}><path d="M12 2a3 3 0 0 0-3 3v5a3 3 0 0 0 5.12 2.12"/><path d="M15 9.34V5a3 3 0 0 0-4.64-2.51"/><path d="M19 10v2a7 7 0 0 1-.78 3.22"/><path d="M5 10v2a7 7 0 0 0 11.95 4.95"/><path d="M12 19v3"/><path d="M8 22h8"/><path d="m2 2 20 20"/></svg>`;
  }
  if (icon === "voice") {
    return `<svg ${common}><path d="M4 12h2"/><path d="M9 6v12"/><path d="M13 4v16"/><path d="M17 8v8"/><path d="M21 11v2"/></svg>`;
  }
  if (icon === "assistant") {
    return `<svg ${common}><path d="M5 6.5A3.5 3.5 0 0 1 8.5 3h7A3.5 3.5 0 0 1 19 6.5v5A3.5 3.5 0 0 1 15.5 15H12l-4 4v-4A3.5 3.5 0 0 1 5 11.5v-5Z"/><path d="M9 8h6"/><path d="M9 11h3"/></svg>`;
  }
  return `<svg ${common}><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>`;
}

renderMacroButtons(null);
void refreshContext();
window.setInterval(() => void refreshContext(), 5000);
