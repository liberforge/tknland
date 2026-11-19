/**
 * Base Sepolia on-chain helpers matching tkn.land contracts / gas-pack flow.
 */
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  formatEther,
  formatUnits,
  http,
  maxUint256,
  parseEther,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

export const PENMT_TOKEN_ADDRESS =
  "0x862a1226E6EA04E34EA3ddB4346C7a2c693E06aB";
export const GAS_PACK_CONTRACT_ADDRESS =
  "0x84c64fBe60a4a733829d333Ed17e99e4f02eFB06";
export const PACK_FLOOR = parseEther("0.000008");
export const TERMINAL_SENDER_MIN = parseEther("0.000022");

const gasPackAbi = [
  {
    type: "function",
    name: "packPrice",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "buyGasPack",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
];

export function normalizePrivateKey(raw) {
  const v = String(raw ?? "").trim();
  if (!v) throw new Error("private key is empty");
  return (v.startsWith("0x") ? v : `0x${v}`);
}

export function createClients(rpcUrl, privateKey) {
  const account = privateKeyToAccount(normalizePrivateKey(privateKey));
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport,
  });
  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport,
  });
  return { account, publicClient, walletClient };
}

export async function getPenmtBalance(publicClient, address) {
  return publicClient.readContract({
    address: PENMT_TOKEN_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
  });
}

export async function getPenmtDecimals(publicClient) {
  return publicClient.readContract({
    address: PENMT_TOKEN_ADDRESS,
    abi: erc20Abi,
    functionName: "decimals",
  });
}

export async function getPackPrice(publicClient) {
  const price = await publicClient.readContract({
    address: GAS_PACK_CONTRACT_ADDRESS,
    abi: gasPackAbi,
    functionName: "packPrice",
    args: [PENMT_TOKEN_ADDRESS],
  });
  return price > 0n ? price : 1_000_000n;
}

export function majorToPenmtRaw(major, decimals) {
  return parseUnits(String(major), decimals);
}

export async function waitHash(publicClient, hash) {
  await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
}

/** Send ETH to `to`, leaving at most `leaveWei` on sender (minus gas buffer). */
export async function drainEthTo(input) {
  const { publicClient, walletClient, account, to, leaveWei = PACK_FLOOR } = input;
  const balance = await publicClient.getBalance({ address: account.address });
  if (balance <= leaveWei) {
    return {
      skipped: true,
      balance,
      note: `sender ETH ${formatEther(balance)} already <= leave`,
    };
  }
  // Keep leaveWei + rough gas reserve for this tx
  const gasReserve = parseEther("0.000002");
  const sendValue = balance - leaveWei - gasReserve;
  if (sendValue <= 0n) {
    return { skipped: true, balance, note: "not enough headroom after gas reserve" };
  }
  const hash = await walletClient.sendTransaction({
    account,
    chain: baseSepolia,
    to,
    value: sendValue,
  });
  await waitHash(publicClient, hash);
  const after = await publicClient.getBalance({ address: account.address });
  return { skipped: false, hash, sent: sendValue, balanceAfter: after };
}

/**
 * buyGasPack (reload) then ERC-20 transfer — mirrors reload + send journey.
 */
export async function buyPackThenTransfer(input) {
  const {
    publicClient,
    walletClient,
    account,
    receiver,
    amountMajor,
  } = input;

  const decimals = await getPenmtDecimals(publicClient);
  const principalRaw = majorToPenmtRaw(amountMajor, Number(decimals));
  const packPrice = await getPackPrice(publicClient);
  const balance = await getPenmtBalance(publicClient, account.address);
  if (balance < principalRaw + packPrice) {
    throw new Error(
      `Need ${formatUnits(principalRaw + packPrice, decimals)} PENMT for pack+send; have ${formatUnits(balance, decimals)}`,
    );
  }

  const allowance = await publicClient.readContract({
    address: PENMT_TOKEN_ADDRESS,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account.address, GAS_PACK_CONTRACT_ADDRESS],
  });

  let approveTxHash = null;
  if (allowance < packPrice) {
    if (allowance > 0n) {
      const clearHash = await walletClient.writeContract({
        address: PENMT_TOKEN_ADDRESS,
        abi: erc20Abi,
        functionName: "approve",
        args: [GAS_PACK_CONTRACT_ADDRESS, 0n],
        account,
        chain: baseSepolia,
      });
      await waitHash(publicClient, clearHash);
    }
    approveTxHash = await walletClient.writeContract({
      address: PENMT_TOKEN_ADDRESS,
      abi: erc20Abi,
      functionName: "approve",
      args: [GAS_PACK_CONTRACT_ADDRESS, maxUint256],
      account,
      chain: baseSepolia,
    });
    await waitHash(publicClient, approveTxHash);
  }

  const feeTxHash = await walletClient.writeContract({
    address: GAS_PACK_CONTRACT_ADDRESS,
    abi: gasPackAbi,
    functionName: "buyGasPack",
    args: [PENMT_TOKEN_ADDRESS, packPrice],
    account,
    chain: baseSepolia,
  });
  await waitHash(publicClient, feeTxHash);

  const transferTxHash = await walletClient.writeContract({
    address: PENMT_TOKEN_ADDRESS,
    abi: erc20Abi,
    functionName: "transfer",
    args: [receiver, principalRaw],
    account,
    chain: baseSepolia,
  });
  await waitHash(publicClient, transferTxHash);

  return { approveTxHash, feeTxHash, transferTxHash, principalRaw, packPrice };
}

/** Plain PENMT transfer (no pack). Buys pack first only if sender ETH < PACK_FLOOR. */
export async function sendPenmt(input) {
  const { publicClient, walletClient, account, receiver, amountMajor } = input;
  const eth = await publicClient.getBalance({ address: account.address });
  if (eth < PACK_FLOOR) {
    return buyPackThenTransfer(input);
  }

  const decimals = await getPenmtDecimals(publicClient);
  const principalRaw = majorToPenmtRaw(amountMajor, Number(decimals));
  const balance = await getPenmtBalance(publicClient, account.address);
  if (balance < principalRaw) {
    throw new Error(
      `Need ${formatUnits(principalRaw, decimals)} PENMT; have ${formatUnits(balance, decimals)}`,
    );
  }

  const transferTxHash = await walletClient.writeContract({
    address: PENMT_TOKEN_ADDRESS,
    abi: erc20Abi,
    functionName: "transfer",
    args: [receiver, principalRaw],
    account,
    chain: baseSepolia,
  });
  await waitHash(publicClient, transferTxHash);
  return { approveTxHash: null, feeTxHash: null, transferTxHash, principalRaw, packPrice: 0n };
}
