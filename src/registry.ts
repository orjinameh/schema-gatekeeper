import type { ToolSchema } from "./types.js";

export const CATEGORIES = [
  "file-operations",
  "database",
  "web-search",
  "browser",
  "git",
  "ai-inference",
  "system",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const REGISTRY: ToolSchema[] = [
  // ── file-operations ──
  {
    name: "read_file",
    category: "file-operations",
    description:
      "Read the complete contents of a file from the file system. For large files, you can request just a partial read by specifying an offset and limit.",
    inputSchema: {
      type: "object",
      title: "ReadFileArguments",
      description:
        "Arguments for reading a file. Supports absolute paths. Returns text content with line numbers.",
      properties: {
        path: {
          type: "string",
          description: "The absolute path to the file to read",
          title: "File Path",
        },
        offset: {
          type: "number",
          description:
            "The line number to start reading from (0-indexed). Defaults to the beginning of the file.",
          title: "Offset",
        },
        limit: {
          type: "number",
          description:
            "The number of lines to read. If not provided, reads the entire file.",
          title: "Limit",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "write_file",
    category: "file-operations",
    description:
      "Write content to a file on the file system. Creates the file if it doesn't exist, overwrites if it does.",
    inputSchema: {
      type: "object",
      title: "WriteFileArguments",
      description: "Arguments for writing to a file.",
      properties: {
        path: {
          type: "string",
          description: "The absolute path to the file to write",
          title: "File Path",
        },
        content: {
          type: "string",
          description: "The content to write to the file",
          title: "Content",
        },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "list_directory",
    category: "file-operations",
    description:
      "Get a listing of all files and directories immediately within a given directory path.",
    inputSchema: {
      type: "object",
      title: "ListDirectoryArguments",
      description: "Arguments for listing directory contents.",
      properties: {
        path: {
          type: "string",
          description:
            "The absolute path to the directory to list. Use this to discover files in a specific location.",
          title: "Directory Path",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "search_files",
    category: "file-operations",
    description:
      "Find files matching a glob pattern within a directory tree. Useful for finding files by name or extension.",
    inputSchema: {
      type: "object",
      title: "SearchFilesArguments",
      description: "Arguments for searching files by glob pattern.",
      properties: {
        path: {
          type: "string",
          description: "The absolute path to the directory to search in",
          title: "Search Root",
        },
        pattern: {
          type: "string",
          description:
            "Glob pattern to match files (e.g. **/*.ts, src/**/*.test.js)",
          title: "Pattern",
        },
      },
      required: ["path", "pattern"],
      additionalProperties: false,
    },
  },

  // ── database ──
  {
    name: "query",
    category: "database",
    description:
      "Execute a read-only SQL query against a SQLite database and return the results.",
    inputSchema: {
      type: "object",
      title: "QueryArguments",
      description: "Arguments for executing a SQL query.",
      properties: {
        sql: {
          type: "string",
          description: "The SQL query to execute",
          title: "SQL Query",
        },
        database: {
          type: "string",
          description:
            "Path to the SQLite database file. Defaults to the current working directory.",
          title: "Database Path",
        },
      },
      required: ["sql"],
      additionalProperties: false,
    },
  },
  {
    name: "list_tables",
    category: "database",
    description:
      "List all tables in the connected SQLite database with their schemas.",
    inputSchema: {
      type: "object",
      title: "ListTablesArguments",
      properties: {
        database: {
          type: "string",
          description: "Path to the SQLite database file",
          title: "Database Path",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },

  // ── web-search ──
  {
    name: "brave_web_search",
    category: "web-search",
    description:
      "Perform a web search using Brave Search API and return relevant results with titles, URLs, and snippets.",
    inputSchema: {
      type: "object",
      title: "BraveWebSearchArguments",
      description: "Arguments for performing a web search.",
      properties: {
        query: {
          type: "string",
          description: "The search query string",
          title: "Search Query",
        },
        count: {
          type: "number",
          description:
            "Number of results to return (1-20). Defaults to 10.",
          title: "Result Count",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },

  // ── browser ──
  {
    name: "navigate",
    category: "browser",
    description:
      "Navigate the browser to a given URL and return the page content or a screenshot.",
    inputSchema: {
      type: "object",
      title: "NavigateArguments",
      properties: {
        url: {
          type: "string",
          description: "The URL to navigate to",
          title: "URL",
        },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "screenshot",
    category: "browser",
    description:
      "Take a screenshot of the current browser page. Optionally specify a CSS selector to screenshot a specific element.",
    inputSchema: {
      type: "object",
      title: "ScreenshotArguments",
      properties: {
        selector: {
          type: "string",
          description:
            "Optional CSS selector to screenshot a specific element. If omitted, captures the full viewport.",
          title: "Selector",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "click",
    category: "browser",
    description:
      "Click on an element identified by a CSS selector on the current page.",
    inputSchema: {
      type: "object",
      title: "ClickArguments",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector of the element to click",
          title: "Selector",
        },
      },
      required: ["selector"],
      additionalProperties: false,
    },
  },

  // ── git ──
  {
    name: "git_status",
    category: "git",
    description:
      "Show the working tree status — modified, staged, and untracked files.",
    inputSchema: {
      type: "object",
      title: "GitStatusArguments",
      properties: {
        repository_path: {
          type: "string",
          description:
            "Absolute path to the git repository. Defaults to current directory.",
          title: "Repository Path",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "git_diff",
    category: "git",
    description:
      "Show the diff of uncommitted changes. Can diff against staged, HEAD, or a specific commit.",
    inputSchema: {
      type: "object",
      title: "GitDiffArguments",
      properties: {
        repository_path: {
          type: "string",
          description: "Absolute path to the git repository",
          title: "Repository Path",
        },
        target: {
          type: "string",
          description:
            'What to diff against. Use "staged" for staged changes, "HEAD" for last commit, or a commit hash.',
          title: "Diff Target",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "git_log",
    category: "git",
    description:
      "Show recent commit history with authors, dates, and messages.",
    inputSchema: {
      type: "object",
      title: "GitLogArguments",
      properties: {
        repository_path: {
          type: "string",
          description: "Absolute path to the git repository",
          title: "Repository Path",
        },
        count: {
          type: "number",
          description: "Number of commits to show. Defaults to 10.",
          title: "Commit Count",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },

  // ── ai-inference ──
  {
    name: "generate_completion",
    category: "ai-inference",
    description:
      "Generate a text completion from a prompt using a local or remote LLM.",
    inputSchema: {
      type: "object",
      title: "GenerateCompletionArguments",
      properties: {
        prompt: {
          type: "string",
          description: "The input prompt for the model",
          title: "Prompt",
        },
        max_tokens: {
          type: "number",
          description: "Maximum number of tokens to generate. Defaults to 256.",
          title: "Max Tokens",
        },
        model: {
          type: "string",
          description:
            "Model identifier to use. Defaults to the configured default model.",
          title: "Model",
        },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
  },

  // ── system ──
  {
    name: "run_command",
    category: "system",
    description:
      "Execute a shell command and return its stdout/stderr output. Use with caution.",
    inputSchema: {
      type: "object",
      title: "RunCommandArguments",
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute",
          title: "Command",
        },
        cwd: {
          type: "string",
          description:
            "Working directory for the command. Defaults to home directory.",
          title: "Working Directory",
        },
        timeout_ms: {
          type: "number",
          description:
            "Maximum execution time in milliseconds. Defaults to 30000.",
          title: "Timeout (ms)",
        },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
  {
    name: "get_environment",
    category: "system",
    description:
      "Get system environment information — OS, architecture, available memory, node version, etc.",
    inputSchema: {
      type: "object",
      title: "GetEnvironmentArguments",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
];
