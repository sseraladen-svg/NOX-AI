const BY_EXT: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  json: "json", md: "markdown", html: "html", htm: "html", css: "css", scss: "scss", py: "python", java: "java",
  c: "c", h: "c", cpp: "cpp", cc: "cpp", hpp: "cpp", cs: "csharp", go: "go", rs: "rust", rb: "ruby", php: "php",
  sh: "shell", bash: "shell", ps1: "powershell", sql: "sql", yml: "yaml", yaml: "yaml", xml: "xml", toml: "ini",
  kt: "kotlin", swift: "swift", prisma: "plaintext", txt: "plaintext",
};

/** Monaco language id for a file path or fenced-code language label. */
export function languageFor(pathOrLang: string): string {
  const s = pathOrLang.toLowerCase();
  const ext = s.includes(".") ? s.slice(s.lastIndexOf(".") + 1) : s;
  const alias: Record<string, string> = { typescript: "ts", javascript: "js", python: "py", shell: "sh", powershell: "ps1", markdown: "md" };
  return BY_EXT[ext] ?? BY_EXT[alias[ext] ?? ""] ?? "plaintext";
}

const EXT_BY_LANG: Record<string, string> = {
  typescript: "ts", ts: "ts", tsx: "tsx", javascript: "js", js: "js", jsx: "jsx", json: "json", python: "py", py: "py",
  html: "html", css: "css", markdown: "md", md: "md", sh: "sh", bash: "sh", powershell: "ps1", sql: "sql", java: "java",
  go: "go", rust: "rs", yaml: "yml", yml: "yml", c: "c", cpp: "cpp", csharp: "cs", php: "php", ruby: "rb",
};
export const extensionFor = (lang: string): string => EXT_BY_LANG[lang.toLowerCase()] ?? "txt";
