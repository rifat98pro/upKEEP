#!/usr/bin/env node
/**
 * Extracts ABIs from the Foundry build output into the SDK.
 *
 * Keeping this generated rather than hand-written means the SDK, and therefore
 * every consumer including the reference dashboard, can never drift from the
 * deployed contracts: change a signature, rebuild, regenerate.
 *
 *   npm run abi
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'contracts', 'out');

const CONTRACTS = [
  ['ConditionRegistry', 'ConditionRegistry.sol'],
  ['AutomationExecutor', 'AutomationExecutor.sol'],
  ['AutomationVault', 'AutomationVault.sol'],
  ['AutomationVaultFactory', 'AutomationVaultFactory.sol'],
  ['BalanceThresholdEvaluator', 'BalanceThresholdEvaluator.sol'],
];

function loadAbi(name, file) {
  const path = join(outDir, file, `${name}.json`);
  if (!existsSync(path)) {
    console.error(`Missing artifact: ${path}`);
    console.error('Run `npm run contracts:build` first.');
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, 'utf8')).abi;
}

const parts = CONTRACTS.map(([name, file]) => {
  const abi = loadAbi(name, file);
  const constName = name.replace(/^./, (c) => c.toLowerCase()) + 'Abi';
  return `export const ${constName} = ${JSON.stringify(abi, null, 2)} as const;`;
});

const header = `/**
 * Contract ABIs for the upKEEP condition engine.
 *
 * GENERATED FILE - do not edit by hand.
 * Regenerate with: npm run abi   (after npm run contracts:build)
 */
`;

const target = join(root, 'packages', 'sdk', 'src', 'abi.ts');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, header + '\n' + parts.join('\n\n') + '\n');
console.log(`Wrote packages/sdk/src/abi.ts (${CONTRACTS.length} contracts)`);
