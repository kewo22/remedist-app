import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { createLogger } from './common/logging/create-logger';
import { requestLoggingMiddleware } from './common/logging/request-logging.middleware';
import { ConfigValidationError, getAppConfig } from './config/app-config';

const API_PREFIX = 'api/v1';

async function bootstrap(): Promise<void> {
  // Validate settings before anything else, so a bad .env fails fast with a clear list.
  const config = getAppConfig();

  const app = await NestFactory.create(AppModule, { logger: createLogger(config) });

  // First middleware, so every request (including 404s and body-parser errors) gets an ID and a log line.
  app.use(requestLoggingMiddleware);

  // /health stays outside the versioned prefix so Railway can probe it directly.
  app.setGlobalPrefix(API_PREFIX, { exclude: ['health'] });
  app.enableCors({ origin: config.webUrl, credentials: true });
  app.enableShutdownHooks();

  await app.listen(config.port);
  Logger.log(`API listening on port ${config.port} (${config.nodeEnv}), prefix /${API_PREFIX}`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  if (error instanceof ConfigValidationError) {
    // Nest's logger isn't set up yet; print the list plainly. It names variables, never values.
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exit(1);
});
