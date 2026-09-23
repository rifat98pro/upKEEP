#!/usr/bin/env bash
#
# Add the schedule condition kind to a live upKEEP deployment.
#
# This is a much smaller act than the original deploy: one `view` contract and
# one registry call. Nothing that holds funds is touched, and every existing
# condition keeps its id, threshold, action and history while it happens.
#
# Run via: npm run schedule:register
#
set -euo pipefail

ARC_FORGE="${ARC_FORGE:-$HOME/.local/bin/arc-forge}"
ARC_CAST="${ARC_CAST:-$HOME/.local/bin/arc-cast}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RPC="https://rpc.mainnet.arc.io"
GAS_PRICE=25000000000

green() { printf '\033[32m%s\033[0m\n' "$*"; }
red()   { printf '\033[31m%s\033[0m\n' "$*"; }
die()   { red "FAIL: $*"; exit 1; }

[ -x "$ARC_FORGE" ] || die "arc-forge not found at $ARC_FORGE"
[ -f "$ROOT/.env.local" ] || die ".env.local not found"

set -a; . "$ROOT/.env.local"; set +a

[ -n "${DEPLOYER_PRIVATE_KEY:-}" ] || die "DEPLOYER_PRIVATE_KEY is empty"
[ -n "${NEXT_PUBLIC_CONDITION_REGISTRY_ADDRESS:-}" ] || die "registry address is not set"

DEPLOYER="$("$ARC_CAST" wallet address --private-key "$DEPLOYER_PRIVATE_KEY")"
OWNER="$("$ARC_CAST" call "$NEXT_PUBLIC_CONDITION_REGISTRY_ADDRESS" "owner()(address)" --rpc-url "$RPC")"

# registerEvaluator is onlyOwner; say so here rather than burning gas on a revert.
if [ "${DEPLOYER,,}" != "${OWNER,,}" ]; then
  die "deployer $DEPLOYER is not the registry owner ($OWNER)"
fi

EXISTING="$("$ARC_CAST" call "$NEXT_PUBLIC_CONDITION_REGISTRY_ADDRESS" "evaluatorFor(uint8)(address)" 2 --rpc-url "$RPC")"
if [ "$EXISTING" != "0x0000000000000000000000000000000000000000" ]; then
  green "Already registered at $EXISTING. Nothing to do."
  exit 0
fi

BAL="$("$ARC_CAST" balance "$DEPLOYER" --rpc-url "$RPC" | awk '{printf "%.4f", $1/1e18}')"

echo "registry : $NEXT_PUBLIC_CONDITION_REGISTRY_ADDRESS"
echo "deployer : $DEPLOYER  (\$$BAL USDC)"
echo "adding   : kind 2, ScheduleEvaluator"
echo

cd "$ROOT/contracts"
"$ARC_FORGE" script script/RegisterScheduleEvaluator.s.sol:RegisterScheduleEvaluator \
  --rpc-url "$RPC" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast --slow --with-gas-price "$GAS_PRICE" -vv

echo
green "Registered. Restart the dev server and 'Time or schedule' becomes selectable."
