// Pure business rules shared by the API and the web app: no Nest, no React, no database.
// Add one file per rule group (for example pricing.ts) and re-export it here.

export * from './availability';
export * from './client-account';
export * from './clinic-time';
export * from './contact';
export * from './date-time';
export * from './phone';
export * from './pricing';
