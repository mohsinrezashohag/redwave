/**
 * DocumentReaderService — reads an ID document (passport, PR card, permit, driver's licence) with Google
 * Gemini and returns what it found as SUGGESTIONS for HR to confirm (client request 2026-11-12). Nothing it
 * returns is stored: only the dates HR confirms are saved, through the normal upload / PATCH.
 *
 * Privacy: the file goes to Gemini only (use a PAID API key — paid-tier data is not used for training;
 * docs/security.md). Nothing read here is logged. Env-gated on GEMINI_API_KEY (no key → 503, the UI falls
 * back to typing the dates). The model is told to return null rather than guess, and every date it returns
 * is re-validated (id-document.logic) — an unreadable value is dropped, never repaired.
 */
import { Injectable, Logger, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI, Type } from '@google/genai';
import { cleanDate, type ReadDocument } from './id-document.logic';

const TIMEOUT_MS = 20_000;
const DEFAULT_MODEL = 'gemini-2.5-flash';
/** Inline requests are capped by the API; larger files are typed by hand. */
export const MAX_READ_BYTES = 15 * 1024 * 1024;
const READABLE = /^(application\/pdf|image\/(png|jpe?g|webp))$/;

const DOC_NAMES: Record<string, string> = {
  passport: 'passport',
  pr_card: 'Canadian permanent resident card',
  work_permit: 'work permit',
  study_permit: 'study permit',
  drivers_licence: "driver's licence",
};

const INSTRUCTION = [
  'You read identity documents for an HR team. Report ONLY what is printed on the document.',
  'Return dates as YYYY-MM-DD. If a value is missing, unreadable or you are not sure, return null for it.',
  'Never guess, estimate or invent a value. Do not compute dates.',
  'issued_on = date of issue. expires_on = date of expiry / valid until.',
  'full_name = the holder’s full name as printed.',
  'mrz_lines = the machine-readable zone lines exactly as printed (with < characters), or an empty list.',
].join('\n');

@Injectable()
export class DocumentReaderService {
  private readonly logger = new Logger(DocumentReaderService.name);

  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean {
    return !!this.config.get<string>('GEMINI_API_KEY');
  }

  async read(buffer: Buffer, mimetype: string, docType: string): Promise<ReadDocument> {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (!apiKey) throw new ServiceUnavailableException('Document reading isn’t set up. Enter the dates by hand.');
    if (!READABLE.test(mimetype)) throw new UnprocessableEntityException('Only a PDF or a photo can be read.');
    if (buffer.length > MAX_READ_BYTES) throw new UnprocessableEntityException('This file is too large to read. Enter the dates by hand.');

    const model = this.config.get<string>('DOC_READER_MODEL') || DEFAULT_MODEL;
    const kind = DOC_NAMES[docType] ?? 'identity document';
    try {
      const ai = new GoogleGenAI({ apiKey });
      const call = ai.models.generateContent({
        model,
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType: mimetype, data: buffer.toString('base64') } },
              { text: `This should be a ${kind}. Read it.` },
            ],
          },
        ],
        config: {
          systemInstruction: INSTRUCTION,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              full_name: { type: Type.STRING, nullable: true },
              issued_on: { type: Type.STRING, nullable: true },
              expires_on: { type: Type.STRING, nullable: true },
              mrz_lines: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
          },
        },
      });
      call.catch(() => undefined); // the loser of the timeout race must not become an unhandled rejection
      const response = await withTimeout(call, TIMEOUT_MS);
      return parseReadJson(response.text ?? '');
    } catch (e) {
      // Never log the document or what was read; the error kind is enough.
      this.logger.warn(`Document read failed: ${(e as Error).name}`);
      throw new UnprocessableEntityException('Couldn’t read this document. Enter the dates by hand.');
    }
  }
}

/** The model's JSON → a ReadDocument; anything malformed becomes null (exported for the spec). */
export function parseReadJson(text: string): ReadDocument {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error('not json');
  }
  const name = typeof raw.full_name === 'string' && raw.full_name.trim() ? raw.full_name.trim().slice(0, 200) : null;
  const mrz = Array.isArray(raw.mrz_lines)
    ? raw.mrz_lines.filter((l): l is string => typeof l === 'string').slice(0, 3).map((l) => l.slice(0, 60))
    : null;
  return {
    name_on_document: name,
    issued_on: cleanDate(raw.issued_on),
    expires_on: cleanDate(raw.expires_on),
    mrz_lines: mrz && mrz.length > 0 ? mrz : null,
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}
