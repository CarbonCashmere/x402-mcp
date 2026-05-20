/**
 * Payment-aware HTTP client using the official @x402/axios wrapper.
 *
 * The client wraps a standard axios instance with logic that:
 *  1. Sends the request normally
 *  2. If the response is HTTP 402 with PAYMENT-REQUIRED header, parses
 *     the payment requirements (accepts[]), selects a matching scheme
 *     (EVM exact or SVM exact), signs the payment payload with the
 *     buyer's wallet, and retries the request with PAYMENT-SIGNATURE
 *  3. Returns the data once payment is settled
 *
 * The buyer holds the keys; we never see them server-side. Keys come
 * from EVM_PRIVATE_KEY (0x...) and SVM_PRIVATE_KEY (base58) env vars.
 *
 * If no keys are set, the client still starts in DISCOVERY-ONLY mode:
 * tools/list works, free endpoints work, paid tools surface a 402 to
 * the agent at invocation time. This lets marketplaces (Glama, MCP
 * directories) introspect the server's tool catalog without funding
 * a wallet.
 */
import axios, { type AxiosInstance } from "axios";
import { x402Client, wrapAxiosWithPayment } from "@x402/axios";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { registerExactSvmScheme } from "@x402/svm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { base58 } from "@scure/base";

export async function createPaymentClient(baseURL: string): Promise<AxiosInstance> {
  const evmPrivateKey = process.env.EVM_PRIVATE_KEY as `0x${string}` | undefined;
  const svmPrivateKey = process.env.SVM_PRIVATE_KEY;

  const plain = axios.create({ baseURL, timeout: 60_000 });

  if (!evmPrivateKey && !svmPrivateKey) {
    process.stderr.write(
      "[x402-mcp warn] No EVM_PRIVATE_KEY or SVM_PRIVATE_KEY set — running in " +
        "discovery-only mode. Free endpoints work; paid endpoints return 402 to " +
        "the agent. Set EVM_PRIVATE_KEY (0x-hex) or SVM_PRIVATE_KEY (base58) to " +
        "enable automatic micropayments.\n",
    );
    return plain;
  }

  const client = new x402Client();

  if (evmPrivateKey) {
    const evmSigner = privateKeyToAccount(evmPrivateKey);
    registerExactEvmScheme(client, { signer: evmSigner });
  }

  if (svmPrivateKey) {
    const svmSigner = await createKeyPairSignerFromBytes(base58.decode(svmPrivateKey));
    registerExactSvmScheme(client, { signer: svmSigner });
  }

  return wrapAxiosWithPayment(plain, client);
}
