/**
 * The off-chain condition engine.
 *
 * Given a condition's on-chain state and the value its evaluator observes, this
 * decides what a keeper should do about it. It is a pure function: no I/O, no
 * clock, no randomness, so the whole state machine is testable without a chain.
 *
 * It deliberately mirrors ConditionRegistry.canExecute / canRearm rather than
 * inventing its own rules. The chain has the final say - the executor re-checks
 * everything - but agreeing here means a keeper does not waste gas submitting
 * transactions that were always going to revert.
 *
 *   NORMAL --(predicate true)--> TRIGGERED --(execute)--> EXECUTED
 *      ^                                                      |
 *      +---------(subject recovers past the buffer)-----------+
 */
import type { ConditionView, VaultInfo } from './types.js';

export type DecisionKind = 'execute' | 'rearm' | 'skip';

export interface EngineDecision {
  kind: DecisionKind;
  conditionId: string;
  /** Human-readable explanation, surfaced in keeper logs and the UI. */
  reason: string;
  /** Machine-readable reason code, for metrics and tests. */
  code: DecisionCode;
}

export type DecisionCode =
  | 'trigger-armed'
  | 'predicate-recovered'
  | 'not-active'
  | 'paused'
  | 'disabled'
  | 'already-fired'
  | 'predicate-false'
  | 'inside-hysteresis'
  | 'one-shot-complete'
  | 'vault-paused'
  | 'vault-revoked'
  | 'vault-underfunded'
  | 'vault-limit-exceeded'
  | 'recipient-mismatch'
  | 'vault-unknown';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

function decide(
  kind: DecisionKind,
  conditionId: string,
  code: DecisionCode,
  reason: string,
): EngineDecision {
  return { kind, conditionId, code, reason };
}

/**
 * Decide what to do with one condition.
 *
 * `view.executable` and `view.rearmable` come from the chain, which is the
 * authority on whether the predicate holds. This function adds the checks the
 * chain cannot make cheaply in one call: whether the vault is in a state that
 * would let the action succeed.
 *
 * @param view The condition, its action, and the live observed value.
 * @param vault The funding vault's current permission state, if readable.
 */
export function evaluateCondition(view: ConditionView, vault: VaultInfo | null): EngineDecision {
  const { condition, action } = view;
  const id = condition.id;

  // ---- lifecycle gates ----
  switch (condition.status) {
    case 'paused':
      return decide('skip', id, 'paused', 'Condition is paused by its owner.');
    case 'disabled':
      return decide('skip', id, 'disabled', 'Condition has been revoked by its owner.');
    case 'executed':
      return decide('skip', id, 'one-shot-complete', 'One-shot condition has already executed.');
    case 'none':
      return decide('skip', id, 'not-active', 'Condition does not exist.');
  }

  // ---- already fired: the only way forward is a genuine recovery ----
  if (condition.arm === 'fired') {
    if (!condition.recurring) {
      return decide('skip', id, 'one-shot-complete', 'One-shot condition has fired.');
    }
    if (view.rearmable) {
      return decide(
        'rearm',
        id,
        'predicate-recovered',
        'The subject recovered past the re-arm level; arming the condition again.',
      );
    }
    return decide(
      'skip',
      id,
      condition.rearmBuffer > 0n ? 'inside-hysteresis' : 'already-fired',
      'Already triggered. Waiting for the subject to recover before it can fire again.',
    );
  }

  // ---- armed: is the predicate true? ----
  if (!view.executable) {
    return decide('skip', id, 'predicate-false', 'The condition is not currently true.');
  }

  // ---- the predicate is true; can the action actually be performed? ----
  if (!vault) {
    return decide('skip', id, 'vault-unknown', 'Could not read the funding vault.');
  }
  if (vault.revoked || vault.executor === ZERO_ADDRESS) {
    return decide('skip', id, 'vault-revoked', 'Automation has been revoked on the vault.');
  }
  if (vault.paused) {
    return decide('skip', id, 'vault-paused', 'The funding vault is paused.');
  }
  if (vault.recipient.toLowerCase() !== action.recipient.toLowerCase()) {
    return decide(
      'skip',
      id,
      'recipient-mismatch',
      'The vault approves a different recipient than this condition specifies.',
    );
  }
  if (action.amount > vault.maxPerExecution) {
    return decide(
      'skip',
      id,
      'vault-limit-exceeded',
      'The action amount exceeds the vault per-execution limit.',
    );
  }
  if (vault.balance < action.amount) {
    return decide(
      'skip',
      id,
      'vault-underfunded',
      'The vault does not hold enough USDC to fund this execution.',
    );
  }

  return decide('execute', id, 'trigger-armed', 'The condition became true while armed.');
}

/** Evaluate a batch, preserving input order. */
export function evaluateConditions(
  views: readonly ConditionView[],
  vaults: ReadonlyMap<string, VaultInfo>,
): EngineDecision[] {
  return views.map((view) =>
    evaluateCondition(view, vaults.get(view.action.vault.toLowerCase()) ?? null),
  );
}

export interface EvaluationSummary {
  evaluated: number;
  toExecute: EngineDecision[];
  toRearm: EngineDecision[];
  skipped: EngineDecision[];
}

export function summarizeDecisions(decisions: readonly EngineDecision[]): EvaluationSummary {
  return {
    evaluated: decisions.length,
    toExecute: decisions.filter((d) => d.kind === 'execute'),
    toRearm: decisions.filter((d) => d.kind === 'rearm'),
    skipped: decisions.filter((d) => d.kind === 'skip'),
  };
}
