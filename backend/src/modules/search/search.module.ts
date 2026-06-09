/**
 * SearchModule — the global top-bar search. PrismaService + ScopeService are @Global, so no extra imports.
 */
import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
