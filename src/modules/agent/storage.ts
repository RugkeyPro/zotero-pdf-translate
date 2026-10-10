import {
  Corpus,
  ItemChats,
  splitSource,
  coverage,
  formatSources,
  Conversation,
} from "./context";
export const DEFAULT_MODEL = "gemini-3.8-flash-high";
const memory = new Map<string, ItemChats>();
const corpora = new Map<string, Corpus>();
const locks = new Map<string, Promise<Corpus>>();
const writes = new Map<string, Promise<void>>();
export function rootItem(item: Zotero.Item): Zotero.Item {
  while (item.parentID) item = Zotero.Items.get(item.parentID);
  return item;
}
export function itemKey(item: Zotero.Item) {
  return `${item.libraryID}-${item.key}`;
}
function io() {
  return ztoolkit.getGlobal("IOUtils");
}
async function path(name: string) {
  const folder = `${Zotero.DataDirectory.dir}/translate-agent`;
  await io().makeDirectory(folder, {
    ignoreExisting: true,
    permissions: 0o700,
  });
  return `${folder}/${name}.json`;
}
export function newConversation(model = DEFAULT_MODEL): Conversation {
  return {
    id: `${Date.now()}-${Zotero.Utilities.randomString(6)}`,
    title: "新对话",
    model,
    messages: [],
    summary: "",
    summarized: 0,
    updated: Date.now(),
  };
}
export async function loadChats(item: Zotero.Item) {
  const key = itemKey(item);
  if (memory.has(key)) return memory.get(key)!;
  let state: ItemChats;
  try {
    state = await io().readJSON(await path(`chats-${key}`));
    if (state.version !== 1 || !Array.isArray(state.conversations))
      throw Error();
  } catch {
    const c = newConversation();
    state = { version: 1, current: c.id, conversations: [c] };
  }
  if (!state.conversations.length) {
    const c = newConversation();
    state.conversations = [c];
    state.current = c.id;
  }
  if (!state.conversations.some((c) => c.id === state.current))
    state.current = state.conversations[0].id;
  if (!memory.has(key)) memory.set(key, state);
  return memory.get(key)!;
}
export async function saveChats(item: Zotero.Item, state: ItemChats) {
  const key = itemKey(item);
  memory.set(key, state);
  const snapshot = JSON.stringify(state);
  const previous = writes.get(key) || Promise.resolve();
  const write = previous
    .catch(() => {})
    .then(async () => {
      const p = await path(`chats-${key}`);
      await io().writeUTF8(p, snapshot, { tmpPath: `${p}.tmp` });
    });
  writes.set(key, write);
  await write;
}
function plain(html: string) {
  const parsed = new (Zotero.getMainWindow().DOMParser)().parseFromString(
    html,
    "text/html",
  );
  return parsed.body.textContent || "";
}
export async function getCorpus(parent: Zotero.Item): Promise<Corpus> {
  const key = itemKey(parent);
  if (locks.has(key)) return locks.get(key)!;
  const job = buildCorpus(parent, key);
  locks.set(key, job);
  try {
    return await job;
  } finally {
    locks.delete(key);
  }
}
async function buildCorpus(parent: Zotero.Item, key: string): Promise<Corpus> {
  const attachments = parent.isAttachment()
    ? [parent]
    : Zotero.Items.get(parent.getAttachments());
  const pdfs = attachments.filter(
    (a) => a.attachmentContentType === "application/pdf",
  );
  const notes = parent.isRegularItem()
    ? Zotero.Items.get(parent.getNotes())
    : [];
  const annotations = pdfs.flatMap((a) => a.getAnnotations());
  const meta = JSON.stringify({
    title: parent.getField("title"),
    abstract: parent.getField("abstractNote"),
    creators: parent.getCreators(),
    date: parent.getField("date"),
    DOI: parent.getField("DOI"),
  });
  const pdfStamps: Record<string, string> = {};
  const stamps: unknown[] = [
    meta,
    notes.map((n) => [n.key, n.dateModified]),
    annotations.map((n) => [
      n.key,
      n.dateModified,
      n.annotationText,
      n.annotationComment,
    ]),
  ];
  const warnings: string[] = [];
  for (const pdf of pdfs) {
    const p = await pdf.getFilePathAsync();
    try {
      if (!p) throw Error();
      const stat = await io().stat(p);
      const stamp = JSON.stringify([
        pdf.key,
        stat.lastModified,
        stat.size,
        pdf.dateModified,
      ]);
      pdfStamps[pdf.key] = stamp;
      stamps.push(stamp);
    } catch {
      stamps.push([pdf.key, "missing"]);
      warnings.push(`${pdf.getField("title")}：本地文件不可用`);
    }
  }
  const fingerprint = JSON.stringify(stamps);
  let cached = corpora.get(key);
  if (!cached)
    try {
      cached = await io().readJSON(await path(`corpus-${key}`));
    } catch {
      /* First read. */
    }
  if (
    cached?.fingerprint === fingerprint &&
    (!cached.warnings.length || Date.now() - (cached.cachedAt || 0) < 300000)
  ) {
    corpora.set(key, cached);
    return cached;
  }
  const chunks = splitSource("标题、摘要与元数据", meta, "META");
  for (const pdf of pdfs) {
    if (
      pdfStamps[pdf.key] &&
      cached?.pdfStamps?.[pdf.key] === pdfStamps[pdf.key]
    ) {
      const previous = cached.chunks.filter((c) =>
        c.id.startsWith(`PDF${pdf.key}-`),
      );
      if (previous.length) {
        chunks.push(...previous);
        continue;
      }
    }
    try {
      const text = await pdf.attachmentText;
      if (text?.trim())
        chunks.push(
          ...splitSource(String(pdf.getField("title")), text, `PDF${pdf.key}`),
        );
      else
        warnings.push(
          `${pdf.getField("title")}：没有可提取文字，扫描件需要 OCR`,
        );
    } catch {
      warnings.push(`${pdf.getField("title")}：全文提取失败`);
    }
  }
  for (const note of notes)
    chunks.push(
      ...splitSource(
        `笔记：${note.getField("title")}`,
        plain(note.getNote()),
        `NOTE${note.key}`,
      ),
    );
  for (const a of annotations)
    chunks.push(
      ...splitSource(
        `注释：${a.annotationPageLabel || ""}`,
        `${a.annotationText || ""}\n${a.annotationComment || ""}`,
        `ANN${a.key}`,
      ),
    );
  const corpus: Corpus = {
    fingerprint,
    title: String(parent.getField("title")),
    chunks,
    overview: formatSources(coverage(chunks, 10)).slice(0, 16000),
    warnings,
    pdfCount: pdfs.length,
    pdfStamps,
    cachedAt: Date.now(),
  };
  corpora.set(key, corpus);
  await io().writeJSON(await path(`corpus-${key}`), corpus);
  return corpus;
}
