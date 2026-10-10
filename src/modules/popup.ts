import { SVGIcon } from "../utils/config";
import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { getPref, setPref } from "../utils/prefs";
import { addTranslateTask, getLastTranslateTask } from "../utils/task";
import { slice } from "../utils/str";
import { normalizeSelection, pronunciationAudio } from "./selectionActions";

import { playPronunciation } from "./pronunciation";

export function updateReaderPopup() {
  const popup = addon.data.popup.currentPopup;
  if (!popup) {
    return;
  }
  const enablePopup = getPref("enablePopup");
  const hidePopupTextarea = getPref("enableHidePopupTextarea") as boolean;
  Array.from(popup.querySelectorAll(`.${config.addonRef}-readerpopup`)).forEach(
    (elem) => ((elem as HTMLElement).hidden = !enablePopup),
  );

  const idPrefix = popup?.getAttribute(`${config.addonRef}-prefix`);
  const makeId = (type: string) => `${idPrefix}-${type}`;
  const audiobox = popup?.querySelector(
    `#${makeId("audiobox")}`,
  ) as HTMLDivElement;
  const translateButton = popup?.querySelector(
    `#${makeId("translate")}`,
  ) as HTMLDivElement;
  const textarea = popup?.querySelector(
    `#${makeId("text")}`,
  ) as HTMLTextAreaElement;
  const addToNoteButton = popup?.querySelector(
    `#${makeId("addtonote")}`,
  ) as HTMLDivElement;

  const updateHidden = (elem: HTMLElement, hidden: boolean) => {
    if (hidden) {
      elem.style.display = "none";
    } else {
      elem.style.removeProperty("display");
    }
  };

  if (!enablePopup) {
    updateHidden(audiobox, true);
    updateHidden(translateButton, true);
    updateHidden(textarea, true);
    updateHidden(addToNoteButton, true);
    return;
  }
  const task = getLastTranslateTask({ type: "text" });
  if (!task) {
    return;
  }
  if (
    task.itemId !== Number(popup.dataset.selectionItem) ||
    normalizeSelection(task.raw) !== popup.dataset.selectionText
  )
    return;
  popup.setAttribute("translate-task-id", task.id);

  const audioList = pronunciationAudio(task.raw);
  if (!audioList.length) audioList.push(...task.audio.slice(0, 1));
  audiobox.innerHTML = "";
  updateHidden(audiobox, !audioList.length || !getPref("showPlayBtn"));
  if (audioList.length > 0 && getPref("showPlayBtn")) {
    updateHidden(audiobox, false);
    ztoolkit.UI.appendElement(
      {
        tag: "fragment",
        children: audioList.map((audioData) => ({
          tag: "button",
          namespace: "html",
          classList: ["toolbar-button", "wide-button"],
          attributes: {
            tabindex: "-1",
            title: audioData.text,
            "aria-label": "朗读原文（美音）",
          },
          properties: {
            textContent: "🔊",
            onclick: async (event: Event) => {
              const button = event.currentTarget as HTMLButtonElement;
              try {
                await playPronunciation(task.raw);
              } catch {
                button.title = "发音播放失败，请检查网络与声音设置后重试";
                new ztoolkit.ProgressWindow("发音")
                  .createLine({
                    text: "播放失败，请检查网络与声音设置后重试",
                    type: "default",
                  })
                  .show();
              }
            },
          },
          styles: { whiteSpace: "nowrap", flexGrow: "1" },
        })),
      },
      audiobox,
    );
  }

  if (audioList.length > 0 && getPref("showPlayBtn") && getPref("autoPlay")) {
    void playPronunciation(task.raw).catch(() => {});
  }

  const hideTranslateButton = task.status !== "waiting";
  updateHidden(translateButton, hideTranslateButton);

  switch (task.langto?.split("-")[0]) {
    case "ar":
    case "fa":
    case "he":
      textarea.style.direction = "rtl";
      break;
    default:
      textarea.style.direction = "ltr";
  }

  textarea.hidden = hidePopupTextarea || !hideTranslateButton;
  textarea.value = task.result || task.raw;
  textarea.style.fontSize = `${getPref("fontSize")}px`;
  textarea.style.lineHeight = `${
    Number(getPref("lineHeight")) * Number(getPref("fontSize"))
  }px`;

  const enableAddToNote = getPref("enableNote") as boolean;
  if (
    !Zotero.getMainWindow().ZoteroContextPane.activeEditor ||
    !enableAddToNote
  ) {
    updateHidden(addToNoteButton, true);
  }

  updatePopupSize(popup, textarea);
}

export function buildReaderPopup(
  event: _ZoteroTypes.Reader.EventParams<"renderTextSelectionPopup">,
) {
  const { reader, doc, append } = event;
  const annotation = event.params.annotation;
  const popup = doc.querySelector(".selection-popup") as HTMLDivElement;
  addon.data.popup.currentPopup = popup;
  popup.dataset.selectionText = normalizeSelection(annotation.text || "");
  popup.dataset.selectionItem = String(reader.itemID);
  popup.style.maxWidth = "none";
  popup.setAttribute(
    `${config.addonRef}-prefix`,
    `${config.addonRef}-${reader._instanceID}`,
  );

  const ZoteroContextPane = Zotero.getMainWindow().ZoteroContextPane;

  const colors = popup.querySelector(".colors") as HTMLDivElement;
  colors.style.width = "100%";
  colors.style.justifyContent = "space-evenly";

  // Populate the very annotation Zotero copies in its native color handler.
  // Capture runs first; the normal handler still owns color, position and undo.
  if (!colors.dataset.translateComment) {
    colors.dataset.translateComment = "true";
    let busy = false;
    let replay = false;
    colors.addEventListener(
      "click",
      async (ev) => {
        const button = (ev.target as Element).closest<HTMLButtonElement>(
          "button.color-button",
        );
        if (!button || replay) return;
        const task = getLastTranslateTask({ type: "text" });
        if (
          !task ||
          task.itemId !== reader.itemID ||
          normalizeSelection(task.raw) !==
            normalizeSelection(annotation.text || "")
        )
          return;
        const saveComment = () => {
          if (task.status !== "success" || !task.result.trim()) return false;
          const textarea = popup.querySelector<HTMLTextAreaElement>(
            `#${makeId("text")}`,
          );
          // Include user edits, but never save the source text or an error as a translation.
          annotation.comment = textarea?.value.trim() || task.result.trim();
          return true;
        };
        if (task.status === "success") {
          saveComment();
          return;
        }
        ev.preventDefault();
        ev.stopImmediatePropagation();
        if (busy) return;
        busy = true;
        try {
          if (task.status === "waiting") {
            await addon.hooks.onTranslate(task, {
              noCheckZoteroItemLanguage: true,
            });
          } else {
            const deadline = Date.now() + 30000;
            while (task.status === "processing" && Date.now() < deadline) {
              await Zotero.Promise.delay(100);
            }
          }
          if (!popup.isConnected) return;
          const saved = saveComment();
          if (!saved) {
            new ztoolkit.ProgressWindow("高亮译文")
              .createLine({
                text: "翻译未完成，已保留高亮；请稍后重译注释",
                type: "default",
              })
              .show();
          }
        } catch {
          new ztoolkit.ProgressWindow("高亮译文")
            .createLine({ text: "翻译失败，已保留高亮", type: "default" })
            .show();
        } finally {
          // A nested .click() during the original click dispatch is ignored.
          await Zotero.Promise.delay(0);
          if (popup.isConnected) {
            replay = true;
            button.click();
          }
          replay = false;
          busy = false;
        }
      },
      true,
    );
  }

  const keepSize = getPref("keepPopupSize") as boolean;

  const makeId = (type: string) =>
    `${config.addonRef}-${reader._instanceID}-${type}`;
  const onTextAreaCopy = getOnTextAreaCopy(popup, makeId("text"));

  const hidePopupTextarea = getPref("enableHidePopupTextarea") as boolean;
  append(
    ztoolkit.UI.createElement(doc, "fragment", {
      children: [
        {
          tag: "div",
          id: makeId("audiobox"),
          classList: [`${config.addonRef}-readerpopup`],
          styles: {
            display: "flex",
            width: "calc(100% - 4px)",
            marginLeft: "2px",
            justifyContent: "space-evenly",
          },
          ignoreIfExists: true,
        },
        {
          tag: "button",
          namespace: "html",
          id: makeId("translate"),
          classList: [
            "toolbar-button",
            "wide-button",
            `${config.addonRef}-readerpopup`,
          ],
          properties: {
            innerHTML: `${SVGIcon}${getString("readerpopup-translate-label")}`,
            hidden: getPref("enableAuto"),
          },
          listeners: [
            {
              type: "click",
              listener: (ev: Event) => {
                addon.hooks.onTranslate({
                  noCheckZoteroItemLanguage: true,
                  noCache: true,
                });
                const button = ev.target as HTMLDivElement;
                button.hidden = true;
                (
                  button.ownerDocument.querySelector(
                    `#${makeId("text")}`,
                  ) as HTMLTextAreaElement
                ).hidden = hidePopupTextarea;
              },
            },
          ],
          ignoreIfExists: true,
        },
        {
          tag: "textarea",
          id: makeId("text"),
          attributes: {
            rows: "3",
            columns: "10",
          },
          classList: [
            `${config.addonRef}-popup-textarea`,
            `${config.addonRef}-readerpopup`,
          ],
          styles: {
            fontSize: `${getPref("fontSize")}px`,
            fontFamily: "inherit",
            lineHeight: `${
              Number(getPref("lineHeight")) * Number(getPref("fontSize"))
            }px`,
            width: keepSize ? `${getPref("popupWidth")}px` : "-moz-available",
            // Minimum width to prevent the textarea from being smaller than the popup
            minWidth: "184px",
            height: `${Math.max(
              keepSize ? Number(getPref("popupHeight")) : 30,
            )}px`,
            marginInline: "2px",
            border: "none",
            background: "var(--color-sidepane)",
            borderRadius: "6px",
            padding: "5px",
          },
          properties: {
            onpointerup: (e: Event) => e.stopPropagation(),
            ondragstart: (e: Event) => e.stopPropagation(),
            spellcheck: false,
            value: addon.data.translate.selectedText,
          },
          ignoreIfExists: true,
          listeners: [
            {
              type: "mousedown",
              listener: (_ev) => {
                _ev.target?.addEventListener(
                  "mousemove",
                  onTextAreaResize as (ev: Event) => void,
                );
              },
            },
            {
              type: "mouseup",
              listener: (_ev) => {
                _ev.target?.removeEventListener(
                  "mousemove",
                  onTextAreaResize as (ev: Event) => void,
                );
              },
            },
            {
              type: "keydown",
              listener: onTextAreaCopy as (ev: Event) => void,
            },
            {
              type: "dblclick",
              listener: (_ev) => {
                const textarea = popup.querySelector(
                  `#${makeId("text")}`,
                ) as HTMLTextAreaElement;
                textarea.selectionStart = 0;
                textarea.selectionEnd = textarea.value.length;
                const text = textarea.value.slice(
                  textarea.selectionStart,
                  textarea.selectionEnd,
                );
                new ztoolkit.Clipboard().addText(text, "text/plain").copy();
                new ztoolkit.ProgressWindow("Copied to Clipboard")
                  .createLine({
                    text: slice(text, 50),
                    progress: 100,
                    type: "default",
                  })
                  .show();
              },
            },
          ],
        },
        {
          tag: "button",
          namespace: "html",
          id: makeId("addtonote"),
          classList: [
            "toolbar-button",
            "wide-button",
            `${config.addonRef}-readerpopup`,
          ],
          styles: {
            marginTop: "8px",
          },
          properties: {
            innerHTML: `${SVGIcon}${getString("readerpopup-addToNote-label")}`,
          },
          ignoreIfExists: true,
          listeners: [
            {
              type: "click",
              listener: async (ev) => {
                const noteEditor =
                  ZoteroContextPane && ZoteroContextPane.activeEditor;
                if (!noteEditor) {
                  return;
                }
                const editorInstance = noteEditor.getCurrentInstance();
                if (!editorInstance) {
                  return;
                }
                const task = addTranslateTask(
                  addon.data.translate.selectedText,
                  reader.itemID,
                  "addtonote",
                );
                if (!task) {
                  return;
                }
                await addon.hooks.onTranslate(task, {
                  noCheckZoteroItemLanguage: true,
                  noDisplay: true,
                });
                if (task.status !== "success") {
                  return;
                }
                const replaceMode = getPref("enableNoteReplaceMode") as boolean;
                if (replaceMode) {
                  annotation.text = task.result;
                } else {
                  annotation.comment = task.result;
                }
                // @ts-ignore should be fixed in the zotero-types
                reader._addToNote([annotation]);
              },
            },
          ],
        },
      ],
    }),
  );
}

function onTextAreaResize(ev: MouseEvent) {
  if (getPref("keepPopupSize")) {
    const textarea = ev.target as HTMLTextAreaElement;
    setPref("popupWidth", textarea.offsetWidth);
    setPref("popupHeight", textarea.offsetHeight);
  }
}

function getOnTextAreaCopy(selectionMenu: HTMLElement, targetId: string) {
  return (ev: KeyboardEvent) => {
    const textarea = selectionMenu.querySelector(
      `#${targetId}`,
    ) as HTMLTextAreaElement;
    const isMod = ev.ctrlKey || ev.metaKey;
    if (ev.key === "c" && isMod) {
      ztoolkit.getGlobal("setTimeout")(() => {
        new ztoolkit.Clipboard()
          .addText(
            textarea.value.slice(
              textarea.selectionStart,
              textarea.selectionEnd,
            ),
            "text/plain",
          )
          .copy();
      }, 10);
      ev.stopPropagation();
    } else if (ev.key === "a" && isMod) {
      textarea.selectionStart = 0;
      textarea.selectionEnd = textarea.value.length;
      ev.stopPropagation();
    } else if (ev.key === "x" && isMod) {
      new ztoolkit.Clipboard()
        .addText(
          textarea.value.slice(textarea.selectionStart, textarea.selectionEnd),
          "text/plain",
        )
        .copy();
      textarea.value = `${textarea.value.slice(
        0,
        textarea.selectionStart,
      )}${textarea.value.slice(textarea.selectionEnd)}`;
      ev.stopPropagation();
    }
  };
}

function updatePopupSize(
  selectionMenu: HTMLDivElement,
  textarea: HTMLTextAreaElement,
  resetSize: boolean = true,
): void {
  const keepSize = getPref("keepPopupSize") as boolean;
  if (keepSize) {
    return;
  }
  if (resetSize) {
    textarea.style.width = "-moz-available";
    textarea.style.height = "30px";
  }
  const viewer = selectionMenu.ownerDocument.body;
  // Get current H & W
  const textHeight = textarea.scrollHeight;
  const textWidth = textarea.scrollWidth;
  const newWidth = textWidth + 20;
  // Check until H/W<0.75 and don't overflow viewer border
  if (
    textHeight / textWidth > 0.75 &&
    selectionMenu.offsetLeft + newWidth < viewer.offsetWidth
  ) {
    // Update width
    textarea.style.width = `${newWidth}px`;
    updatePopupSize(selectionMenu, textarea, false);
    return;
  }
  // Update height
  textarea.style.height = `${textHeight + 3}px`;
}
