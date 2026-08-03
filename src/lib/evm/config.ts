import { base, baseSepolia } from "viem/chains";

/** FeeContract (CREATE2 salt `fee-LIBERFORGE`) — same address on Base + Base Sepolia. */
export const FEE_CONTRACT_ADDRESS =
  "0x5999EB67702c31aAd7BAA01CA63C2137C84A5376" as const;

/** PENMT ERC-20 (CREATE2) — same address on Base + Base Sepolia. */
export const PENMT_TOKEN_ADDRESS =
  "0x862a1226E6EA04E34EA3ddB4346C7a2c693E06aB" as const;

/** Vite DEV → Base Sepolia; production builds → Base mainnet. */
export const EVM_CHAIN = import.meta.env.DEV ? baseSepolia : base;

export const EVM_CHAIN_ID = EVM_CHAIN.id;
