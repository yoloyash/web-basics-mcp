// Adapted from pi-web-access (MIT), Copyright (c) 2025 Nico Bailon.
// https://github.com/nicobailon/pi-web-access

export interface RscMarkdown {
  title: string;
  content: string;
  wordCount: number;
  extractor: "rsc";
}

const MIN_RSC_CONTENT_CHARS = 100;
const RSC_SCRIPT_RE = /<script\b[^>]*>\s*self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)\s*<\/script>/g;
const RSC_REF_RE = /^\$L([0-9a-f]+)$/i;
const SKIP_TAGS = new Set([
  "aside",
  "button",
  "circle",
  "footer",
  "input",
  "link",
  "meta",
  "nav",
  "path",
  "script",
  "style",
  "svg",
  "template",
]);

interface ExtractContext {
  inCode: boolean;
  inTable: boolean;
}

export function extractRscMarkdown(html: string, finalUrl: string): RscMarkdown | null {
  if (!html.includes("self.__next_f.push")) return null;

  const chunkMap = parseFlightChunks(html);
  if (chunkMap.size === 0) return null;

  const title = extractTitle(html) || finalUrl;
  const parsedCache = new Map<string, unknown | null>();
  const visitedRefs = new Set<string>();

  function getParsedChunk(id: string): unknown | null {
    if (parsedCache.has(id)) return parsedCache.get(id) ?? null;

    const chunk = chunkMap.get(id);
    if (!chunk?.startsWith("[")) {
      parsedCache.set(id, null);
      return null;
    }

    try {
      const parsed = JSON.parse(chunk) as unknown;
      parsedCache.set(id, parsed);
      return parsed;
    } catch {
      parsedCache.set(id, null);
      return null;
    }
  }

  function resolveRef(refId: string, ctx: ExtractContext): string {
    if (visitedRefs.has(refId)) return "";
    visitedRefs.add(refId);
    const node = getParsedChunk(refId);
    const result = node ? extractNode(node, ctx) : "";
    visitedRefs.delete(refId);
    return result;
  }

  function extractNode(node: unknown, ctx: ExtractContext = { inCode: false, inTable: false }): string {
    if (node === null || node === undefined) return "";

    if (typeof node === "string") {
      const refMatch = node.match(RSC_REF_RE);
      if (refMatch) return resolveRef(refMatch[1], ctx);
      if (!ctx.inCode && (node === "$undefined" || node === "$" || /^\$[A-Z]/.test(node))) return "";
      return node.trim() ? node : "";
    }

    if (typeof node === "number") return String(node);
    if (typeof node === "boolean" || !Array.isArray(node)) return "";

    if (node[0] === "$" && typeof node[1] === "string") {
      const tag = node[1];
      const props = (node[3] || {}) as Record<string, unknown>;

      if (SKIP_TAGS.has(tag)) return "";

      if (tag.startsWith("$L")) {
        const refId = tag.slice(2);
        if (props.baseId && props.children) return `## ${String(props.children)}\n\n`;

        const resolved = resolveRef(refId, ctx);
        return resolved || extractNode(props.children, ctx);
      }

      const children = props.children;
      const content = children ? extractNode(children, ctx) : "";

      switch (tag) {
        case "h1":
          return `# ${content.trim()}\n\n`;
        case "h2":
          return `## ${content.trim()}\n\n`;
        case "h3":
          return `### ${content.trim()}\n\n`;
        case "h4":
          return `#### ${content.trim()}\n\n`;
        case "h5":
          return `##### ${content.trim()}\n\n`;
        case "h6":
          return `###### ${content.trim()}\n\n`;
        case "p":
          return ctx.inTable ? content : `${content.trim()}\n\n`;
        case "code": {
          const codeContent = children ? extractNode(children, { ...ctx, inCode: true }) : "";
          return ctx.inCode ? codeContent : `\`${codeContent}\``;
        }
        case "pre": {
          const preContent = children ? extractNode(children, { ...ctx, inCode: true }) : "";
          return `\`\`\`\n${preContent}\n\`\`\`\n\n`;
        }
        case "strong":
        case "b":
          return `**${content}**`;
        case "em":
        case "i":
          return `*${content}*`;
        case "li":
          return `- ${content.trim()}\n`;
        case "ul":
        case "ol":
          return `${content}\n`;
        case "blockquote":
          return `> ${content.trim()}\n\n`;
        case "table":
          return `${extractTable(node)}\n`;
        case "thead":
        case "tbody":
        case "tr":
        case "th":
        case "td":
          return content;
        case "div":
          if (props.role === "alert" || props["data-slot"] === "alert") {
            return `> ${content.trim()}\n\n`;
          }
          return content;
        case "a": {
          const href = typeof props.href === "string" ? props.href : undefined;
          return formatLink(content, href, finalUrl);
        }
        default:
          return content;
      }
    }

    return node.map((child) => extractNode(child, ctx)).join("");
  }

  function extractTable(tableNode: unknown[]): string {
    const props = (tableNode[3] || {}) as Record<string, unknown>;
    const rows: string[][] = [];
    let headerRowCount = 0;

    function walkTable(node: unknown, isHeader = false): void {
      if (node === null || node === undefined) return;

      if (typeof node === "string") {
        const refMatch = node.match(RSC_REF_RE);
        if (refMatch && !visitedRefs.has(refMatch[1])) {
          visitedRefs.add(refMatch[1]);
          const refNode = getParsedChunk(refMatch[1]);
          if (refNode) walkTable(refNode, isHeader);
          visitedRefs.delete(refMatch[1]);
        }
        return;
      }

      if (!Array.isArray(node)) return;

      if (node[0] === "$" && typeof node[1] === "string") {
        const tag = node[1];
        const nodeProps = (node[3] || {}) as Record<string, unknown>;

        if (tag.startsWith("$L")) {
          const refId = tag.slice(2);
          if (!visitedRefs.has(refId)) {
            visitedRefs.add(refId);
            const refNode = getParsedChunk(refId);
            if (refNode) walkTable(refNode, isHeader);
            visitedRefs.delete(refId);
          }
          return;
        }

        if (tag === "thead") walkTable(nodeProps.children, true);
        else if (tag === "tbody") walkTable(nodeProps.children, false);
        else if (tag === "tr") {
          const cells: string[] = [];
          walkCells(nodeProps.children, cells);
          if (cells.length > 0) {
            rows.push(cells);
            if (isHeader) headerRowCount += 1;
          }
        } else {
          walkTable(nodeProps.children, isHeader);
        }
        return;
      }

      for (const child of node) walkTable(child, isHeader);
    }

    function walkCells(node: unknown, cells: string[]): void {
      if (node === null || node === undefined) return;

      if (typeof node === "string") {
        const refMatch = node.match(RSC_REF_RE);
        if (refMatch && !visitedRefs.has(refMatch[1])) {
          visitedRefs.add(refMatch[1]);
          const refNode = getParsedChunk(refMatch[1]);
          if (refNode) walkCells(refNode, cells);
          visitedRefs.delete(refMatch[1]);
        }
        return;
      }

      if (!Array.isArray(node)) return;

      if (node[0] === "$" && (node[1] === "td" || node[1] === "th")) {
        const cellProps = (node[3] || {}) as Record<string, unknown>;
        cells.push(
          extractNode(cellProps.children, { inCode: false, inTable: true })
            .trim()
            .replace(/\n/g, " ")
            .replace(/\\/g, "\\\\")
            .replace(/\|/g, "\\|"),
        );
        return;
      }

      if (node[0] === "$" && typeof node[1] === "string" && node[1].startsWith("$L")) {
        const refId = node[1].slice(2);
        if (!visitedRefs.has(refId)) {
          visitedRefs.add(refId);
          const refNode = getParsedChunk(refId);
          if (refNode) walkCells(refNode, cells);
          visitedRefs.delete(refId);
        }
        return;
      }

      for (const child of node) walkCells(child, cells);
    }

    walkTable(props.children);
    if (rows.length === 0) return "";

    const colCount = Math.max(...rows.map((row) => row.length));
    let markdown = "";
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex].concat(Array(colCount - rows[rowIndex].length).fill(""));
      markdown += `| ${row.join(" | ")} |\n`;
      if (rowIndex === headerRowCount - 1 || (headerRowCount === 0 && rowIndex === 0)) {
        markdown += `| ${Array(colCount).fill("---").join(" | ")} |\n`;
      }
    }
    return markdown;
  }

  const mainContent = extractFromMainChunk(getParsedChunk, extractNode);
  if (mainContent) return toRscMarkdown(title, mainContent);

  const fallbackContent = extractFromFallbackChunks(chunkMap, getParsedChunk, extractNode, visitedRefs);
  return fallbackContent ? toRscMarkdown(title, fallbackContent) : null;
}

function parseFlightChunks(html: string): Map<string, string> {
  const chunks = new Map<string, string>();

  for (const match of html.matchAll(RSC_SCRIPT_RE)) {
    let scriptContent: string;
    try {
      scriptContent = JSON.parse(`"${match[1]}"`) as string;
    } catch {
      continue;
    }

    for (const line of scriptContent.split("\n")) {
      const colonIndex = line.indexOf(":");
      if (colonIndex <= 0 || colonIndex > 4) continue;

      const id = line.slice(0, colonIndex);
      if (!/^[0-9a-f]+$/i.test(id)) continue;

      const payload = line.slice(colonIndex + 1);
      if (!payload) continue;

      const existing = chunks.get(id);
      if (!existing || payload.length > existing.length) chunks.set(id, payload);
    }
  }

  return chunks;
}

function extractFromMainChunk(
  getParsedChunk: (id: string) => unknown | null,
  extractNode: (node: unknown) => string,
): string | null {
  const mainChunk = getParsedChunk("23");
  if (!mainChunk) return null;

  const content = normalizeMarkdown(extractNode(mainChunk));
  return content.length > MIN_RSC_CONTENT_CHARS ? content : null;
}

function extractFromFallbackChunks(
  chunkMap: Map<string, string>,
  getParsedChunk: (id: string) => unknown | null,
  extractNode: (node: unknown) => string,
  visitedRefs: Set<string>,
): string | null {
  const parts: { order: number; text: string }[] = [];

  for (const [id] of chunkMap) {
    if (id === "23") continue;

    const parsed = getParsedChunk(id);
    if (!parsed) continue;

    visitedRefs.clear();
    const text = normalizeMarkdown(extractNode(parsed));
    if (text.length > 50 && !text.includes("page was not found") && !text.includes("404")) {
      parts.push({ order: Number.parseInt(id, 16), text });
    }
  }

  if (parts.length === 0) return null;

  parts.sort((a, b) => a.order - b.order);

  const seen = new Set<string>();
  const uniqueParts: string[] = [];
  for (const part of parts) {
    const key = part.text.slice(0, 150);
    if (!seen.has(key)) {
      seen.add(key);
      uniqueParts.push(part.text);
    }
  }

  const content = normalizeMarkdown(uniqueParts.join("\n\n"));
  return content.length > MIN_RSC_CONTENT_CHARS ? content : null;
}

function toRscMarkdown(title: string, content: string): RscMarkdown {
  return {
    title,
    content,
    wordCount: countWords(content),
    extractor: "rsc",
  };
}

function extractTitle(html: string): string | undefined {
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.split("|")[0]?.trim();
  return title || undefined;
}

function formatLink(content: string, href: string | undefined, finalUrl: string): string {
  if (!href || href.startsWith("#")) return content;

  try {
    return `[${content}](${new URL(href, finalUrl).toString()})`;
  } catch {
    return `[${content}](${href})`;
  }
}

function normalizeMarkdown(markdown: string): string {
  return markdown
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/u).length;
}
