// Environment configuration loader
import type { EnvironmentConfig } from '@/types/config.js';
import { developmentConfig } from '@/config/environments/development.js';
import { productionConfig } from '@/config/environments/production.js';

export { developmentConfig, productionConfig };

export function getEnvironmentConfig(env?: string): EnvironmentConfig {
  const environment =
    env ??
    process.env.NODE_ENV ??
    (process.env.CI ? 'production' : 'development');

  switch (environment.toLowerCase()) {
    case 'production':
    case 'prod':
      return productionConfig;
    case 'development':
    case 'dev':
    default:
      return developmentConfig;
  }
}
