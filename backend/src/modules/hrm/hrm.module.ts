import { Module } from '@nestjs/common';
import { StorageModule } from '../../common/storage/storage.module';
import { RepsController } from './reps.controller';
import { EquipmentController } from './equipment.controller';
import { MyRepProfileController } from './my-rep-profile.controller';
import { RepsService } from './reps.service';
import { RepDocumentsService } from './rep-documents.service';
import { RepEquipmentService } from './rep-equipment.service';
import { DocumentReaderService } from './document-reader.service';
import { RepDocumentPurgeService } from './rep-document-purge.service';
import { RepPhotosService } from './rep-photos.service';
import { BirthdayService } from './birthday.service';

@Module({
  imports: [StorageModule],
  controllers: [RepsController, EquipmentController, MyRepProfileController],
  providers: [
    RepsService,
    RepDocumentsService,
    RepEquipmentService,
    DocumentReaderService,
    RepDocumentPurgeService,
    RepPhotosService,
    BirthdayService,
  ],
  exports: [RepsService, RepDocumentsService, RepEquipmentService, RepDocumentPurgeService, BirthdayService],
})
export class HrmModule {}
