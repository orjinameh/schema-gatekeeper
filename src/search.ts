/**
 * Tool Search — keyword-based fallback discovery.
 *
 * When categories don't fit (new tool, unknown taxonomy),
 * the agent can use search_tools(query) for fuzzy matching
 * over tool names and descriptions.
 *
 * Uses simple token overlap scoring — no embeddings required.
 */

import { REGISTRY } from "./registry.js";
import { compactTools, renderCatalog } from "./compactor.js";
import type { ToolSchema } from "./types.js";

interface ScoredTool {
  tool: ToolSchema;
  score: number;
}

/**
 * Tokenize a string into lowercase words, stripping punctuation.
 */
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

/**
 * Score a tool against a query. Higher = better match.
 *
 * Scoring:
 *   - Exact name match: 10 points
 *   - Name contains query token: 5 points
 *   - Description contains query token: 1 point
 *   - Bonus for matching multiple query tokens
 */
function scoreTool(tool: ToolSchema, queryTokens: string[]): number {
  let score = 0;
  const nameLower = tool.name.toLowerCase();
  const descLower = tool.description.toLowerCase();
  const descTokens = new Set(tokenize(tool.description));

  for (const qt of queryTokens) {
    if (nameLower === qt) {
      score += 10;
    } else if (nameLower.includes(qt)) {
      score += 5;
    }
    if (descTokens.has(qt) || descLower.includes(qt)) {
      score += 1;
    }
  }

  return score;
}

/**
 * Search tools by free-text query.
 * Returns compact catalog of matching tools, sorted by relevance.
 */
export function searchTools(
  query: string,
  maxResults: number = 5
): { catalog: string; matchCount: number; query: string } {
  const queryTokens = tokenize(query);

  if (queryTokens.length === 0) {
    return {
      catalog: "No search terms provided. Try: search_tools({ query: 'file read' })",
      matchCount: 0,
      query,
    };
  }

  const scored: ScoredTool[] = REGISTRY.map((tool) => ({
    tool,
    score: scoreTool(tool, queryTokens),
  }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  if (scored.length === 0) {
    return {
      catalog: `No tools matched "${query}". Available categories: file-operations, database, web-search, browser, git, ai-inference, system`,
      matchCount: 0,
      query,
    };
  }

  const matchedTools = scored.map((s) => s.tool);
  const compacted = compactTools(matchedTools);
  const catalog = renderCatalog(compacted);

  return {
    catalog,
    matchCount: scored.length,
    query,
  };
}
