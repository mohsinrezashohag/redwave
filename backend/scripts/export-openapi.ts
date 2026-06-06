/**
 * export-openapi — builds the Nest app (without listening), generates the OpenAPI document,
 * and writes it to contract/openapi.yaml (the committed source of truth). — arch §5/§8
 *
 * Run with: `npm run contract:export`. No database connection is required (Prisma connects lazily).
 */
import { NestFactory } from '@nestjs/core';
import { VersioningType } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { stringify } from 'yaml';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { AppModule } from '../src/app.module';
import { buildOpenApiConfig } from '../src/openapi';
import { ErrorEnvelopeDto } from '../src/common/errors/error-envelope.dto';

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  const document = SwaggerModule.createDocument(app, buildOpenApiConfig(), {
    extraModels: [ErrorEnvelopeDto], // document the uniform error envelope in components.schemas (arch §5.1)
  });
  const target = join(__dirname, '..', '..', 'contract', 'openapi.yaml');
  writeFileSync(target, stringify(document), 'utf8');

  await app.close();
  console.log(`Wrote OpenAPI spec (${Object.keys(document.paths).length} paths) to ${target}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
