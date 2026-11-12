/**
 * Chatbot tool entitlement — PURE & deterministic. The single security gate that decides whether the
 * CALLER may invoke a resolved intent. Tools are scoped to the AuthUser (no rep_id ever flows from the
 * prompt), and this gate additionally blocks a lower role from a higher-scope tool. So a rep can only
 * ever run `my_*` tools against their OWN data — the chatbot cannot leak across scope regardless of the
 * prompt. — SRS RPT-011, CLAUDE §5 (data leakage is the paramount risk)
 */
import { AuthUser } from '../../../common/rbac/auth-user.type';
import { ChatTool } from './llm.provider';

type Entitlement = 'self' | 'roster' | 'business' | 'none';

export const TOOL_ENTITLEMENT: Record<ChatTool, Entitlement> = {
  my_sales_count: 'self',
  my_commission: 'self',
  roster_summary: 'roster',
  business_summary: 'business',
  unknown: 'none',
};

/** Whether `user` (with rep scope `scopeLevel`) may invoke `tool`. */
export function isToolAllowed(
  tool: ChatTool,
  user: AuthUser,
  scopeLevel: 'all' | 'roster' | 'self',
): boolean {
  switch (TOOL_ENTITLEMENT[tool]) {
    case 'self':
      return user.repId !== null; // a personal tool needs a linked rep
    case 'roster':
      return scopeLevel === 'roster' || scopeLevel === 'all'; // managers + admins
    case 'business':
      return user.isSuperAdmin; // Super Admin only
    default:
      return false;
  }
}
