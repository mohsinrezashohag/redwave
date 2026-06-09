import { Global, Module } from '@nestjs/common';
import { NOTIFICATION_EMITTER } from '../../common/notifications/notification-emitter';
import { NotificationsService } from './notifications.service';
import { NotificationEmitterAdapter } from './notification-emitter.adapter';
import { EMAIL_DISPATCHER, NoopEmailDispatcher } from './seams/email-dispatcher.provider';

/**
 * NotificationsModule — owns notification generation + settings + the email-dispatch stub, and SUPPLIES the
 * app-wide `NOTIFICATION_EMITTER` binding. Marked @Global so ANY domain module can inject the emitter (and
 * use NotificationsService) WITHOUT importing this module and WITHOUT a cycle — it imports nothing
 * domain-specific (Prisma/Audit are global; EMAIL_DISPATCHER is local). — RPT-009/010, arch §9
 */
@Global()
@Module({
  providers: [
    NotificationsService,
    { provide: EMAIL_DISPATCHER, useClass: NoopEmailDispatcher },
    { provide: NOTIFICATION_EMITTER, useClass: NotificationEmitterAdapter },
  ],
  exports: [NotificationsService, NOTIFICATION_EMITTER],
})
export class NotificationsModule {}
