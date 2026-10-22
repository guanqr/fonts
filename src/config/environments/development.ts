// Development environment configuration
import type { EnvironmentConfig } from '@/types/config.js';

export const developmentConfig: EnvironmentConfig = {
  logging: {
    level: 'debug',
    colorize: true,
    timestamps: true,
  },

  cache: {
    enabled: true,
    ttl: 3600, // 1 hour in development
  },

  download: {
    retries: 2,
    timeout: 120000, // 2 minutes
  },

  processing: {
    skipExisting: true,
    validateOutput: true,
  },
};
