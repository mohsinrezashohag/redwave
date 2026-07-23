/**
 * Backend bootstrap.
 *
 * Responsibility: start the NestJS HTTP server with URI versioning (all API routes under /v1), security
 * headers (helmet), cookie parsing, a global validation pipe, credentialed CORS, and — only when enabled —
 * Swagger UI at /docs (gated behind HTTP Basic in production). Health is version-neutral (/health). — arch §security
 */
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { buildOpenApiConfig } from './openapi';
import { ErrorEnvelopeDto } from './common/errors/error-envelope.dto';
import { ipOfRequest, runWithRequestContext } from './common/audit/request-context';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const isProd = process.env.NODE_ENV === 'production';

  // Behind Render/Vercel proxies — trust the first hop so req.ip / secure cookies resolve correctly.
  (app.getHttpAdapter().getInstance() as { set: (k: string, v: unknown) => void }).set('trust proxy', 1);

  // Security headers (HSTS in prod, clickjacking/X-Frame deny, no-sniff, referrer policy, a strict API CSP).
  // The API serves JSON, so the CSP is mostly belt-and-suspenders; the SPA's CSP lives in the host config
  // (frontend/vercel.json). — arch §security (headers)
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:'],
          'object-src': ["'none'"],
          'frame-ancestors': ["'none'"],
          ...(isProd ? { 'upgrade-insecure-requests': [] } : { 'upgrade-insecure-requests': null }),
        },
      },
      hsts: isProd ? { maxAge: 15_552_000, includeSubDomains: true, preload: false } : false,
      crossOriginEmbedderPolicy: false, // not needed for a JSON API; avoids breaking Swagger assets
    }),
  );

  // Parse cookies (the httpOnly refresh cookie + the readable CSRF cookie). — arch §security
  app.use(cookieParser());

  // Open a per-request context carrying the client IP so audit rows can stamp it. — arch §security (audit)
  app.use((req: Request, _res: Response, next: NextFunction) =>
    runWithRequestContext({ ip: ipOfRequest(req) }, () => next()),
  );

  // All API routes are served under /v1 (arch §5.1). Health stays version-neutral.
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // Validate + strip unknown properties on every request body. — arch §11 (validation)
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  // CORS — credentialed (the refresh cookie rides cross-site). In production set CORS_ORIGIN to a
  // comma-separated allowlist of frontend origins. Unset → permissive (dev only). — arch §11
  //
  // `Content-Disposition` MUST be exposed: the frontend is a different origin in production, and a browser
  // hides every response header from JS unless it is listed here. Without it the download helper cannot
  // read the filename the server sent and falls back to "download", so every statement / invoice / expense
  // document / export saves as `download (5).xlsx`. — arch §6.9
  const exposedHeaders = ['Content-Disposition'];
  const corsOrigin = process.env.CORS_ORIGIN;
  if (corsOrigin) {
    app.enableCors({ origin: corsOrigin.split(',').map((o) => o.trim()), credentials: true, exposedHeaders });
  } else {
    if (isProd) {
      console.warn('⚠️  CORS_ORIGIN is not set in production — refusing credentialed cross-site cookies may fail.');
    }
    app.enableCors({ credentials: true, origin: true, exposedHeaders });
  }

  // Swagger /docs — DISABLED in production unless ENABLE_SWAGGER=true, and then gated behind HTTP Basic
  // (SWAGGER_USER/SWAGGER_PASSWORD). Never expose the contract publicly. — arch §security (Swagger)
  const enableSwagger = !isProd || process.env.ENABLE_SWAGGER === 'true';
  if (enableSwagger) {
    const swaggerUser = process.env.SWAGGER_USER;
    const swaggerPassword = process.env.SWAGGER_PASSWORD;
    if (swaggerUser && swaggerPassword) {
      app.use(['/docs', '/docs-json'], basicAuth(swaggerUser, swaggerPassword));
    } else if (isProd) {
      console.warn('⚠️  ENABLE_SWAGGER=true in production WITHOUT SWAGGER_USER/PASSWORD — /docs is unauthenticated.');
    }
    // Swagger UI uses inline scripts/styles — relax the CSP on the /docs path only.
    app.use(
      '/docs',
      helmet.contentSecurityPolicy({
        useDefaults: true,
        directives: { 'script-src': ["'self'", "'unsafe-inline'"], 'style-src': ["'self'", "'unsafe-inline'"], 'img-src': ["'self'", 'data:'] },
      }),
    );
    const document = SwaggerModule.createDocument(app, buildOpenApiConfig(), {
      extraModels: [ErrorEnvelopeDto], // document the uniform error envelope in components.schemas (arch §5.1)
    });
    SwaggerModule.setup('docs', app, document);
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(
    `Redwave backend listening on http://localhost:${port}` +
      ` (docs: ${enableSwagger ? '/docs' : 'disabled'}, health: /health)`,
  );
}

/** Minimal HTTP Basic gate for the Swagger UI in production (no extra dependency). */
function basicAuth(user: string, pass: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (header?.startsWith('Basic ')) {
      const [u, p] = Buffer.from(header.slice(6), 'base64').toString().split(':');
      if (u === user && p === pass) {
        next();
        return;
      }
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="Redwave API docs"');
    res.status(401).send('Authentication required');
  };
}

void bootstrap();
