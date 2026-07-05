/**
 * FxRateService — the daily FX rate source for the stored-FX money model. Env-gated + graceful, mirroring
 * MapsService: when `FX_RATE_SOURCE=bank_of_canada` it fetches the Bank of Canada Valet API (public, no
 * key) for the currency→CAD rate on a date; otherwise (or on ANY error: network / non-OK / timeout / no
 * observation) it returns null so the caller falls back to a manual/approver-supplied rate — it NEVER
 * throws and never blocks. CAD→CAD is always 1 (no fetch). The rate returned here is only a SUGGESTION;
 * the confirmed rate (override → this → 422) is what the caller freezes. — CLAUDE §3 #12, SRS EXP-014
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Decimal } from 'decimal.js';

const VALET_BASE = 'https://www.bankofcanada.ca/valet/observations';
const DEFAULT_TIMEOUT_MS = 8_000;
const LOOKBACK_DAYS = 10; // markets close weekends/holidays → take the most recent observation on/before the date

interface ValetObservation {
  d?: string; // date
  [series: string]: { v?: string } | string | undefined;
}
interface ValetResponse {
  observations?: ValetObservation[];
}

@Injectable()
export class FxRateService {
  private readonly logger = new Logger(FxRateService.name);

  constructor(private readonly config: ConfigService) {}

  /** True when auto FX (Bank of Canada Valet) is enabled; else the caller uses a manual/override rate. */
  isAutoEnabled(): boolean {
    return this.config.get<string>('FX_RATE_SOURCE') === 'bank_of_canada';
  }

  /**
   * The rate to convert `from` → CAD on `date`. CAD → 1 (no fetch). Returns null when auto FX is disabled
   * or the lookup fails (so the caller falls back to a manual override, or rejects a foreign record). The
   * Valet series is FX{FROM}CAD (e.g. FXUSDCAD); we take the most recent observation on/before `date`.
   */
  async getRateToCad(from: string, date: Date): Promise<Decimal | null> {
    if (from === 'CAD') return new Decimal(1);
    if (!this.isAutoEnabled()) return null;

    const series = `FX${from}CAD`;
    const start = isoDate(minusDays(date, LOOKBACK_DAYS));
    const end = isoDate(date);
    const url = `${VALET_BASE}/${series}/json?start_date=${start}&end_date=${end}`;
    const timeoutMs = Number(this.config.get<string>('FX_HTTP_TIMEOUT_MS')) || DEFAULT_TIMEOUT_MS;

    try {
      const res = await withTimeout(fetch(url), timeoutMs);
      if (!res.ok) return null;
      const body = (await res.json()) as ValetResponse;
      const observations = body.observations ?? [];
      // Ascending by date → scan from the end for the most recent non-empty value on/before `date`.
      for (let i = observations.length - 1; i >= 0; i -= 1) {
        const cell = observations[i]?.[series];
        const value = typeof cell === 'object' && cell ? cell.v : undefined;
        if (value != null && value !== '') return new Decimal(value);
      }
      return null;
    } catch (err) {
      this.logger.warn(`FX lookup ${series} failed; caller falls back to manual: ${(err as Error).message}`);
      return null;
    }
  }
}

/** UTC date-only 'YYYY-MM-DD'. */
function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function minusDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

/** Reject after `ms` so a slow/hung Valet call can never block the request. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('fx-timeout')), ms);
    p.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error as Error);
      },
    );
  });
}
