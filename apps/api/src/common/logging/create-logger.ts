import { ConsoleLogger } from '@nestjs/common';
import { AppConfig, enabledLogLevels } from '../../config/app-config';

/**
 * Nest's built-in logger: one JSON object per line in production (Railway's log viewer
 * parses it), coloured text locally. LOG_LEVEL picks the lowest level printed.
 */
export function createLogger(config: AppConfig): ConsoleLogger {
  return new ConsoleLogger({
    json: config.isProduction,
    colors: !config.isProduction,
    logLevels: enabledLogLevels(config.logLevel),
  });
}
