#!/usr/bin/env node --import tsx/esm

/**
 * Schema Gatekeeper — MCP Proxy Server
 *
 * Registers exactly 2 tools to the LLM:
 *   1. request_skills(category) — discover available tools in a category
 *   2. invoke_skill(toolName, payload) — execute a discovered tool
 *
 * The LLM never sees the raw 20+ tool schemas.
 * It only sees compact signatures, one category at a time.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  REGISTRY,
  CATEGORIES,
  type Category,
} from "./registry.js";
import {
  compactTools,
  renderCatalog,
  measureSavings,
} from "./compactor.js";
import { proxyToolCall, hasRealBackend } from "./proxy.js";
import { searchTools } from "./search.js";

// ─── Server Setup ────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "schema-gatekeeper",
  version: "1.0.0",
});

// ─── Tool 1: request_skills ──────────────────────────────────────────────────
//
// The LLM calls this to discover available tools in a category.
// Returns compact pseudo-markdown signatures instead of raw JSON schemas.

server.registerTool(
  "request_skills",
  {
    title: "Request Skills",
    description:
      "Discover available tools by category. Returns compact signatures — call this before invoke_skill. Categories: " +
      CATEGORIES.join(", "),
    inputSchema: {
      category: z
        .enum(CATEGORIES)
        .describe("The tool category to explore"),
    },
  },
  async ({ category }) => {
    const tools = REGISTRY.filter((t) => t.category === category);

    if (tools.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No tools found in category "${category}". Available categories: ${CATEGORIES.join(", ")}`,
          },
        ],
      };
    }

    const compacted = compactTools(tools);
    const catalog = renderCatalog(compacted);

    const savings = measureSavings(tools);

    const response = [
      `## Available tools in "${category}" (${tools.length} tools, ~${savings.compactedTokens} tokens vs ~${savings.originalTokens} raw)`,
      "",
      catalog,
      "",
      "---",
      "Call invoke_skill(toolName, payload) to execute any tool above.",
    ].join("\n");

    return {
      content: [{ type: "text" as const, text: response }],
    };
  }
);

// ─── Tool 2: invoke_skill ────────────────────────────────────────────────────
//
// The LLM calls this after reading compact schemas from request_skills.
// We match the toolName to our hidden registry and forward the call.

server.registerTool(
  "invoke_skill",
  {
    title: "Invoke Skill",
    description:
      "Execute a tool by name with the given arguments. Use request_skills first to discover available tools and their signatures.",
    inputSchema: {
      toolName: z
        .string()
        .describe(
          "Name of the tool to invoke (from the catalog returned by request_skills)"
        ),
      payload: z
        .record(z.string(), z.unknown())
        .describe("Arguments to pass to the tool"),
    },
  },
  async ({ toolName, payload }) => {
    // Find tool in registry
    const tool = REGISTRY.find((t) => t.name === toolName);

    if (!tool) {
      // Suggest closest match
      const suggestions = REGISTRY.filter(
        (t) =>
          t.name.includes(toolName) ||
          toolName.includes(t.name) ||
          t.name
            .split("_")
            .some((w) => toolName.toLowerCase().includes(w.toLowerCase()))
      ).map((t) => t.name);

      const hint =
        suggestions.length > 0
          ? ` Did you mean: ${suggestions.join(", ")}?`
          : ` Available tools: ${REGISTRY.map((t) => t.name).join(", ")}`;

      return {
        content: [
          {
            type: "text" as const,
            text: `Tool "${toolName}" not found.${hint}`,
          },
        ],
        isError: true,
      };
    }

    // Validate required fields
    const required = (tool.inputSchema.required ?? []) as string[];
    const missing = required.filter((k) => !(k in payload));
    if (missing.length > 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Missing required arguments: ${missing.join(", ")}`,
          },
        ],
        isError: true,
      };
    }

    // ── Execute the tool ──
    // Try the real proxy first. If no backend configured, fall back to simulated.
    if (hasRealBackend(toolName)) {
      const proxyResult = await proxyToolCall(toolName, payload);
      if (proxyResult) {
        return proxyResult;
      }
    }

    // Simulated fallback for tools without a real backend
    const result = {
      tool: tool.name,
      category: tool.category,
      args: payload,
      status: "simulated",
      message: `Tool "${toolName}" would execute with args: ${JSON.stringify(payload, null, 2)}`,
    };

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

// ─── Tool 3: search_tools ────────────────────────────────────────────────────
//
// Fuzzy/keyword search over tool names and descriptions.
// Use when categories don't fit or the agent doesn't know the taxonomy.

server.registerTool(
  "search_tools",
  {
    title: "Search Tools",
    description:
      "Search available tools by free-text query. Use when request_skills categories don't cover what you need, or you're unsure which category a tool belongs to.",
    inputSchema: {
      query: z
        .string()
        .describe(
          "Free-text search query (e.g. 'file read', 'sql query', 'screenshot')"
        ),
      maxResults: z
        .number()
        .optional()
        .default(5)
        .describe("Maximum number of results to return (default 5)"),
    },
  },
  async ({ query, maxResults }) => {
    const result = searchTools(query, maxResults);

    const header = `## Search: "${result.query}" (${result.matchCount} matches)`;
    const response = [header, "", result.catalog].join("\n");

    return {
      content: [{ type: "text" as const, text: response }],
    };
  }
);

// ─── Launch ──────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log startup metrics to stderr (not stdout — that's for MCP protocol)
  const savings = measureSavings(REGISTRY);
  console.error(
    `[schema-gatekeeper] Running. ${REGISTRY.length} tools registered across ${CATEGORIES.length} categories. 3 gateway tools exposed.`
  );
  console.error(
    `[schema-gatekeeper] Token savings: ~${savings.originalTokens} → ~${savings.compactedTokens} (${savings.savingsPercent}% reduction)`
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
