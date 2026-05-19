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
- … 170+ more, priced **$0.003 – $0.50 per call**

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

Restart Claude Desktop. The 50 most useful Carbon & Cashmere tools will appear in your tool palette.

### Cursor / Cline / Continue

Same JSON config, paste into your MCP settings panel.

## Wallet setup

- **EVM_PRIVATE_KEY** (required for Base / Polygon / Arbitrum payments)
  - 0x-prefixed hex string (e.g. `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`)
  - Fund with USDC on Base mainnet (cheapest, fastest)
  - One-time cost: ~$10 USDC covers 200+ tool calls
- **SVM_PRIVATE_KEY** (optional, for Solana payments)
  - base58-encoded Solana keypair bytes
  - Only needed if a tool routes Solana-only

We never see your keys. They live only in your Claude Desktop config and the MCP process running on your machine. Payment signing happens locally; only the signed payload travels to Carbon & Cashmere.

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

By default, the 50 highest-priority tools are exposed (path-param-free routes first, then shorter paths). Override with `X402_TOOL_LIMIT`:

```json
"env": {
  "X402_TOOL_LIMIT": "20"
}
```

Why limit: too many MCP tools degrade Claude's tool-selection accuracy. We curate to highest-utility ones.

## Configuration env

| Variable | Required | Default | Description |
|---|---|---|---|
| `EVM_PRIVATE_KEY` | one of | — | 0x-prefixed EVM key for Base/Polygon/Arbitrum |
| `SVM_PRIVATE_KEY` | one of | — | base58 Solana keypair |
| `X402_API_BASE` | no | `https://api.carbon-cashmere.de` | API base URL |
| `X402_TOOL_LIMIT` | no | `50` | Max tools exposed (1-177) |
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
