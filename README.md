# @carbon-cashmere/x402-mcp

MCP server that exposes [Carbon & Cashmere's](https://api.carbon-cashmere.de) 177 crypto market intelligence endpoints to your AI agent — with **automatic x402 USDC micropayments** from your wallet.

## What you get

When this MCP is installed, your AI agent can call tools like:

- `get_v1_news` — analyzed crypto news with sentiment + market impact
- `get_v1_stablecoins` — total market cap, per-coin supply, chain distribution
- `get_v1_onchain_btc` — Bitcoin on-chain metrics (hash-rate, mempool, miner flows)
- `get_v1_bittensor_leaderboard` — top-100 Bittensor miners by emission
- `get_v1_mantis_realized_accuracy` — MANTIS subnet (UID 253) realized accuracy track-record
- `get_v1_intel_snapshot` — aggregated market intel snapshot
- … plus subscriptions ($10/day, $50/week, $200/month), sponsor tiers ($500–$50000), and 170+ research endpoints priced **$0.003 – $0.50 per call**

**177 paid endpoints total.** Default exposes top 100 (curated by revenue + popularity). Set `X402_TOOL_LIMIT=177` to expose all incl. per-coin variants.

Each tool invocation triggers a single USDC micropayment from your configured wallet. No subscription. No API key. Pay only for what you use.

## Install

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "carbon-cashmere": {
      "command": "npx",
      "args": ["-y", "@carbon-cashmere/x402-mcp"],
      "env": {
        "EVM_PRIVATE_KEY": "0x_your_evm_private_key_here",
        "SVM_PRIVATE_KEY": "your_base58_solana_private_key_here_optional"
      }
    }
  }
}
```

Restart Claude Desktop. The top 100 Carbon & Cashmere tools (curated by revenue + popularity) appear in your tool palette.

### Cursor / Cline / Continue

Same JSON config, paste into your MCP settings panel.

## Wallet setup

> **Security: use a dedicated spending wallet, not your main wallet.**
> Your `EVM_PRIVATE_KEY` sits in plaintext in your Claude Desktop config. Any
> process on the host with read access to that file gets the key. Treat it as
> a hot wallet you would not mind losing: fund it with the small amount you
> plan to spend ($10–$50 in USDC), never with your main holdings.

- **EVM_PRIVATE_KEY** (required for Base / Polygon / Arbitrum / World / Avalanche payments)
  - 0x-prefixed hex string (e.g. `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`)
  - Fund with USDC on Base mainnet (cheapest, fastest, ~$0.0001 gas per call)
  - One-time cost: ~$10 USDC covers 200+ tool calls
  - **Hard cap = wallet balance.** A runaway agent loop can spend the funded
    amount but no more; signing is bounded by USDC available on the chain.
- **SVM_PRIVATE_KEY** (optional, for Solana payments)
  - base58-encoded Solana keypair bytes
  - Only needed if a tool routes Solana-only

**Network whitelist.** The MCP server only signs payments for networks that
appear in the API's 402-response `accepts[]` array (currently Base, Polygon,
Arbitrum, World Chain, Solana, Algorand, Stellar). Requests routed to any
other chain are rejected at the signing layer — your key cannot be tricked
into signing for an arbitrary network.

**Keys never leave your machine.** They live only in your Claude Desktop
config and the MCP process running locally. Payment signing happens on your
device; only the signed EIP-712 / SIWS payload travels to Carbon & Cashmere.

### Discovery-only mode (no keys set)

If you start the MCP server without `EVM_PRIVATE_KEY` and without
`SVM_PRIVATE_KEY`, it runs in **discovery-only mode**: tool registration
works, free endpoints work, paid tool invocations surface a 402 error to the
agent. Useful for: evaluating the tool catalog, MCP marketplace introspection
(Glama, npm scrapers), or running in a CI/test environment without funding
a wallet.

## How it works

```
Claude Desktop          @carbon-cashmere/x402-mcp        api.carbon-cashmere.de
     |                          (your machine)                 (our server)
     |  call get_v1_news        |                                 |
     |------------------------->|  GET /v1/news                   |
     |                          |-------------------------------->|
     |                          |  402 + PAYMENT-REQUIRED         |
     |                          |<--------------------------------|
     |                          |  sign with EVM_PRIVATE_KEY      |
     |                          |  GET /v1/news + PAYMENT-SIG     |
     |                          |-------------------------------->|
     |                          |  200 OK + data                  |
     |                          |<--------------------------------|
     |  formatted data          |                                 |
     |<-------------------------|                                 |
```

Built on official Coinbase x402 v2 protocol. Settlement happens on Base USDC (or your chosen chain). Typical latency: ~2-3 seconds per call (one-shot payment + data).

## Tool count

By default, the top 100 tools are exposed — curated server-side by a scoring
that combines actual settlement volume, USD revenue, exploration weighting,
and description quality (the catalog re-ranks without requiring an npm
re-publish).

| `X402_TOOL_LIMIT` | What you get |
|---|---|
| `50` | Minimal footprint — top free + bundles + a few high-revenue endpoints |
| `100` (default) | High-revenue tier — adds $10–$50 subscriptions, sponsor tiers, weekly/daily reports, on-chain bundles |
| `177` | Everything — adds per-coin specialized routes (vol-regime/{coin}, hurst/{coin}, trend/{coin}, …). Recommended only when your agent knows which coin to query. |

Override:
```json
"env": {
  "X402_TOOL_LIMIT": "177"
}
```

Why a default cap: too many MCP tools can degrade an agent's tool-selection
accuracy. 100 is the empirical sweet spot for Claude 3.5 Sonnet and newer.

## Configuration env

| Variable | Required | Default | Description |
|---|---|---|---|
| `EVM_PRIVATE_KEY` | one of | — | 0x-prefixed EVM key for Base/Polygon/Arbitrum |
| `SVM_PRIVATE_KEY` | one of | — | base58 Solana keypair |
| `X402_API_BASE` | no | `https://api.carbon-cashmere.de` | API base URL |
| `X402_TOOL_LIMIT` | no | `100` | Max tools exposed (1-177) |
| `X402_LOG_LEVEL` | no | `info` | `debug \| info \| warn \| error` |

## Security

- **Keys never leave your machine.** The MCP server runs locally as a child process of Claude Desktop.
- **Pay-per-call cap.** Each call costs $0.003–$0.50. Even a runaway loop is bounded by wallet balance.
- **No off-chain credentials.** No API keys. No OAuth. Pure on-chain settlement.
- **Open source.** Audit the code yourself: [github.com/CarbonCashmere/x402-mcp](https://github.com/CarbonCashmere/x402-mcp)

## License

MIT — see [LICENSE](./LICENSE).

## Links

- Carbon & Cashmere API: <https://api.carbon-cashmere.de>
- x402 protocol: <https://github.com/coinbase/x402>
- MCP protocol: <https://modelcontextprotocol.io>
