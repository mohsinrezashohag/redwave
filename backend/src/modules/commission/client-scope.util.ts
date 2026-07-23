/**
 * Client-scope resolution for commission config writes (needs Prisma, so it lives outside the pure
 * `client-scope.logic.ts`). Shared by the tier-schedule and flat-rate services so both validate the scope
 * identically. — SRS §7, CLAUDE #10
 */
import { UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Normalise an optional `client_id` into the stored scope: `null` = the GLOBAL row (the fallback), or a
 * validated, active client id. An unknown/inactive client is a 422 — never a silent global write, which
 * would quietly change every client's pay.
 */
export async function resolveClientScope(
  prisma: PrismaService,
  clientId?: string,
): Promise<string | null> {
  if (!clientId) {
    return null; // global scope
  }
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, is_active: true },
  });
  if (!client || !client.is_active) {
    throw new UnprocessableEntityException(`client ${clientId} does not exist or is inactive`);
  }
  return client.id;
}
