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
  // The popup speaks the original selection through the natural US TTS service.
  if (!/[a-z]/i.test(text) || /[^\x20-\x7E\u2010-\u2027]/u.test(text))
    return [];
  return [
    {
      text: "美音",
      url: "",
    },
  ];
}
