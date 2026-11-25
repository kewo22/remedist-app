import { Global, Module } from '@nestjs/common';
import { AppConfig, getAppConfig } from './app-config';

// Global so any provider can inject AppConfig without importing this module.
@Global()
@Module({
  providers: [{ provide: AppConfig, useFactory: getAppConfig }],
  exports: [AppConfig],
})
export class ConfigModule {}
