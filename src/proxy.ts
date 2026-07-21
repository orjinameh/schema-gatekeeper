/**
 * MCP Proxy — spawns and connects to real MCP servers via stdio or HTTP,
 * and executes direct commands for git/system tools.
 *
 * Backend types:
 *   1. MCP server via stdio (file operations, local DataHub)
 *   2. MCP server via HTTP (DataHub Cloud managed endpoint)
 *   3. Direct child_process.exec (git, system commands)
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  type StdioServerParameters,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ToolSchema } from "./types.js";
import path from "node:path";
import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Find project root by walking up to find package.json
function findProjectRoot(): string {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

const PROJECT_ROOT = findProjectRoot();

// ─── Server Config Mapping ──────────────────────────────────────────────────
//
// Maps tool names to the MCP server that provides those tools.
// Uses local node_modules for fast spawning.

export interface ServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  allowedDirs?: string[];
}

// HTTP-based MCP server config (for DataHub Cloud managed endpoint)
export interface HttpServerConfig {
  url: string;           // e.g. https://<tenant>.acryl.io/integrations/ai/mcp/
  headers?: Record<string, string>;  // e.g. Authorization: Bearer <token>
}

const FILESYSTEM_SERVER = path.join(
  PROJECT_ROOT,
  "node_modules/@modelcontextprotocol/server-filesystem/dist/index.js"
);

// DataHub MCP server (via uvx for local, or HTTP for cloud)
const UVX_BIN = path.join(
  process.env.HOME ?? "/home",
  ".local/bin/uvx"
);

// Determine DataHub connection mode based on environment
const DATAHUB_CLOUD_URL = process.env.DATAHUB_CLOUD_URL ?? "";  // e.g. https://<tenant>.acryl.io/integrations/ai/mcp/
const DATAHUB_GMS_URL = process.env.DATAHUB_GMS_URL ?? "";      // e.g. http://localhost:8080
const DATAHUB_GMS_TOKEN = process.env.DATAHUB_GMS_TOKEN ?? "";

// Build DataHub MCP env for local uvx mode
const DATAHUB_MCP_ARGS = ["mcp-server-datahub@latest"];
const DATAHUB_MCP_ENV: Record<string, string> = {
  DATAHUB_GMS_URL,
  DATAHUB_GMS_TOKEN,
  TOOLS_IS_MUTATION_ENABLED: "true",
  TOOLS_IS_USER_ENABLED: "true",
};

// Map: toolName → server config
const TOOL_SERVER_MAP: Record<string, ServerConfig> = {
  // File operations → @modelcontextprotocol/server-filesystem
  read_file: {
    command: process.execPath,
    args: [FILESYSTEM_SERVER, "/tmp", "/home"],
  },
  write_file: {
    command: process.execPath,
    args: [FILESYSTEM_SERVER, "/tmp", "/home"],
  },
  list_directory: {
    command: process.execPath,
    args: [FILESYSTEM_SERVER, "/tmp", "/home"],
  },
  search_files: {
    command: process.execPath,
    args: [FILESYSTEM_SERVER, "/tmp", "/home"],
  },

  // DataHub → DataHub MCP server (via uvx)
  dh_search: {
    command: UVX_BIN,
    args: DATAHUB_MCP_ARGS,
    env: DATAHUB_MCP_ENV,
  },
  dh_get_entities: {
    command: UVX_BIN,
    args: DATAHUB_MCP_ARGS,
    env: DATAHUB_MCP_ENV,
  },
  dh_list_schema: {
    command: UVX_BIN,
    args: DATAHUB_MCP_ARGS,
    env: DATAHUB_MCP_ENV,
  },
  dh_get_lineage: {
    command: UVX_BIN,
    args: DATAHUB_MCP_ARGS,
    env: DATAHUB_MCP_ENV,
  },
  dh_lineage_paths: {
    command: UVX_BIN,
    args: DATAHUB_MCP_ARGS,
    env: DATAHUB_MCP_ENV,
  },
  dh_get_queries: {
    command: UVX_BIN,
    args: DATAHUB_MCP_ARGS,
    env: DATAHUB_MCP_ENV,
  },
  dh_draft_sql: {
    command: UVX_BIN,
    args: DATAHUB_MCP_ARGS,
    env: DATAHUB_MCP_ENV,
  },
  dh_add_tags: {
    command: UVX_BIN,
    args: DATAHUB_MCP_ARGS,
    env: DATAHUB_MCP_ENV,
  },
  dh_add_terms: {
    command: UVX_BIN,
    args: DATAHUB_MCP_ARGS,
    env: DATAHUB_MCP_ENV,
  },
  dh_update_desc: {
    command: UVX_BIN,
    args: DATAHUB_MCP_ARGS,
    env: DATAHUB_MCP_ENV,
  },
  dh_search_docs: {
    command: UVX_BIN,
    args: DATAHUB_MCP_ARGS,
    env: DATAHUB_MCP_ENV,
  },
  dh_save_doc: {
    command: UVX_BIN,
    args: DATAHUB_MCP_ARGS,
    env: DATAHUB_MCP_ENV,
  },

  // Database → @modelcontextprotocol/server-sqlite (if available)
  // For now, these stay simulated — no real SQLite server installed yet

  // Web search → simulated (brave API needs API key)

  // Browser → simulated (puppeteer MCP needs setup)

  // AI inference → simulated
};

// ─── HTTP Server Config Mapping ──────────────────────────────────────────────
// For DataHub Cloud managed MCP endpoint (streamable HTTP transport)

const DATAHUB_HTTP_CONFIG: HttpServerConfig | null =
  DATAHUB_CLOUD_URL && DATAHUB_GMS_TOKEN
    ? {
        url: DATAHUB_CLOUD_URL,
        headers: {
          Authorization: `Bearer ${DATAHUB_GMS_TOKEN}`,
        },
      }
    : null;

// Map tool names to HTTP server configs (DataHub Cloud)
const TOOL_HTTP_MAP: Record<string, HttpServerConfig> = {};
if (DATAHUB_HTTP_CONFIG) {
  const dhTools = [
    "dh_search", "dh_get_entities", "dh_list_schema", "dh_get_lineage",
    "dh_lineage_paths", "dh_get_queries", "dh_draft_sql", "dh_add_tags",
    "dh_add_terms", "dh_update_desc", "dh_search_docs", "dh_save_doc",
  ];
  for (const tool of dhTools) {
    TOOL_HTTP_MAP[tool] = DATAHUB_HTTP_CONFIG;
  }
}

// ─── Direct Command Execution ───────────────────────────────────────────────
//
// For tools that don't need an MCP server — just shell out to local commands.

interface DirectToolConfig {
  command: string;
  args: (payload: Record<string, unknown>) => string[];
  cwd?: (payload: Record<string, unknown>) => string | undefined;
  timeoutMs?: number;
}

// ─── Command Sandboxing ─────────────────────────────────────────────────────
//
// run_command executes arbitrary shell commands. Without restrictions, this is
// a remote code execution vector. We block known-dangerous patterns and enforce
// a hard timeout. This is NOT a security boundary — it's a guardrail for the
// demo. Production use should use a proper sandbox (gVisor, nsjail, etc.).

const BLOCKED_PATTERNS: RegExp[] = [
  new RegExp("\\brm\\s+(-[a-zA-Z]*f|-[a-zA-Z]*r)\\b"),  // rm -rf, rm -fr
  new RegExp("\\bmkfs\\b"),                                // format filesystem
  new RegExp("\\bdd\\b.*of="),                             // dd writing to device
  new RegExp("\\b:(){ :\\|:& };:"),                        // fork bomb
  new RegExp("\\bchmod\\s+777\\b"),                        // world-writable
  new RegExp("\\bcurl\\b.*\\|\\s*sh"),                     // pipe curl to shell
  new RegExp("\\bwget\\b.*\\|\\s*sh"),                     // pipe wget to shell
  new RegExp("\\bsudo\\b"),                                // privilege escalation
  new RegExp("\\bsu\\b"),                                  // user switching
  new RegExp("\\bkill\\s+-9\\s+1\\b"),                     // kill init
  new RegExp("\\bshutdown\\b"),                            // shutdown
  new RegExp("\\breboot\\b"),                              // reboot
  new RegExp("\\bmount\\b"),                               // mount
  new RegExp("\\bumount\\b"),                              // unmount
  new RegExp("\\bifconfig\\b"),                            // network config
  new RegExp("\\biptables\\b"),                            // firewall
  new RegExp("\\bnc\\b.*-l"),                              // netcat listener
  new RegExp("\\bexec\\s+"),                               // exec
  new RegExp("\\beval\\s+"),                               // eval
];

/**
 * Check if a command is blocked by the sandbox.
 * Returns null if safe, or an error message if blocked.
 */
function checkCommandSandbox(command: string): string | null {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      return `Command blocked by sandbox: matches dangerous pattern ${pattern}`;
    }
  }
  return null;
}

const DIRECT_TOOL_MAP: Record<string, DirectToolConfig> = {
  git_status: {
    command: "git",
    args: (p) => ["status", "--porcelain"],
    cwd: (p) => (p.repository_path as string) ?? process.cwd(),
    timeoutMs: 10_000,
  },
  git_diff: {
    command: "git",
    args: (p) => {
      const target = (p.target as string) ?? "HEAD";
      if (target === "staged") return ["diff", "--cached"];
      if (target === "HEAD") return ["diff"];
      return ["diff", target];
    },
    cwd: (p) => (p.repository_path as string) ?? process.cwd(),
    timeoutMs: 10_000,
  },
  git_log: {
    command: "git",
    args: (p) => {
      const count = (p.count as number) ?? 10;
      return ["log", `--oneline`, `-n`, String(count)];
    },
    cwd: (p) => (p.repository_path as string) ?? process.cwd(),
    timeoutMs: 10_000,
  },
  run_command: {
    command: "sh",
    args: (p) => ["-c", p.command as string],
    cwd: (p) => (p.cwd as string) ?? process.cwd(),
    timeoutMs: (p) => (p.timeout_ms as number) ?? 30_000,
  },
  get_environment: {
    command: "uname",
    args: () => ["-a"],
    timeoutMs: 5_000,
  },
};

// Set of all tool names with real backends (MCP or direct)
const ALL_REAL_TOOLS = new Set([
  ...Object.keys(TOOL_SERVER_MAP),
  ...Object.keys(TOOL_HTTP_MAP),
  ...Object.keys(DIRECT_TOOL_MAP),
]);

// ─── Connection Pool ─────────────────────────────────────────────────────────

type AnyTransport = StdioClientTransport | StreamableHTTPClientTransport;

interface PooledConnection {
  client: Client;
  transport: AnyTransport;
  serverName: string;
  connected: boolean;
}

const connectionPool = new Map<string, PooledConnection>();

/**
 * Get or create a connection to the MCP server that handles a given tool.
 * Checks HTTP map first (DataHub Cloud), then stdio map (local servers).
 */
async function getConnection(
  toolName: string
): Promise<PooledConnection | null> {
  // ── HTTP transport (DataHub Cloud) ──
  const httpConfig = TOOL_HTTP_MAP[toolName];
  if (httpConfig) {
    const poolKey = `http:${httpConfig.url}`;
    const existing = connectionPool.get(poolKey);
    if (existing?.connected) return existing;

    const transport = new StreamableHTTPClientTransport(
      new URL(httpConfig.url),
      {
        requestInit: {
          headers: httpConfig.headers ?? {},
        },
      }
    );

    const client = new Client(
      { name: "schema-gatekeeper", version: "1.0.0" },
      { capabilities: {} }
    );

    try {
      await client.connect(transport);
    } catch (err) {
      console.error(
        `[proxy] Failed to connect to HTTP server for "${toolName}": ${err instanceof Error ? err.message : String(err)}`
      );
      return null;
    }

    const conn: PooledConnection = {
      client,
      transport,
      serverName: poolKey,
      connected: true,
    };
    connectionPool.set(poolKey, conn);
    return conn;
  }

  // ── Stdio transport (local MCP servers) ──
  const config = TOOL_SERVER_MAP[toolName];
  if (!config) return null;

  // Use the command as the pool key (same server = same connection)
  const poolKey = `${config.command}:${config.args.join(" ")}`;

  const existing = connectionPool.get(poolKey);
  if (existing?.connected) return existing;

  // Spawn new connection
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: config.env,
    stderr: "pipe",
  });

  const client = new Client(
    { name: "schema-gatekeeper", version: "1.0.0" },
    { capabilities: {} }
  );

  try {
    await client.connect(transport);
  } catch (err) {
    console.error(
      `[proxy] Failed to connect to server for tools: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;  // Graceful fallback — falls back to simulated response
  }

  const conn: PooledConnection = {
    client,
    transport,
    serverName: poolKey,
    connected: true,
  };

  connectionPool.set(poolKey, conn);
  return conn;
}

/**
 * Map our tool name to the actual tool name on the upstream MCP server.
 * The filesystem server exposes tools with different names than ours.
 */
function mapToolName(upstreamToolName: string): string {
  // Our names → upstream server names
  const nameMap: Record<string, string> = {
    // Filesystem server
    read_file: "read_file",
    write_file: "write_file",
    list_directory: "list_directory",
    search_files: "search_files",
    // DataHub MCP server
    dh_search: "search",
    dh_get_entities: "get_entities",
    dh_list_schema: "list_schema_fields",
    dh_get_lineage: "get_lineage",
    dh_lineage_paths: "get_lineage_paths_between",
    dh_get_queries: "get_dataset_queries",
    dh_draft_sql: "draft_sql_for_tables",
    dh_add_tags: "add_tags",
    dh_add_terms: "add_terms",
    dh_update_desc: "update_description",
    dh_search_docs: "search_documents",
    dh_save_doc: "save_document",
  };
  return nameMap[upstreamToolName] ?? upstreamToolName;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface ProxyResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

/**
 * Execute a tool call — checks direct tools first, then MCP servers.
 * Returns null if no backend is configured (use simulated fallback).
 */
export async function proxyToolCall(
  toolName: string,
  payload: Record<string, unknown>
): Promise<ProxyResult | null> {
  // ── Direct execution (git, system) ──
  const directConfig = DIRECT_TOOL_MAP[toolName];
  if (directConfig) {
    return executeDirect(toolName, directConfig, payload);
  }

  // ── MCP server connection (file operations) ──
  const conn = await getConnection(toolName);
  if (!conn) {
    console.error(`[proxy] No backend configured for "${toolName}"`);
    return null;
  }

  try {
    const upstreamName = mapToolName(toolName);
    console.error(
      `[proxy] Calling "${upstreamName}" on upstream server...`
    );
    const result = await conn.client.callTool({
      name: upstreamName,
      arguments: payload,
    });

    // Normalize the result to our format
    if (result && typeof result === "object" && "content" in result) {
      return {
        content: (result as { content: Array<{ type: string; text: string }> })
          .content as Array<{ type: "text"; text: string }>,
        isError: (result as { isError?: boolean }).isError,
      };
    }

    // Fallback: stringify whatever came back
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `Proxy error calling "${toolName}": ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Execute a tool via direct child_process.execFile.
 */
async function executeDirect(
  toolName: string,
  config: DirectToolConfig,
  payload: Record<string, unknown>
): Promise<ProxyResult> {
  const args = config.args(payload);
  const cwd = config.cwd?.(payload);
  const timeoutMs =
    typeof config.timeoutMs === "function"
      ? config.timeoutMs(payload)
      : config.timeoutMs ?? 30_000;

  // Sandbox check for run_command (arbitrary shell execution)
  if (toolName === "run_command") {
    const rawCommand = payload.command as string;
    const blocked = checkCommandSandbox(rawCommand);
    if (blocked) {
      console.error(`[proxy] SANDBOX BLOCKED: ${blocked}`);
      return {
        content: [{ type: "text", text: blocked }],
        isError: true,
      };
    }
  }

  console.error(
    `[proxy] Direct exec: ${config.command} ${args.join(" ")} (cwd=${cwd ?? "inherit"})`
  );

  try {
    const { stdout, stderr } = await execFileAsync(config.command, args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024, // 1MB
    });

    const output = [stdout, stderr].filter(Boolean).join("\n").trim();
    return {
      content: [{ type: "text", text: output || "(no output)" }],
    };
  } catch (err: unknown) {
    const execErr = err as { code?: number; stdout?: string; stderr?: string; message?: string };
    const output = [execErr.stdout, execErr.stderr]
      .filter(Boolean)
      .join("\n")
      .trim();
    return {
      content: [
        {
          type: "text",
          text:
            output ||
            `Command failed: ${config.command} ${args.join(" ")} — ${execErr.message ?? "unknown error"}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Check if a tool has a real backend configured (MCP or direct).
 */
export function hasRealBackend(toolName: string): boolean {
  return ALL_REAL_TOOLS.has(toolName);
}

/**
 * Get the list of tools that have real backends.
 */
export function getRealBackendTools(): string[] {
  return [...ALL_REAL_TOOLS];
}

/**
 * Gracefully close all pooled connections.
 */
export async function closeAllConnections(): Promise<void> {
  for (const [, conn] of connectionPool) {
    if (conn.connected) {
      try {
        await conn.transport.close();
        conn.connected = false;
      } catch {
        // Ignore close errors
      }
    }
  }
  connectionPool.clear();
}
