/**
 * Direct DataHub GraphQL client — calls GMS API directly over HTTP.
 * Replaces the uvx mcp-server-datahub dependency (which is slow to spawn
 * and requires Python + network to install).
 *
 * Supports both local Docker GMS and DataHub Cloud managed endpoints.
 */

// ─── Shared Utilities ──────────────────────────────────────────────────────

/**
 * Split a comma-separated list of DataHub URNs.
 * URNs contain commas inside parentheses (e.g. urn:li:dataset:(...,...,...))
 * so naive split(",") breaks them. This respects paren nesting depth.
 */
function splitUrns(s: string): string[] {
  const urns: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      urns.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) urns.push(current.trim());
  return urns;
}

const DATAHUB_GMS_URL = process.env.DATAHUB_GMS_URL ?? "http://localhost:8080";
const DATAHUB_GMS_TOKEN = process.env.DATAHUB_GMS_TOKEN ?? "";

interface GqlResponse<T = Record<string, unknown>> {
  data?: T;
  errors?: Array<{ message: string; path?: string[] }>;
}

async function gql<T = Record<string, unknown>>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (DATAHUB_GMS_TOKEN) {
    headers["Authorization"] = `Bearer ${DATAHUB_GMS_TOKEN}`;
  }

  const res = await fetch(`${DATAHUB_GMS_URL}/api/graphql`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DataHub GMS HTTP ${res.status}: ${text.slice(0, 500)}`);
  }

  const json: GqlResponse<T> = await res.json();
  if (json.errors?.length) {
    const msgs = json.errors.map((e) => e.message).join("; ");
    throw new Error(`DataHub GraphQL error: ${msgs}`);
  }
  return json.data as T;
}

// ─── Tool Implementations ─────────────────────────────────────────────────

/**
 * dh_search — Search across entities (datasets, dashboards, etc.)
 */
export async function dhSearch(args: {
  query: string;
  entity_types?: string;
  limit?: number;
}): Promise<string> {
  const types = args.entity_types
    ? args.entity_types.split(",").map((t) => t.trim().toUpperCase())
    : ["DATASET", "DASHBOARD", "CHART", "DATA_FLOW", "DATA_JOB"];

  const data = await gql<{
    searchAcrossEntities: {
      count: number;
      searchResults: Array<{
        entity: Record<string, unknown> & {
          urn: string;
          type: string;
        };
      }>;
    };
  }>(
    `query Search($input: SearchAcrossEntitiesInput!) {
      searchAcrossEntities(input: $input) {
        count
        searchResults {
          entity {
            urn
            type
            ... on Dataset {
              name
              properties { description }
              platform { name }
              tags { tags { tag { name } } }
            }
          }
        }
      }
    }`,
    {
      input: {
        query: args.query,
        types,
        start: 0,
        count: args.limit ?? 10,
      },
    }
  );

  const results = data.searchAcrossEntities;
  if (!results.searchResults.length) {
    return JSON.stringify({ results: [], total: 0 });
  }

  const mapped = results.searchResults.map((r) => {
    const e = r.entity;
    const name = (e as Record<string, unknown>).name as string | undefined;
    const tags = (e as Record<string, unknown>).tags as { tags: Array<{ tag: { name: string } }> } | undefined;
    const platform = (e as Record<string, unknown>).platform as { name: string } | undefined;
    return {
      urn: e.urn,
      type: e.type,
      name: name ?? e.urn.split(":").pop(),
      platform: platform?.name ?? "unknown",
      tags: tags?.tags.map((t) => t.tag.name) ?? [],
    };
  });

  return JSON.stringify({ total: results.count, results: mapped }, null, 2);
}

/**
 * dh_get_entities — Get detailed info for specific entity URNs
 */
export async function dhGetEntities(args: {
  urns: string;
}): Promise<string> {
  // Smart split: URNs contain commas inside parens
  const urns = splitUrns(args.urns);
  
  // Use singular entity query to avoid comma-in-URN parsing issues
  const results: Array<Record<string, unknown> | null> = [];
  for (const urn of urns) {
    const data = await gql<{
      entity: Record<string, unknown> | null;
    }>(
      `query GetEntity($urn: String!) {
        entity(urn: $urn) {
          urn
          type
          ... on Dataset {
            name
            properties { description externalUrl }
            platform { name }
            schemaMetadata {
              name
              fields { fieldPath nativeDataType description tags { tags { tag { name } } } }
            }
            tags { tags { tag { name } } }
            ownership { owners { associatedUrn } }
          }
        }
      }`,
      { urn }
    );
    results.push(data.entity);
  }

  const entities = results.filter(Boolean).map((e) => {
    const rec = e as Record<string, unknown>;
    const props = rec.properties as { description?: string; externalUrl?: string } | undefined;
    const platform = rec.platform as { name: string } | undefined;
    const schemaMeta = rec.schemaMetadata as { fields?: Array<{ fieldPath: string; nativeDataType?: string; description?: string; tags?: { tags: Array<{ tag: { name: string } }> } }> } | undefined;
    const tagsObj = rec.tags as { tags: Array<{ tag: { name: string } }> } | undefined;
    const ownership = rec.ownership as { owners: Array<{ associatedUrn: string }> } | undefined;
    return {
      urn: rec.urn as string,
      type: rec.type as string,
      name: rec.name as string | undefined,
      description: props?.description,
      platform: platform?.name,
      schema: schemaMeta?.fields?.map((f) => ({
        path: f.fieldPath,
        type: f.nativeDataType,
        description: f.description,
        tags: f.tags?.tags.map((t) => t.tag.name) ?? [],
      })),
      tags: tagsObj?.tags.map((t) => t.tag.name) ?? [],
      owners: ownership?.owners?.map((o) => o.associatedUrn) ?? [],
    };
  });

  return JSON.stringify(results, null, 2);
}

/**
 * dh_list_schema — Get schema fields for a dataset
 */
export async function dhListSchema(args: {
  urn: string;
}): Promise<string> {
  const data = await gql<{
    dataset: {
      name: string;
      platform: { name: string };
      schemaMetadata: {
        name?: string;
        fields: Array<{
          fieldPath: string;
          type?: string;
          nativeDataType?: string;
          description?: string;
          nullable?: boolean;
          isPartOfKey?: boolean;
          tags?: { tags: Array<{ tag: { name: string } }> };
          glossaryTerms?: { terms: Array<{ term: { name: string } }> };
        }>;
        primaryKeys?: string[];
      };
    } | null;
  }>(
    `query GetSchema($urn: String!) {
      dataset(urn: $urn) {
        name
        platform { name }
        schemaMetadata {
          name
          fields {
            fieldPath type nativeDataType description nullable isPartOfKey
            tags { tags { tag { name } } }
            glossaryTerms { terms { term { name } } }
          }
        }
      }
    }`,
    { urn: args.urn }
  );

  if (!data.dataset) {
    return JSON.stringify({ error: `Dataset not found: ${args.urn}` });
  }

  const ds = data.dataset;
  const fields = ds.schemaMetadata.fields.map((f) => ({
    path: f.fieldPath,
    type: f.nativeDataType ?? f.type,
    description: f.description,
    nullable: f.nullable,
    isKey: f.isPartOfKey,
    tags: f.tags?.tags.map((t) => t.tag.name) ?? [],
    terms: f.glossaryTerms?.terms.map((t) => t.term.name) ?? [],
  }));

  return JSON.stringify(
    {
      dataset: ds.name,
      platform: ds.platform.name,
      schema: ds.schemaMetadata.name,
      fieldCount: fields.length,
      fields,
    },
    null,
    2
  );
}

/**
 * dh_get_lineage — Get upstream/downstream lineage for an entity
 */
export async function dhGetLineage(args: {
  urn: string;
  direction?: string;
  max_hops?: number;
  start?: number;
  count?: number;
}): Promise<string> {
  const direction = (args.direction ?? "DOWNSTREAM").toUpperCase();
  const start = args.start ?? 0;
  const count = args.count ?? 40;

  // For hop-based lineage, we use searchAcrossLineage for multi-hop
  if (args.max_hops && args.max_hops > 1) {
    const data = await gql<{
      searchAcrossLineage: {
        count: number;
        searchResults: Array<{
          entity: {
            urn: string;
            type: string;
            name?: string;
            platform?: { name: string };
          };
        }>;
      };
    }>(
      `query LineageSearch($input: SearchAcrossLineageInput!) {
        searchAcrossLineage(input: $input) {
          count
          searchResults {
            entity {
              urn type
              ... on Dataset { name platform { name } }
              ... on DataJob { name }
              ... on DataFlow { name platform { name } }
            }
          }
        }
      }`,
      {
        input: {
          query: "",
          urn: args.urn,
          direction: direction === "UPSTREAM" ? "UPSTREAM" : "DOWNSTREAM",
          start,
          count,
        },
      }
    );

    const results = data.searchAcrossLineage;
    const mapped = results.searchResults.map((r) => ({
      urn: r.entity.urn,
      type: r.entity.type,
      name: r.entity.name ?? r.entity.urn.split(":").pop(),
    }));

    return JSON.stringify(
      { direction, total: results.count, relationships: mapped },
      null,
      2
    );
  }

  // Single-hop lineage via dataset.lineage
  const data = await gql<{
    dataset: {
      name: string;
      lineage: {
        total: number;
        count: number;
        relationships: Array<{
          entity: Record<string, unknown> & {
            urn: string;
            type: string;
          };
          degree?: number;
        }>;
      };
    } | null;
  }>(
    `query GetLineage($urn: String!, $input: LineageInput!) {
      dataset(urn: $urn) {
        name
        lineage(input: $input) {
          total count
          relationships {
            entity {
              urn type
              ... on Dataset { name platform { name } }
              ... on DataJob { properties { name } dataFlow { properties { name } } }
              ... on DataFlow { properties { name } platform { name } }
            }
            degree
          }
        }
      }
    }`,
    {
      urn: args.urn,
      input: { direction, start, count },
    }
  );

  if (!data.dataset) {
    return JSON.stringify({ error: `Dataset not found: ${args.urn}` });
  }

  const lin = data.dataset.lineage;
  const mapped = lin.relationships.map((r) => {
    const e = r.entity as Record<string, unknown>;
    let name: string | undefined;
    if (e.type === "DATASET") {
      name = (e as { name?: string }).name;
    } else {
      // DataJob/DataFlow: name is in properties
      const props = e.properties as { name?: string } | undefined;
      name = props?.name;
    }
    return {
      urn: e.urn,
      type: e.type,
      name: name ?? e.urn.split(":").pop(),
      degree: r.degree,
    };
  });

  return JSON.stringify(
    {
      dataset: data.dataset.name,
      direction,
      total: lin.total,
      relationships: mapped,
    },
    null,
    2
  );
}

/**
 * dh_lineage_paths — Get lineage paths between two entities
 */
export async function dhLineagePaths(args: {
  source_urn: string;
  destination_urn: string;
  max_hops?: number;
}): Promise<string> {
  // Use searchAcrossLineage from source, filtering for destination
  const data = await gql<{
    searchAcrossLineage: {
      count: number;
      searchResults: Array<{
        entity: Record<string, unknown> & {
          urn: string;
          type: string;
        };
      }>;
    };
  }>(
    `query LineagePaths($input: SearchAcrossLineageInput!) {
      searchAcrossLineage(input: $input) {
        count
        searchResults {
          entity {
            urn type
            ... on Dataset { name }
            ... on DataJob { properties { name } }
            ... on DataFlow { properties { name } }
          }
        }
      }
    }`,
    {
      input: {
        query: "",
        urn: args.source_urn,
        direction: "DOWNSTREAM",
        start: 0,
        count: 50,
      },
    }
  );

  const allResults = data.searchAcrossLineage.searchResults;
  const reachable = allResults.filter(
    (r) => r.entity.urn === args.destination_urn
  );

  const path = allResults.slice(0, 20).map((r) => {
    const e = r.entity;
    let name: string | undefined;
    if (e.type === "DATASET") {
      name = (e as Record<string, unknown>).name as string | undefined;
    } else {
      const props = (e as Record<string, unknown>).properties as { name?: string } | undefined;
      name = props?.name;
    }
    return {
      urn: e.urn,
      type: e.type,
      name: name ?? e.urn.split(":").pop(),
    };
  });

  return JSON.stringify(
    {
      source: args.source_urn,
      destination: args.destination_urn,
      reachable: reachable.length > 0,
      hopCount: reachable[0]?.entity ? path.length : "not found",
      path,
    },
    null,
    2
  );
}

/**
 * dh_get_queries — Get SQL queries referencing a dataset
 */
export async function dhGetQueries(args: {
  urn: string;
  limit?: number;
}): Promise<string> {
  const data = await gql<{
    dataset: {
      name: string;
      operations?: Array<{
        timestampMillis: number;
        operationType: string;
        actorUrn?: string;
      }>;
    } | null;
  }>(
    `query GetQueries($urn: String!) {
      dataset(urn: $urn) {
        name
        operations {
          timestampMillis
          operationType
          actor
        }
      }
    }`,
    { urn: args.urn }
  );

  if (!data.dataset) {
    return JSON.stringify({ error: `Dataset not found: ${args.urn}` });
  }

  const ops = (data.dataset.operations ?? [])
    .slice(0, args.limit ?? 10)
    .map((op) => ({
      type: op.operationType,
      timestamp: new Date(op.timestampMillis).toISOString(),
      actor: op.actorUrn,
    }));

  return JSON.stringify(
    {
      dataset: data.dataset.name,
      queryCount: ops.length,
      note: "DataHub tracks query-level audit events. Full SQL available via DataHub Ingestion Query Logs.",
      operations: ops,
    },
    null,
    2
  );
}

/**
 * dh_draft_sql — Draft SQL using DataHub context
 */
export async function dhDraftSql(args: {
  tables: string;
  question: string;
}): Promise<string> {
  const urns = splitUrns(args.tables);

  // Fetch schemas for each table
  const data = await gql<{
    entities: Array<{
      urn: string;
      name?: string;
      schemaMetadata?: {
        fields: Array<{
          fieldPath: string;
          nativeDataType?: string;
          description?: string;
        }>;
      };
    } | null>;
  }>(
    `query DraftContext($urns: [String!]!) {
      entities(urns: $urns) {
        urn
        ... on Dataset {
          name
          schemaMetadata {
            fields { fieldPath nativeDataType description }
          }
        }
      }
    }`,
    { urns }
  );

  const tables = data.entities.filter(Boolean).map((e) => {
    const ds = e as { name?: string; schemaMetadata?: { fields: Array<{ fieldPath: string; nativeDataType?: string }> } };
    const tableName = ds.name ?? e!.urn.split("(")[1]?.split(")")[0]?.split(",").pop() ?? "unknown";
    const fields = ds.schemaMetadata?.fields ?? [];
    const cols = fields
      .filter((f) => !f.fieldPath.includes("."))
      .map((f) => `  ${f.fieldPath} ${f.nativeDataType ?? ""}`)
      .join(",\n");
    return `CREATE TABLE ${tableName} (\n${cols}\n);`;
  });

  const schemaBlock = tables.join("\n\n");
  const sqlDraft = `-- SQL draft based on DataHub schema context
-- Question: ${args.question}
-- Tables: ${urns.join(", ")}

${schemaBlock}

-- Draft query for: ${args.question}
SELECT *
FROM ${data.entities[0]?.name ?? "table_1"}
LIMIT 100;`;

  return JSON.stringify(
    {
      question: args.question,
      schemas: tables,
      draft: sqlDraft,
      note: "This is a schema-aware draft. For production SQL generation, integrate with an LLM.",
    },
    null,
    2
  );
}

/**
 * dh_add_tags — Add tags to a DataHub entity
 */
export async function dhAddTags(args: {
  urn: string;
  tags: string;
}): Promise<string> {
  const urn = args.urn;
  const tagNames = args.tags.split(",").map((t) => t.trim());
  const results: Array<{ tag: string; status: string }> = [];

  for (const tagName of tagNames) {
    const tagUrn = `urn:li:tag:${tagName}`;
    try {
      const data = await gql<{ addTag: boolean }>(
        `mutation AddTag($input: TagInput!) { addTag(input: $input) }`,
        { input: { resourceUrn: urn, tagUrn } }
      );
      results.push({
        tag: tagName,
        status: data.addTag ? "added" : "failed",
      });
    } catch (err) {
      // Tag may not exist — try creating it first
      try {
        await gql(
          `mutation CreateTag($input: CreateTagInput!) { createTag(input: $input) }`,
          { input: { name: tagName, description: `Tag: ${tagName}` } }
        );
        const data = await gql<{ addTag: boolean }>(
          `mutation AddTag($input: TagInput!) { addTag(input: $input) }`,
          { input: { resourceUrn: urn, tagUrn } }
        );
        results.push({
          tag: tagName,
          status: data.addTag ? "created and added" : "created but failed to add",
        });
      } catch (createErr) {
        results.push({
          tag: tagName,
          status: `error: ${createErr instanceof Error ? createErr.message : String(createErr)}`,
        });
      }
    }
  }

  return JSON.stringify({ urn, tagResults: results }, null, 2);
}

/**
 * dh_add_terms — Add glossary terms to an entity
 */
export async function dhAddTerms(args: {
  urn: string;
  terms: string;
}): Promise<string> {
  const urn = args.urn;
  const termNames = args.terms.split(",").map((t) => t.trim());
  const results: Array<{ term: string; status: string }> = [];

  for (const termName of termNames) {
    const termUrn = `urn:li:glossaryTerm:${termName}`;
    try {
      const data = await gql<{ addTerms: boolean }>(
        `mutation AddTerms($input: AddTermsInput!) { addTerms(input: $input) }`,
        { input: { resourceUrn: urn, termUrns: [termUrn] } }
      );
      results.push({
        term: termName,
        status: data.addTerms ? "added" : "failed",
      });
    } catch (err) {
      results.push({
        term: termName,
        status: `error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return JSON.stringify({ urn, termResults: results }, null, 2);
}

/**
 * dh_update_desc — Update description of an entity or field
 */
export async function dhUpdateDesc(args: {
  urn: string;
  description: string;
}): Promise<string> {
  try {
    const data = await gql<{ updateDescription: boolean }>(
      `mutation UpdateDesc($input: DescriptionUpdateInput!) {
        updateDescription(input: $input)
      }`,
      {
        input: {
          resourceUrn: args.urn,
          description: args.description || undefined,
        },
      }
    );

    return JSON.stringify(
      {
        urn: args.urn,
        status: data.updateDescription ? "updated" : "failed",
        description: args.description,
      },
      null,
      2
    );
  } catch (err) {
    return JSON.stringify({
      urn: args.urn,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * dh_search_docs — Search DataHub knowledge documents
 */
export async function dhSearchDocs(args: {
  query: string;
  limit?: number;
}): Promise<string> {
  try {
    const data = await gql<{
      searchDocuments: {
        count: number;
        searchResults: Array<{
          entity: {
            urn: string;
            name?: string;
            description?: string;
          };
        }>;
      };
    }>(
      `query SearchDocs($input: SearchDocumentsInput!) {
        searchDocuments(input: $input) {
          count
          searchResults {
            entity {
              urn
              ... on Document {
                name
                description: contents
              }
            }
          }
        }
      }`,
      {
        input: {
          query: args.query,
          start: 0,
          count: args.limit ?? 10,
        },
      }
    );

    const docs = data.searchDocuments;
    return JSON.stringify(
      {
        query: args.query,
        total: docs.count,
        results: docs.searchResults.map((r) => ({
          urn: r.entity.urn,
          name: r.entity.name,
        })),
      },
      null,
      2
    );
  } catch {
    return JSON.stringify({
      query: args.query,
      total: 0,
      results: [],
      note: "Document search requires DataHub Knowledge plugin. Not available in this instance.",
    });
  }
}

/**
 * dh_save_doc — Save a document to DataHub knowledge base
 */
export async function dhSaveDoc(args: {
  title: string;
  content: string;
}): Promise<string> {
  try {
    const data = await gql<{
      createDocument: { urn: string };
    }>(
      `mutation CreateDoc($input: CreateDocumentInput!) {
        createDocument(input: $input)
      }`,
      {
        input: {
          title: args.title,
          contents: args.content,
        },
      }
    );

    return JSON.stringify(
      {
        status: "saved",
        urn: (data as unknown as { createDocument: { urn: string } }).createDocument?.urn,
        title: args.title,
      },
      null,
      2
    );
  } catch (err) {
    return JSON.stringify({
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      title: args.title,
    });
  }
}

// ─── Tool Name → Handler Map ──────────────────────────────────────────────

export type DataHubToolHandler = (
  args: Record<string, unknown>
) => Promise<string>;

const HANDLERS: Record<string, DataHubToolHandler> = {
  dh_search: (args) =>
    dhSearch({
      query: args.query as string,
      entity_types: args.entity_types as string | undefined,
      limit: args.limit as number | undefined,
    }),
  dh_get_entities: (args) =>
    dhGetEntities({ urns: args.urns as string }),
  dh_list_schema: (args) =>
    dhListSchema({ urn: args.urn as string }),
  dh_get_lineage: (args) =>
    dhGetLineage({
      urn: args.urn as string,
      direction: args.direction as string | undefined,
      max_hops: args.max_hops as number | undefined,
      start: args.start as number | undefined,
      count: args.count as number | undefined,
    }),
  dh_lineage_paths: (args) =>
    dhLineagePaths({
      source_urn: args.source_urn as string,
      destination_urn: args.destination_urn as string,
      max_hops: args.max_hops as number | undefined,
    }),
  dh_get_queries: (args) =>
    dhGetQueries({
      urn: args.urn as string,
      limit: args.limit as number | undefined,
    }),
  dh_draft_sql: (args) =>
    dhDraftSql({
      tables: args.tables as string,
      question: args.question as string,
    }),
  dh_add_tags: (args) =>
    dhAddTags({
      urn: args.urn as string,
      tags: args.tags as string,
    }),
  dh_add_terms: (args) =>
    dhAddTerms({
      urn: args.urn as string,
      terms: args.terms as string,
    }),
  dh_update_desc: (args) =>
    dhUpdateDesc({
      urn: args.urn as string,
      description: args.description as string,
    }),
  dh_search_docs: (args) =>
    dhSearchDocs({
      query: args.query as string,
      limit: args.limit as number | undefined,
    }),
  dh_save_doc: (args) =>
    dhSaveDoc({
      title: args.title as string,
      content: args.content as string,
    }),
};

const DATAHUB_TOOL_NAMES = Object.keys(HANDLERS);

/**
 * Execute a DataHub tool via direct GraphQL.
 * Returns the result string, or null if the tool name isn't a DataHub tool.
 */
export async function executeDataHubTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<string | null> {
  const handler = HANDLERS[toolName];
  if (!handler) return null;
  return handler(args);
}

/**
 * Check if a tool name is a DataHub tool handled by this client.
 */
export function isDataHubTool(toolName: string): boolean {
  return DATAHUB_TOOL_NAMES.includes(toolName);
}
