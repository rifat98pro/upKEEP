# Deploying upKEEP to Arc Mainnet

This is real money on a live chain. Work through it in order and do not skip step 0.

Measured cost for the whole deployment: **~6.12M gas ≈ $0.15 USDC** at Arc's 20–25 Gwei range.
The expensive part of this process is your attention, not the gas.

---

## 0. Validate under Arc's own toolchain

**Do this first.** The test suite in this repo has been run with *upstream* Foundry, which executes
against Ethereum semantics. Arc ships its own fork and warns that upstream
"will run your tests against Ethereum rules while reporting them as passing."

Arc Foundry currently publishes a **Linux x86_64 binary only**. On Windows, use WSL
(`wsl --install`, then reboot).

```bash
curl -LO https://github.com/circlefin/arc-foundry/releases/latest/download/arc-foundry-v0.8.0-2-x86_64-unknown-linux-gnu.tar.gz
curl -LO https://github.com/circlefin/arc-foundry/releases/latest/download/arc-foundry-v0.8.0-2-x86_64-unknown-linux-gnu.tar.gz.sha256
sha256sum -c arc-foundry-v0.8.0-2-x86_64-unknown-linux-gnu.tar.gz.sha256

tar -xzf arc-foundry-v0.8.0-2-x86_64-unknown-linux-gnu.tar.gz
mkdir -p ~/.local/bin
mv forge ~/.local/bin/arc-forge
mv cast  ~/.local/bin/arc-cast
mv anvil ~/.local/bin/arc-anvil
export PATH="$HOME/.local/bin:$PATH"

cd contracts
arc-forge test -vv
```

**All 132 tests must pass here before you continue.** If any fail, that is Arc semantics differing
from Ethereum and it must be understood before deploying, not after.

> **Status: done.** Run on 2026-09-23 under arc-foundry `v0.8.0-2` (forge `1.7.1-dev`, commit
> `d497bee`), tarball checksum verified against Arc's published `.sha256`:
> **132 passed, 0 failed.** Identical to the upstream-Foundry result, so no Arc divergence affects
> these contracts. Re-run this whenever the contracts change.

Arc's divergences that these contracts actually touch:

- value transfers to the zero address revert
- blocklist enforcement consumes gas even when the call reverts
- sends to precompile addresses revert
- native sends emit EIP-7708 `Transfer` logs from a system address

---

## 1. Decide four addresses

| Role | What it is | Advice |
|---|---|---|
| **Deployer** | Signs the deployment. Pays gas. | A fresh key. Fund with ~$2 USDC. |
| **Admin** | Owns the registry and executor. Can register evaluators, set the keeper, trip the circuit breaker. | A multisig if you have one. Defaults to the deployer, which is fine to start. |
| **Treasury** | Receives the 0.05% protocol fee. | A wallet you actually control. Required — the script refuses to run without it. |
| **Keeper** | Submits executions. Pays gas for them. | A **separate** key from the deployer. Hot by necessity. |

The admin cannot reach user funds. Every transfer additionally requires the user's own vault to
have authorized the same executor, so swapping the executor alone moves nothing.

The keeper key is not custody either — vaults authorize the executor *contract*, not the keeper
account. Fund it only with gas.

---

## 2. Fund the deployer with USDC

Gas on Arc is paid in **USDC**, not ETH. A deployer with zero USDC cannot deploy; the script
checks this and stops.

```bash
arc-cast balance <DEPLOYER_ADDRESS> --rpc-url https://rpc.mainnet.arc.io
```

That returns 18-decimal native wei. Divide by 1e18 for dollars. `$2` is ample for deployment plus
a few configuration transactions.

---

## 3. Configure `.env.local`

```bash
cp .env.example .env.local
```

Fill in:

```bash
DEPLOYER_PRIVATE_KEY=0x...      # never commit this
UPKEEP_TREASURY=0x...           # required
UPKEEP_KEEPER=0x...             # authorized on the executor at deploy time
UPKEEP_ADMIN=                   # blank = the deployer
UPKEEP_FEE_BPS=5                # 0.05%

ARC_RPC_URL=https://rpc.mainnet.arc.io
```

`.env.local` is gitignored. Check it with `git status` before you ever commit.

---

## 4. Pre-flight

```bash
npm run preflight
```

This checks the live chain rather than trusting this repo: chain id is 5042, the RPC has history,
gas is at or above the 20 Gwei floor, USDC reports 6 decimals at `0x3600…0000`, the native and
ERC-20 views reconcile at exactly 1e12, and the fee math produces $0.50 on $1,000 and caps a
$0.01 execution at $0.0001.

It will warn that the contracts are not configured. That is expected at this point.

---

## 5. Deploy

```bash
cd contracts
source ../.env.local

arc-forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://rpc.mainnet.arc.io \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast \
  --slow
```

`--slow` sends one transaction at a time and waits for each receipt. On a chain with 0.5s blocks
this costs you seconds and removes a class of nonce problem.

> **If the broadcast appears to hang with no receipt**, check the gas price first. Arc's mempool
> *silently discards* transactions whose `maxFeePerGas` is under 20 Gwei — no receipt, no error,
> never mined. Add `--with-gas-price 25000000000` (25 Gwei) and retry.

The script deploys four contracts, then wires them: registers the balance evaluator, points the
registry at the executor, and authorizes your keeper. It prints the addresses ready to paste.

---

## 6. Record the addresses

Paste the printed block into `.env.local`:

```bash
NEXT_PUBLIC_CONDITION_REGISTRY_ADDRESS=0x...
NEXT_PUBLIC_AUTOMATION_EXECUTOR_ADDRESS=0x...
NEXT_PUBLIC_VAULT_FACTORY_ADDRESS=0x...
NEXT_PUBLIC_DEPLOY_BLOCK=...
```

`NEXT_PUBLIC_DEPLOY_BLOCK` matters: without it, execution log scans fall back to a 12-hour
look-back window instead of starting where your protocol actually began.

---

## 7. Verify the deployment

```bash
npm run preflight
```

The three warnings should now be `PASS` lines confirming there is real contract code at each
address. Then confirm the wiring:

```bash
arc-cast call $NEXT_PUBLIC_CONDITION_REGISTRY_ADDRESS "executor()(address)" \
  --rpc-url https://rpc.mainnet.arc.io
# must equal your AutomationExecutor

arc-cast call $NEXT_PUBLIC_CONDITION_REGISTRY_ADDRESS "registeredKinds()(uint8[])" \
  --rpc-url https://rpc.mainnet.arc.io
# must return [1] - the balance evaluator (one evaluator serves both directions)

arc-cast call $NEXT_PUBLIC_AUTOMATION_EXECUTOR_ADDRESS "keepers(address)(bool)" $UPKEEP_KEEPER \
  --rpc-url https://rpc.mainnet.arc.io
# must return true
```

If `registeredKinds()` is empty, no condition can ever be created. That is the single most
important line to check.

---

## 8. Source verification (optional, unconfirmed)

Arc's explorer appears to be Blockscout. The documented **testnet** pattern is:

```bash
arc-forge verify-contract <ADDRESS> src/ConditionRegistry.sol:ConditionRegistry \
  --chain-id 5042002 \
  --verifier blockscout \
  --verifier-url https://explorer.testnet.arc.io/api/
```

The Mainnet equivalent is presumably `--chain-id 5042` with
`--verifier-url https://explorer.arc.io/api/`, but **Arc's docs do not state this** and the
explorer sits behind bot protection, so it could not be confirmed from here. Treat it as untested
and check with Arc if verified source matters to you.

---

## Rehearse on Arc Testnet first

You cannot test upKEEP's features "on Arc Mainnet before deploying", because the features *are*
the contracts — until they are deployed there is nothing on Mainnet to test. But you can run the
entire thing on **Arc Testnet** first, on a real Arc network, with free funds.

Verified live: chain id **5042002**, the same USDC precompile at `0x3600…0000` reporting 6
decimals, and Multicall3 deployed at the canonical address. The code needs no changes — only
environment variables.

```bash
# 1. Get testnet USDC
#    https://faucet.circle.com

# 2. Deploy to testnet
cd contracts
DEPLOYER_PRIVATE_KEY=0x... UPKEEP_TREASURY=0x... UPKEEP_KEEPER=0x... arc-forge script script/Deploy.s.sol:Deploy   --rpc-url https://rpc.testnet.arc.io --broadcast --slow

# 3. Point the app at testnet in .env.local
NEXT_PUBLIC_ARC_RPC_URL=https://rpc.testnet.arc.io
ARC_RPC_URL=https://rpc.testnet.arc.io
NEXT_PUBLIC_ARC_CHAIN_ID=5042002
NEXT_PUBLIC_ARC_EXPLORER_URL=https://explorer.testnet.arc.io
#    plus the addresses the deploy just printed
```

The UI derives its network name from the chain id, so every screen will say **Arc Testnet** and a
banner will state plainly that this is not Mainnet. Nothing presents testnet activity as Mainnet
activity.

Then exercise the whole product for real: connect a wallet, create a vault, create a condition in
both directions, move the monitored balance, run the keeper, watch it fire, open the transaction
in the testnet explorer, pause, revoke, withdraw.

When you switch to Mainnet, set the variables back — or simply delete `.env.local`, since Mainnet
is the default.


---

## 9. Your first execution: use a tiny amount

Do **not** make the first Mainnet execution a large one. Prove the path with an amount you would
not mind losing entirely.

```
Monitored wallet : a wallet you control
Threshold        : $0.10
Transfer amount  : $0.01
Vault deposit    : $0.05
Recipient        : a second wallet you control
```

The 1% fee ceiling exists precisely so this behaves sensibly: a $0.01 execution is charged
$0.0001, not the $0.001 minimum.

Then:

1. `npm run dev`, connect the monitored wallet, create the condition through the UI.
2. Confirm it shows **Active** with the balance above the threshold.
3. Move USDC out of the monitored wallet so it drops below $0.10.
4. Run the keeper once and watch it decide:

   ```bash
   KEEPER_DRY_RUN=true npm run keeper:once   # look first
   npm run keeper:once                       # then actually execute
   ```

5. Open the transaction hash on `explorer.arc.io`.

That transaction hash is the artifact worth showing anyone. It is the whole claim: a real wallet,
real USDC, a real persistent condition, and a real Arc Mainnet execution.

---

## 10. Keep the keeper alive

Nothing is monitored unless a keeper process is running.

```bash
npm run keeper          # continuous
npm run keeper:once     # single sweep, suitable for cron
```

It backs off exponentially on RPC failure, never overlaps sweeps, and simulates every execution
before spending gas. For anything beyond a demo, run it under a supervisor (systemd, pm2, a
container) rather than a terminal you will eventually close.

---

## If something goes wrong

| Symptom | Cause |
|---|---|
| Broadcast hangs, no receipt | `maxFeePerGas` under 20 Gwei; Arc dropped it silently. Retry with `--with-gas-price 25000000000`. |
| `deployer has no USDC for gas` | Gas is USDC on Arc. Fund the deployer. |
| `UPKEEP_TREASURY must be set` | Required. The script will not guess a fee destination. |
| UI says "contracts are not configured" | The `NEXT_PUBLIC_*` addresses are missing or malformed. Restart after editing `.env.local`. |
| Condition creation reverts `NoEvaluatorForKind` | The evaluator was never registered. See step 7. |
| Keeper logs `not executable`, nothing happens | Usually correct: the balance recovered, or the condition is latched awaiting re-arm. |
| Execution reverts `InsufficientVaultBalance` | The vault needs topping up. Fund it from the Wallets page. |

---

## Emergency stops

Ranked by scope, narrowest first:

1. **A user pauses their vault** — their automations stop. Withdrawal still works.
2. **A user revokes** — the executor is removed from their vault permanently until re-authorized.
3. **Admin trips the executor circuit breaker** — `executor.pause()` halts *all* executions
   protocol-wide. It cannot move funds and cannot stop a user withdrawing.

No protocol-level action can take a user's funds or prevent them withdrawing. That is by design
and it is the property to preserve in anything you add later.
