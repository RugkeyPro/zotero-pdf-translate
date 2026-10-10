// Keep selection identity independent of the global, most recent translation.
export function normalizeSelection(text: string) {
  /* eslint-disable no-control-regex */
  return text
    .replace(/[\u0000-\u001F\u007F-\u009F]/gu, " ")
    .normalize("NFKC")
    .trim();
  /* eslint-enable no-control-regex */
}

export function pronunciationAudio(text: string) {
  // Use the same small audio endpoint as the existing Youdao dictionary service.
  if (!/[a-z]/i.test(text) || /[^\x20-\x7E\u2010-\u2027]/u.test(text))
    return [];
  return [
    {
      text: "英音",
      url: `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(text)}&type=1`,
    },
    {
      text: "美音",
      url: `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(text)}&type=2`,
    },
  ];
}
