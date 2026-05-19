/**
 * Auto-discover Carbon & Cashmere paid endpoints and emit MCP tool definitions.
 *
 * Strategy:
 *  1. Fetch /openapi.json from the live API
 *  2. Filter to paths returning 402 by default (paid endpoints)
 *  3. For each path x method, emit a ToolDef with:
 *       - name: snake_case path-based ID (MCP tool names must match
 *               [a-zA-Z0-9_-]+)
 *       - description: from OpenAPI description field
 *       - inputSchema: from OpenAPI path/query parameters
 *       - path/method: for the runtime request
 *  4. Cap to TOOL_LIMIT (default 50) - too many tools degrade
 *     Claude's tool-selection accuracy. Priority sort by: route has
 *     no path params (simpler tools first) > shorter path (top-level
 *     endpoints win) > alphabetical.
 *
 * Why discover at runtime rather than bake-in:
 *  - Our route list churns (177 today, growing). Bake-in would require
 *    a new npm publish per route addition.
 *  - The openapi.json materializes per-coin variants (BTC/ETH/SOL) so
 *    Claude sees concrete URLs not {coin} placeholders.
 */
import axios from "axios";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
  path: string;
  method: "GET" | "POST" | "DELETE" | "HEAD";
}

interface OpenApiParam {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  description?: string;
  required?: boolean;
  schema?: { type?: string };
}

interface OpenApiOperation {
  summary?: string;
  description?: string;
  parameters?: OpenApiParam[];
  responses?: Record<string, unknown>;
}

interface OpenApiPath {
  get?: OpenApiOperation;
  post?: OpenApiOperation;
  delete?: OpenApiOperation;
  head?: OpenApiOperation;
}

function pathToToolName(method: string, path: string): string {
  const cleaned = path
    .replace(/^\//, "")
    .replace(/\{([a-zA-Z0-9_]+)\}/g, "$1")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return `${method.toLowerCase()}_${cleaned}`.slice(0, 64);
}

function buildInputSchema(params: OpenApiParam[] | undefined): ToolDef["inputSchema"] {
  const schema: ToolDef["inputSchema"] = { type: "object", properties: {} };
  const required: string[] = [];
  for (const p of params ?? []) {
    if (p.in !== "path" && p.in !== "query") continue;
    schema.properties[p.name] = {
      type: p.schema?.type ?? "string",
      description: p.description ?? `${p.in} parameter ${p.name}`,
    };
    if (p.required) required.push(p.name);
  }
  if (required.length) schema.required = required;
  return schema;
}

function priorityScore(path: string, hasPathParam: boolean): number {
  let score = path.length;
  if (hasPathParam) score += 1000;
  return score;
}

interface EndpointEntry {
  path: string;
  method: string;
  price?: string;
  description?: string;
  agentkit_free_trial?: number;
}

interface EndpointsResponse {
  categories?: Record<string, { description?: string; endpoints?: EndpointEntry[] }>;
}

interface CuratedEndpoint {
  tool_name: string;
  path: string;
  method: string;
  price?: string;
  description?: string;
  category?: string;
  tags?: string[];
  score?: number;
}

interface CuratedResponse {
  endpoints?: CuratedEndpoint[];
}

const SKIP_CATEGORIES = new Set(["free"]);

function inferParamsFromPath(path: string): OpenApiParam[] {
  const params: OpenApiParam[] = [];
  const regex = /(\{([a-zA-Z0-9_]+)\}|:([a-zA-Z0-9_]+))/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(path)) !== null) {
    const name = match[2] || match[3];
    if (!name) continue;
    params.push({
      name,
      in: "path",
      required: true,
      description: `Path parameter ${name} (e.g. BTC, ETH, SOL, or other supported identifier)`,
      schema: { type: "string" },
    });
  }
  return params;
}

function normalizePath(path: string): string {
  // Convert :coin / :netuid style placeholders to {coin} / {netuid}
  return path.replace(/:([a-zA-Z0-9_]+)/g, "{$1}");
}

/**
 * Primary discovery path: server-side curated endpoint that returns the
 * data-driven top-N paid routes ranked by real settlement velocity.
 * See api/routes/curated_mcp.py — handles all 177 routes, not just the
 * 104 in the public /v1/endpoints catalog.
 */
async function discoverFromCurated(baseURL: string, limit: number): Promise<ToolDef[]> {
  const url = `${baseURL}/v1/endpoints/curated-mcp?limit=${limit}`;
  const res = await axios.get(url, { timeout: 30_000 });
  const data = res.data as CuratedResponse;
  const eps = data.endpoints ?? [];
  if (!eps.length) throw new Error("curated-mcp returned 0 endpoints");
  const out: ToolDef[] = [];
  for (const ep of eps) {
    const method = (ep.method ?? "GET").toUpperCase() as ToolDef["method"];
    if (method !== "GET" && method !== "POST" && method !== "HEAD" && method !== "DELETE") continue;
    const normalizedPath = normalizePath(ep.path);
    const descParts = [
      ep.description ?? "",
      ep.price ? `Price: ${ep.price}.` : "",
      ep.category ? `Category: ${ep.category}.` : "",
    ].filter(Boolean);
    const description = descParts.join(" ").slice(0, 1024) || `${method} ${ep.path}`;
    out.push({
      name: ep.tool_name || pathToToolName(method, ep.path),
      description,
      inputSchema: buildInputSchema(inferParamsFromPath(normalizedPath)),
      path: normalizedPath,
      method,
    });
  }
  return out;
}

/**
 * Fallback: legacy /v1/endpoints catalog discovery. Used when curated-mcp
 * is unavailable (server downgraded, network issue). Returns at most 104
 * endpoints from the hand-curated catalog.
 */
async function discoverFromCatalog(baseURL: string, limit: number): Promise<ToolDef[]> {
  const res = await axios.get(`${baseURL}/v1/endpoints`, { timeout: 30_000 });
  const data = res.data as EndpointsResponse;
  const categories = data.categories ?? {};

  const candidates: ToolDef[] = [];

  for (const [catName, payload] of Object.entries(categories)) {
    if (SKIP_CATEGORIES.has(catName)) continue;
    const endpoints = payload.endpoints ?? [];
    for (const ep of endpoints) {
      const method = (ep.method ?? "GET").toUpperCase() as ToolDef["method"];
      if (method !== "GET" && method !== "POST" && method !== "HEAD" && method !== "DELETE") continue;
      const normalizedPath = normalizePath(ep.path);
      const descParts = [ep.description ?? "", ep.price ? `Price: ${ep.price}.` : ""].filter(Boolean);
      const description = descParts.join(" ").slice(0, 1024) || `${method} ${ep.path}`;
      candidates.push({
        name: pathToToolName(method, normalizedPath),
        description,
        inputSchema: buildInputSchema(inferParamsFromPath(normalizedPath)),
        path: normalizedPath,
        method,
      });
    }
  }

  candidates.sort(
    (a, b) =>
      priorityScore(a.path, /\{/.test(a.path)) - priorityScore(b.path, /\{/.test(b.path)),
  );

  const seen = new Set<string>();
  const deduped = candidates.filter((t) => {
    if (seen.has(t.name)) return false;
    seen.add(t.name);
    return true;
  });

  return deduped.slice(0, limit);
}

export async function discoverTools(baseURL: string, limit: number): Promise<ToolDef[]> {
  // Try data-driven curated endpoint first (returns highest-converting tools
  // including hidden premium-priced ones). Fall back to legacy catalog if
  // unavailable.
  try {
    return await discoverFromCurated(baseURL, limit);
  } catch (err) {
    const msg = (err as Error).message || String(err);
    process.stderr.write(
      `[x402-mcp warn] curated-mcp discovery failed (${msg}), falling back to /v1/endpoints catalog\n`,
    );
    return discoverFromCatalog(baseURL, limit);
  }
}
