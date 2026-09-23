# upKEEP

**Persistent financial conditions for Arc.**

upKEEP is a reusable financial automation layer for [Arc Mainnet](https://docs.arc.io). You
describe a financial condition once, bind it to a single constrained action, and upKEEP keeps
evaluating it on-chain until it becomes true.

```
WHEN this financial condition becomes true
THEN perform this authorized action.
```

The first condition type built on it is the **Balance Guard**:

```
IF   USDC balance < $5,000
THEN transfer $1,000 USDC
TO   an approved reserve wallet
```

---

## What this actually is

upKEEP is a **condition engine**, not a balance-guard app. A condition is a generic triple —
subject, operator, threshold — interpreted by a registered evaluator and bound to an action.
Balance Guard is the first evaluator registered on that engine.

```
                     upKEEP engine
                          │
        ┌─────────────────┼─────────────────┐
        ↓                 ↓                 ↓
   Condition          Condition         Condition
   (evaluator)        (evaluator)       (evaluator)
        │                 │                 │
        ↓                 ↓                 ↓
     Action            Action            Action
```

The product ships as three things:

1. **Contracts** — the engine, the executor, and the permission model, on Arc Mainnet.
2. **`@upkeep/sdk`** — a TypeScript SDK over those contracts. This is the product surface.
3. **A reference dashboard** — this Next.js app, which consumes exactly the same SDK any other
   Arc builder would. There is no private path around it.

Conditional treasury automation is not a new idea. What upKEEP packages is the *condition itself*
as reusable developer infrastructure.

---

## Two things about Arc that shape everything here

Both were verified against the live chain, not assumed.

### 1. USDC is the native gas token, with two decimal views

On Arc, USDC **is** the gas token. One balance is readable two ways:

| Interface | Decimals | Read with |
|---|---|---|
| Native | **18** | `eth_getBalance`, `msg.value`, `address.balance` |
| ERC-20 | **6** | `balanceOf` at `0x3600000000000000000000000000000000000000` |

The scale between them is exactly `1e12`. Arc's docs warn against recording balances from the
6-decimal view because it truncates, so **upKEEP accounts for everything in 18-decimal native
wei** and uses the 6-decimal view for display only.

This also means the trigger — a wallet's USDC balance — is `address.balance`, readable **on-chain**.
Which leads to the design decision that matters most:

> The executor re-verifies the predicate in the same transaction that moves the funds. The
> off-chain keeper decides *when* to ask, never *whether* the answer is yes. A malicious or buggy
> keeper cannot fabricate a trigger.

### 2. Transactions under 20 Gwei are silently dropped

Arc's mempool discards transactions whose `maxFeePerGas` is below 20 Gwei — no receipt, no error,
never mined. Every write in the SDK reads the live gas price, adds headroom, and clamps to that
floor, so this cannot happen to you by accident.

Sources: [connect-to-arc](https://docs.arc.io/arc/references/connect-to-arc) ·
[evm-differences](https://docs.arc.io/arc/references/evm-differences) ·
[gas-and-fees](https://docs.arc.io/arc/references/gas-and-fees)

---

## Architecture

```
  Wallet ──┬─> ConditionRegistry ──> IConditionEvaluator  (view only, pluggable)
           │        │                     └── BalanceThresholdEvaluator
           │        │ latch / re-arm
           │        ↓
  Keeper ──┴─> AutomationExecutor ──> AutomationVault ──> approved recipient
                                            │                  + protocol treasury (0.05%)
                                            └── owner: pause · revoke · withdraw
```

| Contract | Responsibility |
|---|---|
| `ConditionRegistry` | Stores conditions, dispatches evaluation, owns the state machine |
| `IConditionEvaluator` | The engine's extension point. View-only, so it cannot touch money |
| `BalanceThresholdEvaluator` | Condition type #1: native USDC balance vs a threshold |
| `AutomationExecutor` | Verifies, latches, and performs the one authorized action |
| `AutomationVault` | Holds only automation funds; enforces ceiling, recipient, pause, revoke |
| `AutomationVaultFactory` | Deploys vaults; the single source of the fee rate and treasury |

### Why evaluators are pluggable and actions are not

An evaluator is a `view` function reached by `staticcall`: it can say a condition is true, but it
cannot move money, write state, or re-enter. That is what makes it safe as an open extension point.

An action decides what upKEEP may do with user funds. Each new action kind is therefore added
explicitly in the executor, where it is auditable and visible to users — not something an admin can
register quietly. That asymmetry is deliberate.

Adding a condition type is: deploy an evaluator → `registerEvaluator(...)` → add one entry to the
SDK catalog. No change to the registry, the executor, or anything holding funds. There is a test
that proves this (`test_newConditionKind_addedByRegistrationAlone`).

---

## The security model

upKEEP **never holds your keys** and **never receives an unlimited approval**.

You deploy an `AutomationVault`, fund it with the amount you are willing to automate, and name
exactly one destination and one per-execution ceiling. From that point the executor can do
precisely one thing:

> Move at most `maxPerExecution` to exactly `recipient`, and only while the condition is true and
> armed.

It cannot change either value, cannot withdraw, cannot reach funds outside that vault, and cannot
act at all once you pause or revoke. **Worst case — a fully compromised executor — is bounded by
one authorized amount per armed trigger, sent to an address you chose.**

Defences in the code:

- **On-chain predicate verification** — the keeper is a scheduler, not an oracle.
- **Triple replay protection** — the registry latches the condition before value moves, the
  executor records the derived execution id, and the vault independently refuses a spent id.
- **Checks-effects-interactions + `ReentrancyGuard`** on every path that moves value, tested
  against a recipient that calls back in mid-payout.
- **Defence in depth on amounts** — the ceiling is enforced at creation, again in the executor, and
  again in the vault.
- **Immutable fee rate per vault** — the rate you agreed to cannot be raised afterwards by anyone,
  including protocol admins.
- **Withdrawal always works**, including while paused or revoked. Funds can never be stranded.
- **No floating point in the money path** — every amount is a `bigint` of native wei.

### The anti-drain property

A condition that simply *stays* true must not execute on every polling cycle. After firing, a
condition latches to `FIRED` and stays there until its evaluator confirms genuine recovery:

```
NORMAL ──(predicate true)──> TRIGGERED ──(execute)──> EXECUTED
   ↑                                                      │
   └──────(subject recovers past threshold + buffer)───────┘
```

The optional re-arm buffer adds hysteresis, so a balance oscillating around the threshold cannot
fire repeatedly. This is enforced **on-chain**, not just in the off-chain engine.

---

## Crypto-agility and post-quantum readiness

**upKEEP implements no cryptography and makes no post-quantum security claim.** What it does is
refuse to couple a financial condition to a signature scheme.

The engine is layered so authorization is replaceable:

```
Condition  ->  Policy  ->  Authorization  ->  Execution  ->  Arc Mainnet
                              /                               Current auth   Future auth
```

`IAuthorizationProvider` is that third layer. A vault names the scheme it uses, and replacing it is
a vault-level change: the condition keeps its id, threshold, action, history and re-arm state, and
carries on running. There is a test that proves exactly this
(`test_authorizationCanBeSwappedWithoutDisturbingAnythingElse`).

### A provider can only ever restrict

This is the property that makes a pluggable authorization layer safe:

- It runs **after** `msg.sender == executor` and every amount, recipient and balance check. A
  provider returning `true` changes nothing; only `false` blocks.
- It **fails closed**. A provider that reverts is treated as a refusal, not a pass.
- It **cannot strand funds**. Withdrawal never consults it, so the owner can always exit and clear
  a misbehaving provider.

### The security policy

```solidity
struct SecurityPolicy {
    bytes32 authorizationMode;      // "CURRENT"
    address provider;               // optional, zero = built-in executor check
    bool pauseOnMigrationRequired;  // halt automation if migration is needed
}
```

`pauseOnMigrationRequired` implements *"IF authorization migration is required THEN pause automated
withdrawals"*. **The mechanism is real and tested; no provider that ships today triggers it**,
because Arc exposes no on-chain signal that would make any answer but `false` honest.

### What Arc actually provides today

Verified against Arc's documentation and the live chain, not assumed:

| Capability | Status |
|---|---|
| `SLH-DSA-SHA2-128s` **verification** precompile | **Live on Arc Mainnet** at `0x1800000000000000000000000000000000000004` — confirmed responding |
| Post-quantum **transaction signing** | Future Arc milestone, likely EIP-8141. **Arc accounts are not post-quantum secure today** |
| ERC-4337 account abstraction | Supported by Arc |
| Precompile calldata encoding | **Not published** in Arc's docs |

upKEEP therefore ships **no provider that calls the PQ precompile**. Guessing the argument order of
a signature verifier is worse than not having one, so that provider waits for Arc's spec. The
interface exists so it becomes a registration rather than a rewrite.

### Migration without upgradeability

upKEEP's contracts are **not upgradeable**, and that is a decision rather than an omission. A proxy
would mean an admin key that can rewrite the logic holding user funds — the exact unbounded
permission this protocol exists to avoid. So migration works by *address indirection* instead:
every part that might need to change is reached through a pointer the right party controls.

| What | Can change without redeploying? | Controlled by | How |
|---|---|---|---|
| Condition types (new evaluators) | **Yes** | Protocol admin | `registry.registerEvaluator()` |
| Authorization mechanism, per user | **Yes** | **The user** | `vault.setExecutor()` |
| Authorization provider / policy | **Yes** | **The user** | `vault.setSecurityPolicy()` |
| Executors trusted by the engine | **Yes** | Protocol admin | `registry.setAdditionalExecutor()` |
| Recipient, ceiling, pause, revoke | **Yes** | **The user** | vault owner controls |
| Action types | No, deliberately | — | new executor; each action is audited |
| Fee rate on an existing vault | No, deliberately | — | immutable is the user's guarantee |
| Condition storage and state machine | No | — | core logic stays simple |

### Staged migration, not a flag day

An execution requires the caller to satisfy **both** the registry and the user's vault. With a
single registry executor, switching to a new one would instantly break every vault still pointing
at the old — silently, because a mis-wired condition looks exactly like a quiet one.

So the registry accepts a **set** of executors:

```
1. Admin authorizes the new executor alongside the old   registry.setAdditionalExecutor(v2, true)
2. Users migrate their own vaults, whenever they choose  vault.setExecutor(v2)
3. Admin promotes v2 and retires v1                      registry.setExecutor(v2)
```

During step 2 both mechanisms run side by side and nobody is broken.
`Migration.t.sol` tests exactly this, including that a migrated condition keeps its id, threshold,
action, latch state, trigger history and funds, and that **an admin cannot migrate a user's vault
for them** — authorizing an executor in the registry grants it nothing until that user names it.


### Language

The product may say *"designed for future cryptographic migration"*. It must never say *"quantum
safe"*, *"post-quantum secure"* or *"quantum proof"*. Approved phrasing lives in
`AUTHORIZATION_COPY` in the SDK, and tests assert that neither the copy, the scheme descriptions,
nor the rendered UI contains a prohibited claim.


---

## Fees

No subscription. No setup fee. Nothing to create a condition. Nothing to monitor one.

**0.05%** (5 bps), charged only on a **successful** automated execution.

```
$1,000 execution  →  upKEEP fee $0.50  →  recipient receives $999.50
```

Bounded at both ends so it can never become absurd:

- **Minimum** `$0.001` per execution.
- **Ceiling of 1% of the transfer** — this is what stops the minimum from swallowing a small
  amount. A `$0.01` execution is charged `$0.0001`, not `$0.001`.

The fee is always shown before you confirm and is never deducted silently. The math is implemented
twice — `FeeMath.sol` and `core/fee.ts` — and both are driven by the **same vector table**, so the
number the UI quotes is the number the contract charges.

---

## Getting started

### Requirements

- Node.js 20+
- [Foundry](https://getfoundry.sh) (for contracts)

### Install

```bash
npm install
npm run contracts:install   # forge-std + OpenZeppelin (not committed, so a fresh clone needs this)
cp .env.example .env.local
```

### Run

```bash
npm run dev          # the dashboard at http://localhost:3000
npm run preflight    # verify this build's assumptions against live Arc Mainnet
```

The dashboard reads **live Arc Mainnet balances immediately**, with no deployment. Creating and
executing conditions needs the contracts deployed (below). Until then the UI says so explicitly
rather than showing an empty dashboard that looks like "no conditions yet".

---

## Testing

```bash
npm test                 # 82 SDK tests (fee math, units, engine, client, batching)
npm run contracts:test   # 103 Solidity tests, including fuzz
```

> ### Read this before deploying to Mainnet
>
> `npm run contracts:test` runs **upstream Foundry**, which executes against *Ethereum* semantics.
> Arc ships its own toolchain, [`circlefin/arc-foundry`](https://github.com/circlefin/arc-foundry),
> and warns explicitly:
>
> > "Do not use foundry-rs/foundry-toolchain to test Arc contracts — it installs upstream Foundry,
> > which has no Arc support and will run your tests against Ethereum rules while reporting them
> > as passing."
>
> Arc Foundry is a superset of upstream, so passing tests are necessary but **not sufficient**.
> Arc diverges in ways these contracts touch: value transfers to the zero address revert,
> blocklist enforcement burns gas even on revert, sends to precompiles revert, and native sends
> emit EIP-7708 `Transfer` logs. None of that is modelled by upstream Foundry.
>
> **Re-run the suite under `arc-forge` before you deploy anything to Mainnet.** Arc Foundry
> currently publishes a Linux x86_64 binary only, so on Windows use WSL.
>
> ```bash
> # Linux / WSL
> curl -LO https://github.com/circlefin/arc-foundry/releases/latest/download/arc-foundry-v0.8.0-2-x86_64-unknown-linux-gnu.tar.gz
> tar -xzf arc-foundry-*.tar.gz
> mkdir -p ~/.local/bin && mv forge ~/.local/bin/arc-forge && mv cast ~/.local/bin/arc-cast
> export PATH="$HOME/.local/bin:$PATH"
>
> cd contracts && arc-forge test -vv
> ```
>
> Deploy with `arc-forge script`, not `forge script`, for the same reason.

Contract coverage includes every case in the security checklist: unauthorized modification,
unauthorized execution, unauthorized recipient, amount over limit, paused, disabled, repeated
trigger, replay, reentrancy, zero address, zero amount, insufficient vault balance, fee
calculation, owner withdrawal, and emergency pause — plus fuzz tests asserting that the executor
can never move more than one authorized amount per armed trigger.

### End-to-end: the complete flow, 55 checks

This drives the entire product through the **public SDK** — the same API a third party would use —
against a local chain pinned to Arc's chain id.

```bash
# 1. A FRESH chain each run (the log assertions count this run's events)
npm run chain

# 2. Deploy to it
cd contracts
DEPLOYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
UPKEEP_TREASURY=0x70997970C51812dc3A010C7d01b50e0d17dc79C8 \
forge script script/Deploy.s.sol:Deploy --rpc-url http://127.0.0.1:8545 --broadcast

# 3. Run the full flow (addresses from the output above)
cd ..
npm run test:e2e -- <registry> <executor> <factory> 0
```

It verifies vault creation, condition creation, that a healthy balance does not fire, that a low
balance fires exactly one real transaction, that the fee split matches the quote **to the wei**,
that repeated polling does **not** fire again, that recovery re-arms only past the hysteresis
buffer, that the next dip fires with a fresh execution id, and that pause, revoke and withdraw
behave exactly as promised.

> A local chain rather than a fork, deliberately: the contracts depend only on native USDC
> balances, which a local node models exactly, and forking the *public* Arc endpoint hits its rate
> limit as soon as anvil lazily fetches state for a new account. Point `--fork-url` at a private
> endpoint if you want to exercise real Arc state too.

### Seeing the UI with real data

Local development otherwise only ever shows empty states, which hides a whole class of bug — a
list that silently renders "nothing yet" looks identical to a list that is genuinely empty.

```bash
npm run chain                    # terminal 1
npm run contracts:deploy:local   # terminal 2
npm run seed -- <registry> <executor> <factory>
```

`seed` creates three conditions through the SDK — one healthy and active, one that it actually
*fires* with the keeper (producing a real execution row and a TRIGGERED card), and one paused —
then prints the `.env.local` lines to point the app at them. It refuses to run against anything
but a local RPC.

### Browser verification

```bash
npm run verify:ui                  # against a seeded deployment
npm run verify:ui -- --screenshots # also writes .upkeep/screenshots/
```

The dashboard pages are client components that fill in after hydration, so fetching their HTML
proves only that the skeletons render. This drives a real browser instead: it waits for data to
arrive, asserts the on-chain figures actually appear, checks mobile has no horizontal overflow,
checks dark mode is dark but not pure black, and fails on any console error or failed request.

53 checks. It caught two real bugs — a silently-empty condition list, and a missing app icon
404ing on every page load.

---

## Deploying to Arc Mainnet

**See [DEPLOYING.md](DEPLOYING.md) for the full walkthrough**, including the Arc Foundry
requirement, the four addresses you need to choose, real gas costs, verification steps and a
troubleshooting table.

The short version, which assumes you have read the toolchain warning above:

```bash
# 1. Compile, test, fuzz
npm run contracts:test
npm test

# 2. Verify this build's assumptions against the live chain
npm run preflight

# 3. Configure .env.local
#    DEPLOYER_PRIVATE_KEY=   (never commit this)
#    UPKEEP_TREASURY=        (where protocol fees go)
#    UPKEEP_KEEPER=          (the keeper address to authorize)

# 4. Deploy
npm run contracts:deploy

# 5. Paste the printed NEXT_PUBLIC_* addresses into .env.local

# 6. Verify the deployment
npm run preflight
```

The deploy script refuses to run without a treasury, checks the fee rate against the safety bound,
and prints the chain id it is about to deploy to.

### Your first Mainnet execution

**Use a deliberately tiny amount.** A `$0.10` threshold with a `$0.01` transfer proves the entire
path — real wallet, real USDC, real condition, real trigger, real Arc transaction — while risking
almost nothing. The 1% fee ceiling is specifically designed so micro-amounts behave sensibly
(a `$0.01` execution costs `$0.0001`).

Do not make your first Mainnet execution a large one.

---

## Running the keeper

```bash
npm run keeper          # poll continuously
npm run keeper:once     # single sweep, for cron
KEEPER_DRY_RUN=true npm run keeper   # evaluate and log, never send
```

The keeper's key is an **operational key that pays gas**. It is never given custody: vaults
authorize the executor *contract*, not this account, and the executor can only perform the one
action a user authorized. Fund it with only what it needs for gas.

It backs off exponentially on RPC failure, never overlaps sweeps, and simulates every execution
before spending gas.

---

## Using the SDK

```ts
import { createUpkeepClient } from '@upkeep/sdk';

const upkeep = createUpkeepClient({ addresses, walletClient });

// 1. Grant a bounded permission
const { vault } = await upkeep.vaults.create({
  recipient: reserveWallet,
  maxPerExecution: '1000',
  deposit: '5000',
});

// 2. Describe the condition
const condition = await upkeep.conditions.create({
  wallet: treasury,
  type: 'BALANCE_BELOW',
  asset: 'USDC',
  threshold: '5000',
  vault,
  action: { type: 'TRANSFER_USDC', amount: '1000', recipient: reserveWallet },
});
// -> { conditionId, transactionHash, explorerUrl }
```

| Namespace | What it does |
|---|---|
| `upkeep.conditions` | `create` · `get` · `list` · `pause` · `resume` · `disable` · `rearm` |
| `upkeep.vaults` | `create` · `get` · `fund` · `withdraw` · `pause` · `revoke` · `preview` |
| `upkeep.executions` | `list` · `simulate` · `execute` |
| `upkeep.usdc` | `balanceOf` · `dualBalanceOf` |
| `upkeep.fees` | `quote` |
| `upkeep.engine` | `conditionTypes` · `evaluate` · `summarize` |
| `upkeep.network` | `status` · `gasPrice` |

Amounts are strings (`'1000.50'`) or `bigint`s of 18-decimal native wei. **A JavaScript `number` is
rejected** — it cannot represent every USDC amount exactly, and money must never round by accident.

A client built without addresses still reads Arc (balances, network status) but throws
`ProtocolNotConfiguredError` on protocol calls, rather than reading address zero and reporting
nonsense.

---

## Environment variables

See `.env.example` for the full annotated list. The essentials:

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_ARC_RPC_URL` / `ARC_RPC_URL` | Arc RPC (browser / server) |
| `NEXT_PUBLIC_ARC_CHAIN_ID` | `5042` |
| `NEXT_PUBLIC_ARC_EXPLORER_URL` | `https://explorer.arc.io` |
| `NEXT_PUBLIC_CONDITION_REGISTRY_ADDRESS` | From the deploy output |
| `NEXT_PUBLIC_AUTOMATION_EXECUTOR_ADDRESS` | From the deploy output |
| `NEXT_PUBLIC_VAULT_FACTORY_ADDRESS` | From the deploy output |
| `NEXT_PUBLIC_DEPLOY_BLOCK` | So log scans start in the right place |
| `UPKEEP_FEE_BPS` | `5` (0.05%) |
| `UPKEEP_POLL_INTERVAL_MS` | Keeper sweep interval |
| `KEEPER_PRIVATE_KEY` | Keeper gas key — never commit |
| `DEPLOYER_PRIVATE_KEY` | Deploy key — never commit |
| `NEXT_PUBLIC_DEMO_MODE` | `false` in anything resembling production |

`.env` and `.env.local` are gitignored. `.env.example` contains placeholders only.

### Demo mode

`NEXT_PUBLIC_DEMO_MODE=true` renders a deterministic sample dataset for presentations. Every
surface carries a **DEMO MODE** banner, sample transaction hashes are visibly marked, and the UI
**refuses to link them to the explorer**. Demo data can never be mistaken for Mainnet activity.

---

## Project structure

```
contracts/          Solidity + Foundry
  src/              engine, executor, vault, evaluators
  test/             103 tests, including fuzz
  script/Deploy.s.sol
packages/sdk/       @upkeep/sdk — the product surface
  src/core/         types, units, fee math, the engine, the type catalog
  src/arc/          Arc-specific reads
src/                the reference dashboard
  app/              routes
  components/       UI
  hooks/            thin wrappers over the SDK
  config/           env → SDK configuration
scripts/            keeper, preflight, e2e, abi generation
```

---

## What is deliberately not here

upKEEP is honest about its edges.

- **Two condition types and one action type are enabled.** `BALANCE_BELOW` and `BALANCE_ABOVE`
  both run on the *same deployed evaluator*, reached with a different operator — the engine's
  reuse claim cashed in rather than asserted. Spend-rate, ratio and scheduled conditions are
  designed for but not built, and are marked "coming soon" wherever they appear.
- **Circle Agent Stack is not integrated.** Its Agent Wallets currently support Arc *testnet*, with
  mainnet listed as coming soon. Integrating it here would mean claiming Mainnet support that does
  not exist yet. It is worth noting the conceptual overlap: an Agent Wallet's policy-controlled
  spending is the same primitive as `AutomationVault`, and an Agent Wallet can already be used as a
  *monitored wallet* today, since upKEEP watches any Arc address.
- **CCTP and Gateway are not used.** The core flow is entirely within Arc, so adding them would be
  branding rather than function.
- **No notification backend, no hosted keeper, no database.** Conditions live in the on-chain
  registry and executions are read from chain logs, so there is no second source of truth to keep
  in sync.

---

## Roadmap

1. More evaluators — spend rate over a window, balance ratios, schedules.
2. More action types, each added explicitly and audited, never as an open plugin.
3. Multi-condition rules (AND / OR composition over the same engine).
4. A public keeper network, once permissionless execution has been exercised at scale.
5. Circle Agent Stack integration, when Agent Wallets reach Arc Mainnet.

---

## License

MIT
