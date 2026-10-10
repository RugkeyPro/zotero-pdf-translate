import { Corpus, SourceChunk } from "./context";
import { itemKey } from "./storage";
const pending = new Map<string, Promise<string>>();
export async function readPDFPage(
  item: Zotero.Item,
  corpus: Corpus,
  attachmentKey: string,
  page: number,
) {
  const chunks = corpus.chunks.filter(
    (c) => c.attachmentKey === attachmentKey && c.pageIndex === page - 1,
  );
  if (!chunks.length || !Number.isInteger(page) || page < 1)
    throw Error("此页不在当前条目来源索引中");
  const io = ztoolkit.getGlobal("IOUtils");
  const fingerprint = corpus.pdfStamps?.[attachmentKey] || corpus.fingerprint;
  const hash = Zotero.Utilities.Internal.md5(fingerprint);
  const key = `${itemKey(item)}-${attachmentKey}-${hash}-${page}`;
  if (pending.size >= 24 && !pending.has(key))
    pending.delete(pending.keys().next().value!);
  if (!pending.has(key))
    pending.set(
      key,
      (async () => {
        const folder = `${Zotero.DataDirectory.dir}/translate-agent/figures`;
        await io.makeDirectory(folder, {
          ignoreExisting: true,
          permissions: 0o700,
        });
        const path = `${folder}/${key}.json`;
        try {
          const saved = await io.readJSON(path);
          if (typeof saved.image === "string") return saved.image;
        } catch {
          /* New page. */
        }
        const pdf = Zotero.Items.getByLibraryAndKey(
          item.libraryID,
          attachmentKey,
        );
        if (
          !pdf ||
          (item.isAttachment() ? pdf.id !== item.id : pdf.parentID !== item.id)
        )
          throw Error("此 PDF 不属于当前条目");
        const file = await pdf.getFilePathAsync();
        if (!file) throw Error("PDF 文件不可用");
        const worker = Zotero.PDFWorker as any;
        const result = await worker._enqueue(async () => {
          const bytes = await io.read(file);
          const buf = bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          );
          return worker._query(
            "pdf.renderArea",
            {
              buf,
              pageIndex: page - 1,
              rect: [0, 0, 10000, 10000],
              scale: 1.4,
            },
            [buf],
          );
        }, false);
        const bytes = new Uint8Array(result.buf);
        if (!bytes.length || bytes.length > 6000000)
          throw Error("PDF 页面图像过大或渲染失败");
        let binary = "";
        for (let i = 0; i < bytes.length; i += 32768)
          binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
        const image = `data:image/png;base64,${Zotero.getMainWindow().btoa(binary)}`;
        await io.writeJSON(path, { image });
        return image;
      })(),
    );
  try {
    return { image: await pending.get(key)!, chunks };
  } catch (e) {
    pending.delete(key);
    throw e;
  }
}
export function pageIndex(chunks: SourceChunk[]) {
  const pages = new Map<string, string>();
  for (const c of chunks)
    if (c.attachmentKey && c.pageIndex !== undefined) {
      const key = `${c.attachmentKey}:${c.pageIndex + 1}`;
      if (!pages.has(key))
        pages.set(
          key,
          `${c.attachmentKey} 页${c.pageIndex + 1}: ${c.text.slice(0, 200)}`,
        );
    }
  return [...pages.values()].join("\n").slice(0, 12000);
}
