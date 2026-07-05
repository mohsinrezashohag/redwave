/**
 * CurrenciesService — reads the currency catalogue (the allowed set for billing/expense currencies) and
 * validates a code. The set is seeded in bootstrap (CAD/USD); admin add/edit is deferred (read-only here).
 * — Meeting 3, CLAUDE §3 #12
 */
import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CurrenciesService {
  constructor(private readonly prisma: PrismaService) {}

  /** The active currencies, ordered by code (the picker source). */
  list() {
    return this.prisma.currency.findMany({
      where: { is_active: true },
      orderBy: { code: 'asc' },
    });
  }

  /**
   * Assert a code is a supported ACTIVE currency (else 422 — never a raw FK 500). CAD is always valid
   * (the seeded base). Reused by the clients service when setting a client's billing currency.
   */
  async assertSupported(code: string): Promise<void> {
    const currency = await this.prisma.currency.findFirst({
      where: { code, is_active: true },
      select: { code: true },
    });
    if (!currency) {
      throw new UnprocessableEntityException(`currency '${code}' is not a supported active currency`);
    }
  }
}
