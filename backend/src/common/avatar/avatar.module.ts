/** AvatarModule — AvatarService app-wide (@Global): every module that returns a user's photo uses it. */
import { Global, Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { AvatarService } from './avatar.service';

@Global()
@Module({
  imports: [StorageModule],
  providers: [AvatarService],
  exports: [AvatarService],
})
export class AvatarModule {}
