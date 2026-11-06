export type Address = `0x${string}`;
export type Hex = `0x${string}`;
export type Lang = "en" | "hi" | "mr";
export type RiskLevel = "info" | "low" | "medium" | "high" | "critical";

export const RISK_ORDER: Record<RiskLevel, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

export interface TokenInfo {
  address: Address;
  kind: "erc20" | "erc721" | "erc1155" | "unknown";
  symbol?: string;
  decimals?: number;
  name?: string;
}

/** An ERC-7730 descriptor that the caller has ALREADY verified (its sha256 matches the signed release manifest). */
export interface VerifiedDescriptor {
  chainId: number;
  address: Address;
  descriptor: Record<string, unknown>;
}

export interface DecodeContext {
  chainId: number;
  from?: Address;
  /** Origin of the page that asked for the signature, e.g. https://app.example.com */
  origin?: string;
  nativeSymbol?: string;
  tokenInfo?: (address: Address) => Promise<TokenInfo | null>;
  isContract?: (address: Address) => Promise<boolean | null>;
  descriptors?: VerifiedDescriptor[];
  /** Lowercase address -> human label (e.g. from the release manifest's contracts[]). */
  labels?: Record<string, string>;
  /** Unix seconds used for deadline checks (defaults to the wall clock). */
  now?: number;
  /**
   * Token balance of `owner`, for the "large relative to your balance" rule. Callers should only provide it when the
   * read does not leak the user's address to a third party (local chain or Anon-RPC).
   */
  balanceOf?: (token: Address, owner: Address) => Promise<bigint | null>;
  /** The verified release this request is made under (from the signed manifest). Enables the release checks. */
  release?: ReleaseContext;
}

/** What the signed release says about where its contracts live. */
export interface ReleaseContext {
  ensName?: string;
  /** Chains the release's contracts are deployed on. A request for any other chain contradicts the release. */
  chainIds: number[];
  contracts: { address: string; chainId: number; label: string }[];
}

export interface TxRequest {
  from?: string;
  to?: string | null;
  value?: string | bigint | number;
  data?: string;
  input?: string;
  chainId?: string | number;
  authorizationList?: { address?: string; contractAddress?: string; chainId?: string | number; nonce?: string | number }[];
}

export interface TokenRef {
  address: Address;
  symbol: string | null;
  decimals: number | null;
}

export interface DecodedArg {
  name: string;
  type: string;
  value: string;
}

export type Action =
  | { kind: "native-transfer"; to: Address; amount: bigint }
  | { kind: "erc20-transfer"; token: TokenRef; to: Address; amount: bigint }
  | { kind: "erc20-approve"; token: TokenRef; spender: Address; amount: bigint; unlimited: boolean }
  | { kind: "erc20-increase-allowance"; token: TokenRef; spender: Address; amount: bigint; unlimited: boolean }
  | { kind: "token-transfer-from"; token: TokenRef; from: Address; to: Address; amount: bigint }
  | { kind: "nft-transfer"; collection: TokenRef; from: Address; to: Address; tokenId: bigint; amount: bigint | null }
  | { kind: "nft-batch-transfer"; collection: TokenRef; from: Address; to: Address; ids: bigint[]; amounts: bigint[] }
  | { kind: "nft-approve"; collection: TokenRef; spender: Address; tokenId: bigint }
  | { kind: "nft-approval-for-all"; collection: TokenRef; operator: Address; approved: boolean }
  | {
      kind: "permit";
      standard: "eip2612" | "dai" | "permit2-single" | "permit2-batch" | "permit2-transfer" | "permit2-witness-transfer" | "permit2-approve";
      tokens: { token: TokenRef; amount: bigint; unlimited: boolean }[];
      spender: Address;
      /** When the signature (or on-chain approval) stops being usable. null = never. */
      deadline: bigint | null;
      /** Permit2 allowance expiry (details.expiration); null when the standard has none. */
      expiration?: bigint | null;
      /** Chain id named in the EIP-712 domain (null when absent or on-chain). */
      chainId?: number | null;
      onChain: boolean;
    }
  | { kind: "contract-deployment"; bytecodeSize: number; codehash: Hex; value: bigint }
  | { kind: "sign-transaction"; inner: Action }
  | { kind: "delegatecall"; target: Address; dataSize: number }
  | {
      kind: "safe-exec";
      safe: Address;
      target: Address;
      value: bigint;
      operation: number;
      inner: Action | null;
      /** Set when a DELEGATECALL goes into one of Safe's own MultiSend singletons (the standard batching path). */
      multisend?: "call-only" | "full";
    }
  | { kind: "eip7702-authorization"; delegates: Address[] }
  | { kind: "batch"; source: BatchSource; calls: Action[]; targets: (Address | null)[] }
  | {
      kind: "contract-call";
      to: Address;
      label: string | null;
      functionName: string;
      signature: string;
      args: DecodedArg[];
      value: bigint;
      descriptorIntent: string | null;
    }
  | { kind: "siwe"; domain: string; address: string; uri: string | null; chainId: number | null; statement: string | null }
  | { kind: "siwe-invalid"; claimedDomain: string | null; reason: string }
  | { kind: "message"; text: string }
  | { kind: "raw-hash-sign"; hash: Hex }
  | { kind: "eth-sign"; hash: Hex }
  | {
      kind: "unknown";
      subject: "transaction" | "signature";
      /** English, for logs and tests. */
      reason: string;
      /** Catalog key of the reason (translated in every language) and its parameters. */
      reasonKey?: string;
      reasonParams?: Record<string, string>;
      /** true when the input is malformed (not merely unrecognised). */
      malformed?: boolean;
      selector: Hex | null;
      to: Address | null;
      value: bigint;
      /** Extra facts shown to the user, e.g. the EIP-712 domain of unrecognised typed data. */
      facts?: { key: string; params: Record<string, string> }[];
    };

export type BatchSource = "multicall3" | "multicall" | "safe-multisend" | "wallet_sendCalls";

export interface RiskFinding {
  code: RiskCode;
  level: RiskLevel;
  params: Record<string, string>;
}

export type RiskCode =
  | "UNLIMITED_APPROVAL"
  | "UNLIMITED_PERMIT"
  | "OFFCHAIN_PERMIT"
  | "APPROVAL_TO_EOA"
  | "APPROVE_ALL_NFTS"
  | "SAFE_DELEGATECALL"
  | "EIP7702_DELEGATION"
  | "ETH_SIGN"
  | "RAW_HASH_SIGNATURE"
  | "SIWE_DOMAIN_MISMATCH"
  | "UNKNOWN_ACTION"
  | "UNPARSED_BATCH"
  | "TRANSFER_TO_TOKEN_CONTRACT"
  | "REVOKE"
  | "LARGE_APPROVAL"
  | "LONG_DEADLINE"
  | "EXPIRED_PERMIT"
  | "SPENDER_NOT_IN_RELEASE"
  | "RECIPIENT_NOT_IN_RELEASE"
  | "CALL_TARGET_NOT_IN_RELEASE"
  | "WRONG_CHAIN"
  | "TYPED_DATA_CHAIN_MISMATCH"
  | "SIWE_URI_MISMATCH"
  | "SIWE_ADDRESS_MISMATCH"
  | "SIWE_MALFORMED"
  | "CONTRACT_DEPLOYMENT"
  | "SIGN_ONLY_TRANSACTION"
  | "MALFORMED_REQUEST";

export interface Assessment {
  level: RiskLevel;
  findings: RiskFinding[];
}

export interface Explanation {
  lang: Lang;
  headline: string;
  details: string[];
  risks: { level: RiskLevel; code: RiskCode; text: string }[];
  level: RiskLevel;
}
