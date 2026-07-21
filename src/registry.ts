import type { ToolSchema } from "./types.js";

export const CATEGORIES = [
  "file-operations",
  "database",
  "web-search",
  "browser",
  "git",
  "ai-inference",
  "system",
  "data-catalog",
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

  // ── data-catalog (DataHub) ──
  {
    name: "dh_search",
    category: "data-catalog",
    description:
      "Search DataHub for datasets, dashboards, and other data assets using structured keyword search with boolean logic, wildcards, and filters.",
    inputSchema: {
      type: "object",
      title: "DataHubSearchArguments",
      description: "Arguments for searching DataHub catalog.",
      properties: {
        query: {
          type: "string",
          description:
            'Search query. Supports boolean logic (OR, AND), wildcards (revenue_*), and field filters (tag:PII).',
          title: "Search Query",
        },
        filters: {
          type: "string",
          description:
            "Comma-separated filter expressions, e.g. 'platform:snowflake,env:PROD'.",
          title: "Filters",
        },
        limit: {
          type: "number",
          description: "Maximum number of results. Defaults to 10.",
          title: "Limit",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "dh_get_entities",
    category: "data-catalog",
    description:
      "Fetch detailed metadata for one or more DataHub entities by URN, including ownership, tags, glossary terms, and descriptions.",
    inputSchema: {
      type: "object",
      title: "DataHubGetEntitiesArguments",
      description: "Arguments for fetching entity metadata from DataHub.",
      properties: {
        urns: {
          type: "string",
          description:
            "Comma-separated list of entity URNs to fetch (e.g. urn:li:dataset:(...))",
          title: "Entity URNs",
        },
      },
      required: ["urns"],
      additionalProperties: false,
    },
  },
  {
    name: "dh_list_schema",
    category: "data-catalog",
    description:
      "List schema fields for a dataset with optional keyword filtering. Returns column names, types, and descriptions.",
    inputSchema: {
      type: "object",
      title: "DataHubListSchemaArguments",
      description: "Arguments for listing dataset schema fields.",
      properties: {
        urn: {
          type: "string",
          description: "URN of the dataset to inspect",
          title: "Dataset URN",
        },
        filter: {
          type: "string",
          description:
            "Optional keyword to filter schema fields (e.g. 'email', 'date')",
          title: "Filter",
        },
        start: {
          type: "number",
          description: "Pagination offset. Defaults to 0.",
          title: "Start",
        },
        count: {
          type: "number",
          description: "Number of fields to return. Defaults to 40.",
          title: "Count",
        },
      },
      required: ["urn"],
      additionalProperties: false,
    },
  },
  {
    name: "dh_get_lineage",
    category: "data-catalog",
    description:
      "Get upstream or downstream lineage for any DataHub entity (datasets, columns, dashboards) with hop control and pagination.",
    inputSchema: {
      type: "object",
      title: "DataHubGetLineageArguments",
      description: "Arguments for fetching data lineage.",
      properties: {
        urn: {
          type: "string",
          description: "URN of the entity to get lineage for",
          title: "Entity URN",
        },
        direction: {
          type: "string",
          description:
            'Lineage direction: "UPSTREAM" (where data comes from) or "DOWNSTREAM" (where data flows to). Defaults to DOWNSTREAM.',
          title: "Direction",
        },
        max_hops: {
          type: "number",
          description: "Maximum number of lineage hops. Defaults to 1.",
          title: "Max Hops",
        },
        start: {
          type: "number",
          description: "Pagination offset. Defaults to 0.",
          title: "Start",
        },
        count: {
          type: "number",
          description: "Number of results. Defaults to 40.",
          title: "Count",
        },
      },
      required: ["urn"],
      additionalProperties: false,
    },
  },
  {
    name: "dh_lineage_paths",
    category: "data-catalog",
    description:
      "Get the exact lineage path between two DataHub entities, including intermediate transformations and SQL query context.",
    inputSchema: {
      type: "object",
      title: "DataHubLineagePathsArguments",
      description:
        "Arguments for finding lineage paths between two assets.",
      properties: {
        source_urn: {
          type: "string",
          description: "URN of the source entity",
          title: "Source URN",
        },
        destination_urn: {
          type: "string",
          description: "URN of the destination entity",
          title: "Destination URN",
        },
        max_hops: {
          type: "number",
          description: "Maximum hops to search. Defaults to 3.",
          title: "Max Hops",
        },
      },
      required: ["source_urn", "destination_urn"],
      additionalProperties: false,
    },
  },
  {
    name: "dh_get_queries",
    category: "data-catalog",
    description:
      "Fetch real SQL queries that reference a dataset or column. Understand usage patterns, join behavior, and aggregation logic.",
    inputSchema: {
      type: "object",
      title: "DataHubGetQueriesArguments",
      description: "Arguments for fetching dataset query history.",
      properties: {
        urn: {
          type: "string",
          description: "URN of the dataset or column",
          title: "Entity URN",
        },
        limit: {
          type: "number",
          description: "Maximum queries to return. Defaults to 10.",
          title: "Limit",
        },
      },
      required: ["urn"],
      additionalProperties: false,
    },
  },
  {
    name: "dh_draft_sql",
    category: "data-catalog",
    description:
      "Draft a SQL query against specified tables using DataHub context (schemas, sample queries, lineage).",
    inputSchema: {
      type: "object",
      title: "DataHubDraftSqlArguments",
      description: "Arguments for drafting SQL from catalog context.",
      properties: {
        tables: {
          type: "string",
          description:
            "Comma-separated URNs of tables to query against",
          title: "Table URNs",
        },
        question: {
          type: "string",
          description:
            "Natural language description of what the SQL should answer",
          title: "Question",
        },
      },
      required: ["tables", "question"],
      additionalProperties: false,
    },
  },
  {
    name: "dh_add_tags",
    category: "data-catalog",
    description:
      "Add tags to a DataHub entity or schema field for classification and discovery.",
    inputSchema: {
      type: "object",
      title: "DataHubAddTagsArguments",
      description: "Arguments for adding tags to an entity.",
      properties: {
        urn: {
          type: "string",
          description: "URN of the entity to tag",
          title: "Entity URN",
        },
        tags: {
          type: "string",
          description: "Comma-separated tag names to add",
          title: "Tags",
        },
      },
      required: ["urn", "tags"],
      additionalProperties: false,
    },
  },
  {
    name: "dh_add_terms",
    category: "data-catalog",
    description:
      "Add business glossary terms to an entity or schema field for data governance.",
    inputSchema: {
      type: "object",
      title: "DataHubAddTermsArguments",
      description: "Arguments for adding glossary terms.",
      properties: {
        urn: {
          type: "string",
          description: "URN of the entity to annotate",
          title: "Entity URN",
        },
        terms: {
          type: "string",
          description: "Comma-separated glossary term names",
          title: "Terms",
        },
      },
      required: ["urn", "terms"],
      additionalProperties: false,
    },
  },
  {
    name: "dh_update_desc",
    category: "data-catalog",
    description:
      "Update, append to, or remove the description of a DataHub entity or schema field.",
    inputSchema: {
      type: "object",
      title: "DataHubUpdateDescriptionArguments",
      description: "Arguments for updating an entity description.",
      properties: {
        urn: {
          type: "string",
          description: "URN of the entity to update",
          title: "Entity URN",
        },
        description: {
          type: "string",
          description:
            "New description text. Set to empty string to remove.",
          title: "Description",
        },
      },
      required: ["urn", "description"],
      additionalProperties: false,
    },
  },
  {
    name: "dh_search_docs",
    category: "data-catalog",
    description:
      "Search DataHub knowledge documents (runbooks, FAQs, insights) by keyword.",
    inputSchema: {
      type: "object",
      title: "DataHubSearchDocsArguments",
      description: "Arguments for searching knowledge documents.",
      properties: {
        query: {
          type: "string",
          description: "Search keyword for documents",
          title: "Query",
        },
        limit: {
          type: "number",
          description: "Maximum results. Defaults to 10.",
          title: "Limit",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "dh_save_doc",
    category: "data-catalog",
    description:
      "Save a document (insight, decision, FAQ, note) to DataHub's knowledge base.",
    inputSchema: {
      type: "object",
      title: "DataHubSaveDocArguments",
      description: "Arguments for saving a knowledge document.",
      properties: {
        title: {
          type: "string",
          description: "Document title",
          title: "Title",
        },
        content: {
          type: "string",
          description: "Document content (supports markdown)",
          title: "Content",
        },
      },
      required: ["title", "content"],
      additionalProperties: false,
    },
  },
];
