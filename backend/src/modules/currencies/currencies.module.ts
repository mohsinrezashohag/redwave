/**
 * CurrenciesModule — the currency catalogue read surface + the assertSupported check (reused by Clients to
 * validate a billing currency). — Meeting 3, CLAUDE §3 #12
 */
import { Module } from '@nestjs/common';
import { CurrenciesController } from './currencies.controller';
import { CurrenciesService } from './currencies.service';

@Module({
  controllers: [CurrenciesController],
  providers: [CurrenciesService],
  exports: [CurrenciesService],
})
export class CurrenciesModule {}
