// Inlines relative <link rel=stylesheet> / <script src> from the virtual FS so an HTML file
// previews correctly inside a sandboxed iframe (which cannot fetch workspace files).
import { normalizePath, type VfsState } from "./vfs.ts";

const isExternal = (u: string) => /^([a-z][a-z0-9+.-]*:|\/\/|#|data:)/i.test(u);
const esc = (s: string) => s.replace(/<\/(script|style)/gi, "<\\/$1");

export function inlineAssets(html: string, vfs: VfsState, baseDir: string): string {
  const read = (ref: string): string | null => {
    if (isExternal(ref)) return null;
    try {
      const p = normalizePath(ref.split(/[?#]/)[0], baseDir);
      return Object.prototype.hasOwnProperty.call(vfs.files, p) ? vfs.files[p] : null;
    } catch {
      return null;
    }
  };
  let out = html.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) return tag;
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    const css = href ? read(href) : null;
    return css === null ? tag : `<style>${esc(css)}</style>`;
  });
  out = out.replace(/<script\b([^>]*)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (tag, a: string, src: string, b: string) => {
    const js = read(src);
    const attrs = `${a} ${b}`.trim();
    return js === null ? tag : `<script${attrs ? " " + attrs : ""}>${esc(js)}</script>`;
  });
  return out;
}
