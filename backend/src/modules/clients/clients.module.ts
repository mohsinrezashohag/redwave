import { Module } from '@nestjs/common';
import { CurrenciesModule } from '../currencies/currencies.module';
import { ClientsController } from './clients.controller';
import { ProductsController } from './products.controller';
import { ClientsService } from './clients.service';
import { ProductsService } from './products.service';
import { BillingRatesService } from './billing-rates.service';

@Module({
  imports: [CurrenciesModule],
  controllers: [ClientsController, ProductsController],
  providers: [ClientsService, ProductsService, BillingRatesService],
  exports: [ClientsService, ProductsService, BillingRatesService],
})
export class ClientsModule {}
