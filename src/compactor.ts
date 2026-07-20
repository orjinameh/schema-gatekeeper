import type { ToolSchema, CompactedTool } from "./types.js";

/**
 * Schema Compactor — the core algorithm.
 *
 * Transforms verbose JSON schemas into ultra-compact pseudo-markdown
 * signatures that convey maximum information with minimum tokens.
 *
 * BEFORE (raw schema) — ~180 tokens:
 *   { type: "object", title: "ReadFileArguments", description: "Arguments for reading a file...",
 *     properties: { path: { type: "string", description: "The absolute path..." } },
 *     required: ["path"] }
 *
 * AFTER (compacted) — ~15 tokens:
 *   read_file(path!:string)
 */

/** Extract the first sentence (up to first period, exclamation, or newline). */
function firstSentence(s: string): string {
  const match = s.match(/^[^.!?\n]+[.!?]?/);
  return match ? match[0].trim() : s.slice(0, 80);
}

/** Map JSON Schema type to compact shorthand. */
function compactType(schema: Record<string, unknown>): string {
  const t = schema.type as string | undefined;
  if (t === "string") return "string";
  if (t === "number" || t === "integer") return "number";
  if (t === "boolean") return "boolean";
  if (t === "array") {
    const items = schema.items as Record<string, unknown> | undefined;
    if (items?.type) return `${items.type}[]`;
    return "any[]";
  }
  if (t === "object") return "object";
  return "any";
}

/**
 * Build a compact signature string for a single tool.
 *
 * Format: tool_name(param!:type, param?:type=default, param:type)
 *   - ! = required
 *   - ? = optional
 *   - Truncated description appended after |
 *
 * Example: read_file(path!:string, offset?:number, limit?:number) | Read file contents
 */
function buildSignature(tool: ToolSchema): string {
  const schema = tool.inputSchema;
  const props = (schema.properties ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  const required = new Set((schema.required ?? []) as string[]);

  const params = Object.entries(props).map(([name, propSchema]) => {
    const type = compactType(propSchema);
    const req = required.has(name);
    const marker = req ? "!" : "?";
    return `${name}${marker}:${type}`;
  });

  const paramStr = params.length > 0 ? params.join(",") : "";
  const desc = firstSentence(tool.description);
  return `${tool.name}(${paramStr}) | ${desc}`;
}

/**
 * Compact an array of tool schemas into a compact catalog string.
 *
 * Returns one compact signature per line, prefixed with a category header.
 */
export function compactTools(tools: ToolSchema[]): CompactedTool[] {
  return tools.map((t) => ({
    name: t.name,
    signature: buildSignature(t),
    category: t.category,
  }));
}

/**
 * Render compact tools into a single catalog string for the LLM.
 *
 * Format:
 *   ## file-operations
 *   read_file(path!:string) | Read file contents
 *   write_file(path!:string,content!:string) | Write content to file
 *
 *   ## database
 *   query(sql!:string,database?:string) | Execute SQL query
 */
export function renderCatalog(tools: CompactedTool[]): string {
  const grouped = new Map<string, CompactedTool[]>();
  for (const t of tools) {
    const group = grouped.get(t.category) ?? [];
    group.push(t);
    grouped.set(t.category, group);
  }

  const lines: string[] = [];
  for (const [category, items] of grouped) {
    lines.push(`## ${category}`);
    for (const item of items) {
      lines.push(item.signature);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

/**
 * Calculate token savings.
 * Uses a rough estimate: 1 token ≈ 4 characters for English text.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Return a comparison object showing token savings.
 */
export function measureSavings(tools: ToolSchema[]): {
  originalTokens: number;
  compactedTokens: number;
  savingsPercent: number;
} {
  // Simulate what the LLM would see WITHOUT the proxy:
  // All tools dumped as full JSON schema definitions
  const originalSchemas = tools
    .map((t) => JSON.stringify(t.inputSchema))
    .join("\n");
  const originalWithDesc = tools
    .map(
      (t) =>
        `Tool: ${t.name}\nDescription: ${t.description}\nSchema: ${JSON.stringify(t.inputSchema)}`
    )
    .join("\n\n");

  const compacted = renderCatalog(compactTools(tools));

  const originalTokens = estimateTokens(originalWithDesc);
  const compactedTokens = estimateTokens(compacted);

  return {
    originalTokens,
    compactedTokens,
    savingsPercent: Math.round(
      ((originalTokens - compactedTokens) / originalTokens) * 100
    ),
  };
}
