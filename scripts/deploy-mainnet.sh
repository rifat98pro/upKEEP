#!/usr/bin/env bash
#
# Deploy upKEEP to Arc Mainnet using Arc's own Foundry fork.
#
# Run this inside WSL. It refuses to proceed on anything it cannot verify,
# because the failure mode of a half-checked mainnet deploy is a live address
# that people trust and that nobody can fix.
#
#   wsl -d Ubuntu -e bash /mnt/c/Users/Asus/upKEEP/scripts/deploy-mainnet.sh
#
set -euo pipefail

ARC_FORGE="${ARC_FORGE:-$HOME/.local/bin/arc-forge}"
ARC_CAST="${ARC_CAST:-$HOME/.local/bin/arc-cast}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RPC="https://rpc.mainnet.arc.io"
EXPECTED_CHAIN_ID=5042

# Arc's mempool silently discards transactions under 20 Gwei: no receipt, no
# error, never mined. 25 Gwei keeps a margin over that floor.
GAS_PRICE=25000000000

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
die()   { red "FAIL: $*"; exit 1; }

[ -x "$ARC_FORGE" ] || die "arc-forge not found at $ARC_FORGE. See DEPLOYING.md step 0."
[ -f "$ROOT/.env.local" ] || die ".env.local not found."

# `source` alone would set these as shell variables that forge never sees.
set -a; . "$ROOT/.env.local"; set +a

bold "== upKEEP -> Arc Mainnet =="
echo

# ---- 1. Required configuration ---------------------------------------------
[ -n "${DEPLOYER_PRIVATE_KEY:-}" ] || die "DEPLOYER_PRIVATE_KEY is empty in .env.local"
[ -n "${UPKEEP_TREASURY:-}" ]      || die "UPKEEP_TREASURY is empty. Fees need a destination you control."
[ -n "${UPKEEP_KEEPER:-}" ]        || die "UPKEEP_KEEPER is empty. Nothing would be monitored."

case "$DEPLOYER_PRIVATE_KEY" in
  0x*) ;;
  *) die "DEPLOYER_PRIVATE_KEY must start with 0x" ;;
esac

DEPLOYER="$("$ARC_CAST" wallet address --private-key "$DEPLOYER_PRIVATE_KEY")"

# A hot keeper sharing the deployer key means one compromise loses both roles.
if [ "${UPKEEP_KEEPER,,}" = "${DEPLOYER,,}" ]; then
  red "WARNING: the keeper is the same account as the deployer."
  red "         The keeper runs hot in a long-lived process. Use a separate key."
  echo
fi

# ---- 2. The chain is the one we think it is --------------------------------
CHAIN_ID="$("$ARC_CAST" chain-id --rpc-url "$RPC")"
[ "$CHAIN_ID" = "$EXPECTED_CHAIN_ID" ] \
  || die "RPC reports chain $CHAIN_ID, expected Arc Mainnet ($EXPECTED_CHAIN_ID)."
green "PASS  chain id $CHAIN_ID (Arc Mainnet)"

# ---- 3. Gas is USDC on Arc, so a broke deployer cannot deploy --------------
BAL="$("$ARC_CAST" balance "$DEPLOYER" --rpc-url "$RPC")"
BAL_USD="$(echo "$BAL" | awk '{printf "%.4f", $1/1e18}')"
if [ "$(echo "$BAL" | awk '{print ($1 < 2e17) ? 1 : 0}')" = "1" ]; then
  die "deployer $DEPLOYER holds \$$BAL_USD USDC. Gas on Arc is USDC - fund it with ~\$2."
fi
green "PASS  deployer $DEPLOYER holds \$$BAL_USD USDC"

# ---- 4. Show the plan, then require a typed confirmation -------------------
echo
bold "About to deploy with:"
echo "  deployer : $DEPLOYER  (\$$BAL_USD USDC)"
echo "  treasury : $UPKEEP_TREASURY"
echo "  keeper   : $UPKEEP_KEEPER"
echo "  admin    : ${UPKEEP_ADMIN:-<deployer>}"
echo "  fee      : ${UPKEEP_FEE_BPS:-5} bps"
echo "  gas      : $GAS_PRICE wei (25 Gwei, above Arc's 20 Gwei floor)"
echo
red "This spends real USDC on Arc Mainnet and cannot be undone."
printf 'Type DEPLOY to continue: '
read -r CONFIRM
[ "$CONFIRM" = "DEPLOY" ] || die "aborted (you typed '$CONFIRM')"
echo

# ---- 5. Deploy -------------------------------------------------------------
# --slow sends one transaction at a time and waits for each receipt. On 0.5s
# blocks that costs seconds and removes a class of nonce problem.
cd "$ROOT/contracts"
"$ARC_FORGE" script script/Deploy.s.sol:Deploy \
  --rpc-url "$RPC" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast \
  --slow \
  --with-gas-price "$GAS_PRICE" \
  -vv

echo
green "Deployment finished. Paste the printed NEXT_PUBLIC_* lines into .env.local,"
green "then run:  npm run preflight"
