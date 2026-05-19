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
 * At least one of the two MUST be set. If a tool routes to a Solana-only
 * endpoint and only EVM_PRIVATE_KEY is set, the tool call fails cleanly.
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

  if (!evmPrivateKey && !svmPrivateKey) {
    throw new Error(
      "At least one of EVM_PRIVATE_KEY or SVM_PRIVATE_KEY must be set. " +
        "EVM key (0x-prefixed hex) pays via Base/Polygon/Arbitrum; SVM key " +
        "(base58) pays via Solana. Wallet needs USDC balance on the chosen chain.",
    );
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

  return wrapAxiosWithPayment(axios.create({ baseURL, timeout: 60_000 }), client);
}
