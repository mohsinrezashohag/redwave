/**
 * PermissionsGuard — authorization (runs after JwtAuthGuard, globally).
 *
 * If a route declares @RequirePermission(moduleKey, action), the caller is allowed only when
 * their effective permission set contains `moduleKey:action`. Otherwise the request is rejected
 * with 403 AND the denied attempt is written to the audit log. Routes with no @RequirePermission
 * require only authentication. — SRS AUTH-006, arch §7, CLAUDE §5
 *
 * The Super Admin passes EVERY permission check (client decision 2026-11-12), not only the ones its role row
 * happens to hold: a permission added later can never lock the owner out. Data scope still applies per
 * service (the SA's scope is already `all`).
 */
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { RBAC_KEY, RequiredPermission } from '../decorators/require-permission.decorator';
import { AuthUser } from '../rbac/auth-user.type';
import { permissionKey } from '../rbac/permissions.util';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<RequiredPermission | undefined>(RBAC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // No permission declared → authentication-only route.
    if (!required) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = request.user;
    if (!user) {
      throw new UnauthorizedException();
    }

    const key = permissionKey(required.moduleKey, required.action);
    if (user.isSuperAdmin || user.permissions.has(key)) {
      return true;
    }

    // Authorization failure: audit then 403. Never let an audit failure mask the denial. — AUTH-006
    try {
      await this.audit.log({
        actorId: user.id,
        entityType: 'rbac',
        entityId: user.id,
        action: 'access_denied',
        after: {
          method: request.method,
          path: request.originalUrl ?? request.url,
          required: key,
        },
      });
    } catch {
      /* swallow — the 403 below is the contract */
    }
    throw new ForbiddenException(`Missing permission: ${key}`);
  }
}
