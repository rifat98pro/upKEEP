/**
 * Transaction submission for Arc.
 *
 * Every write in the SDK goes through here, for one reason above all:
 *
 *   Arc's mempool **silently drops** transactions whose maxFeePerGas is under
 *   20 Gwei. No receipt, no error, the transaction simply never appears in a
 *   block. A caller who lets a wallet estimate gas can end up waiting forever
 *   for something that was discarded, with nothing anywhere explaining why.
 *
 * So the fee is read live, given headroom, and clamped to the documented floor.
 * https://docs.arc.io/arc/references/gas-and-fees
 */
import type { Abi, Address, Hash } from 'viem';
import { ARC_DEFAULT_PRIORITY_FEE_WEI, ARC_MIN_BASE_FEE_WEI } from './config/chains.js';
import { WalletRequiredError } from './errors.js';
import type { UpkeepContext } from './client.js';

export interface ArcTransactionRequest {
  address: Address;
  abi: Abi | readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
  /** Native USDC to attach, in 18-decimal wei. */
  value?: bigint;
  /** Skip the pre-flight simulation. Not recommended. */
  skipSimulation?: boolean;
}

/**
 * Compute the fee parameters for an Arc transaction.
 *
 * Exported so a caller driving its own wallet UI can apply the same floor.
 */
export async function arcFeeParams(ctx: UpkeepContext): Promise<{
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}> {
  let gasPrice: bigint;
  try {
    gasPrice = await ctx.publicClient.getGasPrice();
  } catch {
    // If the estimate is unavailable, the documented floor is the safe choice.
    gasPrice = ARC_MIN_BASE_FEE_WEI;
  }

  const withHeadroom = (gasPrice * 130n) / 100n;
  const maxFeePerGas = withHeadroom > ARC_MIN_BASE_FEE_WEI ? withHeadroom : ARC_MIN_BASE_FEE_WEI;

  return { maxFeePerGas, maxPriorityFeePerGas: ARC_DEFAULT_PRIORITY_FEE_WEI };
}

/**
 * Simulate, then submit, a contract write on Arc.
 *
 * The simulation is not optional politeness: a revert caught there costs
 * nothing and carries a real reason, whereas the same revert on-chain costs gas
 * and arrives as an opaque receipt.
 */
export async function sendArcTransaction(
  ctx: UpkeepContext,
  request: ArcTransactionRequest,
): Promise<Hash> {
  if (!ctx.walletClient || !ctx.account) {
    throw new WalletRequiredError(request.functionName);
  }

  if (!request.skipSimulation) {
    await ctx.publicClient.simulateContract({
      account: ctx.account,
      address: request.address,
      abi: request.abi as Abi,
      functionName: request.functionName,
      args: request.args as never,
      value: request.value,
    });
  }

  const { maxFeePerGas, maxPriorityFeePerGas } = await arcFeeParams(ctx);

  /*
   * Sign with the wallet client's own account object when it has one.
   *
   * `ctx.account` is an Address *string*, and viem reads a bare string as a
   * JSON-RPC account: "ask the node to sign this", i.e. eth_sendTransaction.
   * That is right for MetaMask, whose account is a JSON-RPC account anyway, and
   * wrong for a local private key - a public RPC holds no unlocked accounts and
   * answers `eth_sendTransaction does not exist`. Passing the string explicitly
   * overrode the local signer the caller had already configured.
   *
   * The wallet client's account carries its own type, so handing it back lets
   * viem choose: sign locally for a private key, delegate for a browser wallet.
   */
  const signer = ctx.walletClient.account ?? ctx.account;

  return ctx.walletClient.writeContract({
    chain: ctx.chain,
    account: signer,
    address: request.address,
    abi: request.abi as Abi,
    functionName: request.functionName,
    args: request.args as never,
    value: request.value,
    maxFeePerGas,
    maxPriorityFeePerGas,
  });
}
