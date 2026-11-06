/** Tiny DOM builder. Text is always assigned with textContent, never innerHTML, because most of what Pramaan shows
 *  (addresses, descriptor intents, page origins, signed messages) comes from untrusted sources. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | ((e: Event) => void)> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === "function") node.addEventListener(k.replace(/^on/, ""), v);
    else if (v === true) node.setAttribute(k, "");
    else if (v !== false) node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    node.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export const short = (a: string | null | undefined) => (a && a.length === 42 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a ?? "");

/** append() that skips null/false placeholders used for conditional content. */
export function put(node: HTMLElement, ...children: (Node | string | null | undefined | false)[]): void {
  for (const c of children) if (c !== null && c !== undefined && c !== false) node.append(c);
}
