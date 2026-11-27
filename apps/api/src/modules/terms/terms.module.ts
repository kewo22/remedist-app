import { Module } from '@nestjs/common';
import { AdminTermsController, PortalTermsController, PublicTermsController } from './terms.controller';
import { TermsRepository } from './terms.repository';
import { TermsService } from './terms.service';

/** Terms & Conditions versions and client consent. Exports TermsService for Part 1 and booking. */
@Module({
  controllers: [PublicTermsController, PortalTermsController, AdminTermsController],
  providers: [TermsRepository, TermsService],
  exports: [TermsService],
})
export class TermsModule {}
