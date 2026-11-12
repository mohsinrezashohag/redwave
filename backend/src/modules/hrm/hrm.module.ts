import { Module } from '@nestjs/common';
import { StorageModule } from '../../common/storage/storage.module';
import { RepsController } from './reps.controller';
import { EquipmentController } from './equipment.controller';
import { MyRepProfileController } from './my-rep-profile.controller';
import { RepsService } from './reps.service';
import { RepDocumentsService } from './rep-documents.service';
import { RepEquipmentService } from './rep-equipment.service';
import { DocumentReaderService } from './document-reader.service';

@Module({
  imports: [StorageModule],
  controllers: [RepsController, EquipmentController, MyRepProfileController],
  providers: [RepsService, RepDocumentsService, RepEquipmentService, DocumentReaderService],
  exports: [RepsService, RepDocumentsService, RepEquipmentService],
})
export class HrmModule {}
