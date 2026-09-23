import { formatUsd, type ConditionView } from '@upkeep/sdk';

/**
 * A readable name for a condition.
 *
 * Conditions are not named on-chain: storing a user-supplied string would cost
 * gas on every create for something purely cosmetic. Instead the name is
 * derived from what the condition actually does, so it can never drift from the
 * rule it describes.
 */
export function conditionName(view: ConditionView): string {
  const { condition, action } = view;

  const direction = condition.operator === 1 ? 'below' : 'above';
  return `${condition.asset} ${direction} ${formatUsd(condition.threshold)} → ${formatUsd(action.amount)}`;
}

/** A shorter label, for breadcrumbs and page titles. */
export function conditionShortName(view: ConditionView): string {
  return `Condition #${view.condition.id}`;
}
