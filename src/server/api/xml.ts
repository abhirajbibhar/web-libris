/**
 * Minimal XML parser for EPUB package documents.
 *
 * Cloudflare Workers (and the vitest environment) have no DOMParser, and
 * these files are small well-formed XML, so a compact tolerant parser is
 * enough: elements, attributes, text, CDATA, comments and processing
 * instructions. It is not a general-purpose XML implementation.
 */

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'"
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isNaN(code) ? match : String.fromCodePoint(code);
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isNaN(code) ? match : String.fromCodePoint(code);
    }
    return ENTITY_MAP[entity] ?? match;
  });
}

function skipWhitespace(source: string, index: number): number {
  let i = index;
  while (i < source.length && /\s/.test(source[i])) i++;
  return i;
}

function readName(source: string, index: number): { name: string; next: number } {
  let i = index;
  while (i < source.length && !/[\s/>=]/.test(source[i])) i++;
  return { name: source.slice(index, i), next: i };
}

function readAttributes(source: string, index: number): { attrs: Record<string, string>; next: number } {
  const attrs: Record<string, string> = {};
  let i = index;
  for (;;) {
    i = skipWhitespace(source, i);
    if (i >= source.length || source[i] === '>' || source[i] === '/') break;
    const { name, next } = readName(source, i);
    if (!name) break;
    i = skipWhitespace(source, next);
    if (source[i] !== '=') {
      attrs[name] = '';
      continue;
    }
    i = skipWhitespace(source, i + 1);
    const quote = source[i];
    if (quote !== '"' && quote !== "'") break;
    const end = source.indexOf(quote, i + 1);
    if (end === -1) break;
    attrs[name] = decodeEntities(source.slice(i + 1, end));
    i = end + 1;
  }
  return { attrs, next: i };
}

/**
 * Parse an XML document and return its root element, or null when the input
 * is empty or contains no element at all.
 */
export function parseXml(source: string): XmlNode | null {
  let i = 0;
  const root: XmlNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];

  const appendText = (value: string) => {
    const top = stack[stack.length - 1];
    if (value) top.text += decodeEntities(value);
  };

  while (i < source.length) {
    const lt = source.indexOf('<', i);
    if (lt === -1) {
      appendText(source.slice(i));
      break;
    }
    appendText(source.slice(i, lt));

    if (source.startsWith('<?', lt)) {
      const end = source.indexOf('?>', lt);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt);
      i = end === -1 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<![CDATA[', lt)) {
      const end = source.indexOf(']]>', lt);
      appendText(source.slice(lt + 9, end === -1 ? source.length : end));
      i = end === -1 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<!', lt)) {
      // DOCTYPE and friends; skip past the bracketed subset if present.
      let depth = 0;
      let j = lt;
      for (; j < source.length; j++) {
        if (source[j] === '[') depth++;
        else if (source[j] === ']') depth--;
        else if (source[j] === '>' && depth === 0) break;
      }
      i = j + 1;
      continue;
    }
    if (source.startsWith('</', lt)) {
      const { name, next } = readName(source, lt + 2);
      const end = source.indexOf('>', next);
      if (stack.length > 1 && stack[stack.length - 1].name === name) stack.pop();
      i = end === -1 ? source.length : end + 1;
      continue;
    }

    const { name, next } = readName(source, lt + 1);
    if (!name) {
      appendText('<');
      i = lt + 1;
      continue;
    }
    const { attrs, next: afterAttrs } = readAttributes(source, next);
    const node: XmlNode = { name, attrs, children: [], text: '' };
    stack[stack.length - 1].children.push(node);

    if (source[afterAttrs] === '/') {
      // Self-closing element: already appended, nothing to push.
      i = afterAttrs + 2;
      continue;
    }
    stack.push(node);
    i = afterAttrs + 1;
  }

  const element = root.children.find(child => child.name !== '#root');
  return element ?? null;
}

/** Strip any namespace prefix: `dc:title` -> `title`. */
export function localName(name: string): string {
  const colon = name.indexOf(':');
  return colon === -1 ? name : name.slice(colon + 1);
}

/** All descendants (including `node` itself) whose local name matches. */
export function findAll(node: XmlNode, name: string): XmlNode[] {
  const out: XmlNode[] = [];
  const visit = (current: XmlNode) => {
    if (localName(current.name) === name) out.push(current);
    for (const child of current.children) visit(child);
  };
  visit(node);
  return out;
}

export function findFirst(node: XmlNode, name: string): XmlNode | undefined {
  if (localName(node.name) === name) return node;
  for (const child of node.children) {
    const found = findFirst(child, name);
    if (found) return found;
  }
  return undefined;
}
