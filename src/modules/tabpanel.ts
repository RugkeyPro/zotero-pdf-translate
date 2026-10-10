import { config } from "../../package.json";
import { AgentPanel } from "./agent/panel";
import { rootItem } from "./agent/storage";
const windows = new Map<Window, () => void>();
export function registerReaderTabPanel() {}
export function registerAgentWindow(win: Window) {
  if (windows.has(win)) return;
  const doc = win.document;
  const html = (tag: string) =>
    doc.createElementNS("http://www.w3.org/1999/xhtml", tag) as HTMLElement;
  const surfaces: {
    host: HTMLElement;
    body: HTMLElement;
    panel: AgentPanel;
    button: HTMLElement;
    active: boolean;
    original: HTMLElement;
  }[] = [];
  const style = html("style");
  style.textContent = `.agent-surface{display:none;position:absolute;inset:0;min-height:0;min-width:0;overflow:hidden}.agent-surface.active{display:flex}.agent-surface .agent-pane{height:100%;min-height:0;max-height:none;border:0;border-radius:0}.agent-surface-host{position:relative;min-height:0;min-width:0}.agent-nav{width:36px;height:38px;padding:7px;border:0;background:transparent;cursor:pointer;border-radius:8px;flex-shrink:0}.agent-nav:hover,.agent-nav[aria-pressed="true"]{background:var(--color-accent-light,#e8edff)}.agent-nav img{width:22px;height:22px}.agent-surface-host.agent-active>.agent-original{visibility:hidden!important}`;
  doc.documentElement.append(style);
  function mount(id: string, originalID: string) {
    const nav = doc.getElementById(id),
      original = doc.getElementById(originalID) as HTMLElement;
    if (!nav || !original || surfaces.some((s) => s.original === original))
      return;
    const host = original.parentElement!;
    host.classList.add("agent-surface-host");
    original.classList.add("agent-original");
    const body = html("div");
    body.className = "agent-surface";
    host.insertBefore(body, original);
    const button = html("button");
    button.className = "agent-nav";
    button.setAttribute("aria-label", "文献助手");
    button.title = "文献助手";
    button.setAttribute("aria-pressed", "false");
    const image = html("img");
    image.setAttribute(
      "src",
      `chrome://${config.addonRef}/content/icons/agent.svg`,
    );
    button.append(image);
    nav.append(button);
    const panel = new AgentPanel(body);
    const surface = { host, body, panel, button, active: false, original };
    surfaces.push(surface);
    const toggle = (active: boolean) => {
      surface.active = active;
      host.classList.toggle("agent-active", active);
      body.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    };
    button.onclick = () => {
      toggle(!surface.active);
      if (originalID === "zotero-context-pane-inner") {
        const context = doc.getElementById("zotero-context-pane");
        context?.setAttribute("collapsed", "false");
        doc
          .getElementById("zotero-context-splitter")
          ?.setAttribute("state", "open");
      }
      sync();
    };
    const close = () => toggle(false);
    panel.onClose = close;
    const leave = (e: Event) => {
      if (!(e.target as Element).closest(".agent-nav")) close();
    };
    nav.addEventListener("click", leave, true);
    cleanups.push(() => {
      nav.removeEventListener("click", leave, true);
      toggle(false);
      panel.dispose();
      body.remove();
      button.remove();
      original.classList.remove("agent-original");
      host.classList.remove("agent-surface-host");
    });
  }
  const cleanups: (() => void)[] = [];
  function sync() {
    mount("zotero-view-item-sidenav", "zotero-item-pane-content");
    mount("zotero-context-pane-sidenav", "zotero-context-pane-inner");
    const tab = (win as any).Zotero_Tabs;
    const reader =
      tab?.selectedID !== "zotero-pane"
        ? Zotero.Reader.getByTabID(tab?.selectedID)
        : undefined;
    const item = reader?.itemID
      ? Zotero.Items.get(reader.itemID)
      : (win as any).ZoteroPane?.getSelectedItems()?.[0];
    if (item) for (const s of surfaces) void s.panel.setItem(rootItem(item));
  }
  const timer = win.setInterval(sync, 700);
  sync();
  windows.set(win, () => {
    win.clearInterval(timer);
    for (const f of cleanups) f();
    style.remove();
    windows.delete(win);
  });
}
export function unregisterAgentWindow(win: Window) {
  windows.get(win)?.();
}
export function updateReaderTabPanels() {}
