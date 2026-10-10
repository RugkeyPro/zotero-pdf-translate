import { getLocaleID } from "../utils/locale";
import { config } from "../../package.json";
import { AgentPanel } from "./agent/panel";
const panels = new Map<HTMLElement, AgentPanel>();
export function registerReaderTabPanel() {
  Zotero.ItemPaneManager.registerSection({
    paneID: "translate",
    pluginID: config.addonID,
    header: {
      l10nID: getLocaleID("itemPaneSection-header"),
      icon: `chrome://${config.addonRef}/content/icons/agent.svg`,
    },
    sidenav: {
      l10nID: getLocaleID("itemPaneSection-sidenav"),
      icon: `chrome://${config.addonRef}/content/icons/agent.svg`,
    },
    onInit: ({ body }) => {
      panels.set(body, new AgentPanel(body));
    },
    onRender: ({ body, item }) => {
      if (!item) return;
      const panel = panels.get(body);
      void panel?.setItem(item);
      const height = body
        .closest("item-details")
        ?.querySelector(".zotero-view-item")?.clientHeight;
      if (height)
        body.style.setProperty(
          "--agent-height",
          `${Math.max(470, height - 75)}px`,
        );
    },
    onItemChange: ({ body, item, setEnabled }) => {
      setEnabled(!!item && (item.isAttachment() || item.isRegularItem()));
      if (item) void panels.get(body)?.setItem(item);
    },
    onDestroy: ({ body }) => {
      panels.get(body)?.dispose();
      panels.delete(body);
    },
  });
}
// Kept as a hook target for the selection translator; chat is refreshed independently.
export function updateReaderTabPanels() {}
