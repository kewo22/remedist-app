import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';

// Global so every domain repository can inject DatabaseService without re-importing the module.
@Global()
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
