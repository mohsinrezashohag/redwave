/**
 * useScopeTierMode — is the selected scope on a tier ladder or on base prices (tiers off)? Shared by every
 * card that must behave differently when tiers are off, so they can never disagree. — 2026-11-11
 *
 * "All scopes" has no single mode (each scope can differ), so `mode` is null there: the switch is hidden and
 * nothing is locked. A client with no schedule of its own follows Global, exactly as the engine does.
 */
import { SCOPE_ALL, SCOPE_GLOBAL, scopeDefaultClientId, scopeParam, type ScopeValue } from '../clientScope';
import { deriveTierMode, type ScopeTierMode } from '../tierMode';
import { useTierSchedules } from './useCommission';

export function useScopeTierMode(scope: ScopeValue): ScopeTierMode & { isAll: boolean; isLoading: boolean } {
  const isAll = scope === SCOPE_ALL;
  const clientId = scopeDefaultClientId(scope);
  const own = useTierSchedules(scopeParam(scope), !isAll);
  const global = useTierSchedules(SCOPE_GLOBAL, !!clientId);
  if (isAll) return { mode: null, current: null, inherited: false, isAll, isLoading: false };
  return {
    ...deriveTierMode(!!clientId, own.data, scope === SCOPE_GLOBAL ? own.data : global.data),
    isAll,
    isLoading: own.isLoading || (!!clientId && global.isLoading),
  };
}
