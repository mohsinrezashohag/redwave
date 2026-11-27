/**
 * Chatbot tool entitlement — PURE & deterministic. The single security gate that decides whether the
 * CALLER may invoke a resolved intent (basic mode) or a model-requested function (AI mode). Tools are
 * scoped to the AuthUser (no rep_id ever flows from the prompt or the model), and this gate additionally
 * blocks a lower role from a higher-scope tool. So a rep can only ever run personal tools against their
 * OWN data — the chatbot cannot leak across scope regardless of the prompt. — SRS RPT-011, CLAUDE §5
 */
import { AuthUser } from '../../../common/rbac/auth-user.type';
import { ChatTool } from './llm.provider';
import { AiToolName } from './ai-tools';

/**
 * self        — needs a linked rep profile; answers from that rep only.
 * scoped      — answers within the caller's rep scope (self / roster / all); needs a rep or a wider scope.
 * own         — the caller's own records (e.g. expenses they submitted); any authenticated user.
 * leaderboard — the counts-only leaderboard, which itself needs `reports:view`; plus a rep profile.
 * roster      — managers + admins.
 * business    — Super Admin only.
 */
type Entitlement = 'self' | 'scoped' | 'own' | 'leaderboard' | 'roster' | 'business' | 'none';

export const TOOL_ENTITLEMENT: Record<ChatTool | AiToolName, Entitlement> = {
  // basic (keyword) intents
  my_sales_count: 'self',
  my_commission: 'self',
  roster_summary: 'roster',
  business_summary: 'business',
  greeting: 'own',
  help: 'own',
  rep_lookup: 'scoped',
  unknown: 'none',
  // AI function-calling tools
  my_sales_summary: 'self',
  pending_validation_count: 'scoped',
  sale_status: 'scoped',
  my_pay_summary: 'self',
  my_expenses_status: 'own',
  leaderboard_position: 'leaderboard',
  team_summary: 'roster',
};

/** Whether `user` (with rep scope `scopeLevel`) may invoke `tool`. Unknown names are refused. */
export function isToolAllowed(
  tool: ChatTool | AiToolName | string,
  user: AuthUser,
  scopeLevel: 'all' | 'roster' | 'self',
): boolean {
  const entitlement = (TOOL_ENTITLEMENT as Record<string, Entitlement | undefined>)[tool] ?? 'none';
  switch (entitlement) {
    case 'self':
      return user.repId !== null; // a personal tool needs a linked rep
    case 'scoped':
      return user.repId !== null || scopeLevel === 'roster' || scopeLevel === 'all';
    case 'own':
      return true;
    case 'leaderboard':
      return user.repId !== null && (user.isSuperAdmin || user.permissions.has('reports:view'));
    case 'roster':
      return scopeLevel === 'roster' || scopeLevel === 'all'; // managers + admins
    case 'business':
      return user.isSuperAdmin; // Super Admin only
    default:
      return false;
  }
}
