#!/usr/bin/env node
/**
 * @carbon-cashmere/x402-mcp — MCP server for Carbon & Cashmere paid API
 *
 * Exposes Carbon & Cashmere's 177 crypto market intelligence endpoints
 * as MCP tools. When a tool is invoked from Claude Desktop / Cursor / etc.,
 * the request is sent to api.carbon-cashmere.de. If the endpoint returns
 * HTTP 402 with PAYMENT-REQUIRED header, this server automatically pays
 * with the buyer's wallet (EVM_PRIVATE_KEY or SVM_PRIVATE_KEY env var)
 * via the official x402 v2 protocol, then re-issues the request with
 * PAYMENT-SIGNATURE header and returns the data.
 *
 * Architecture: stdio MCP transport (compatible with Claude Desktop,
 * Cursor, Cline, Continue, Cody). The server itself never holds funds —
 * payment is per-call from the buyer's wallet.
 *
 * Env vars required:
 *   EVM_PRIVATE_KEY  — 0x-prefixed hex private key for Base/Polygon/
 *                      Arbitrum payments. Wallet needs USDC balance.
 *   SVM_PRIVATE_KEY  — base58-encoded Solana keypair (optional; required
 *                      only if a Solana endpoint is invoked).
 *
 * Env vars optional:
 *   X402_API_BASE    — defaults to https://api.carbon-cashmere.de
 *   X402_TOOL_LIMIT  — cap MCP tool count (default 50, max 177).
 *                      Limit recommended because too many tools degrade
 *                      Claude's tool-selection accuracy.
 *   X402_LOG_LEVEL   — debug | info | warn | error (default info)
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createPaymentClient } from "./payment-client.js";
import { discoverTools, type ToolDef } from "./tools.js";

const API_BASE = process.env.X402_API_BASE ?? "https://api.carbon-cashmere.de";
const TOOL_LIMIT = Math.max(1, Math.min(177, parseInt(process.env.X402_TOOL_LIMIT ?? "50", 10)));
const LOG_LEVEL = process.env.X402_LOG_LEVEL ?? "info";

function log(level: string, ...args: unknown[]) {
  const levels = ["debug", "info", "warn", "error"];
  if (levels.indexOf(level) < levels.indexOf(LOG_LEVEL)) return;
  // MCP stdio uses stdout for protocol — all logs MUST go to stderr.
  process.stderr.write(`[x402-mcp ${level}] ${args.map(String).join(" ")}\n`);
}

async function main(): Promise<void> {
  log("info", `starting | api=${API_BASE} tool_limit=${TOOL_LIMIT}`);

  const api = await createPaymentClient(API_BASE);

  let tools: ToolDef[];
  try {
    tools = await discoverTools(API_BASE, TOOL_LIMIT);
    log("info", `discovered ${tools.length} tools`);
  } catch (err) {
    log("error", `endpoint discovery failed: ${(err as Error).message}`);
    tools = [];
  }

  const server = new Server(
    { name: "carbon-cashmere-x402", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = tools.find((t) => t.name === name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    let path = tool.path;
    const queryParams: Record<string, string> = {};
    for (const [k, v] of Object.entries(args ?? {})) {
      const placeholder = `{${k}}`;
      if (path.includes(placeholder)) {
        path = path.replace(placeholder, encodeURIComponent(String(v)));
      } else {
        queryParams[k] = String(v);
      }
    }

    log("debug", `tool=${name} path=${path} query=${JSON.stringify(queryParams)}`);

    try {
      const response = await api.request({
        method: tool.method,
        url: path,
        params: queryParams,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
      };
    } catch (err) {
      const e = err as { message: string; response?: { status?: number; data?: unknown } };
      log("warn", `tool=${name} failed: ${e.message}`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { error: e.message, status: e.response?.status, detail: e.response?.data },
              null,
              2,
            ),
          },
        ],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("info", "ready (stdio)");
}

main().catch((err) => {
  process.stderr.write(`[x402-mcp fatal] ${(err as Error).message}\n`);
  process.exit(1);
});
