// English fonts configuration (placeholder for future expansion)
import type { FontConfig } from '@/types/config.js';

export const englishFonts: Record<string, FontConfig> = {
  // Placeholder for future English fonts
  // Example:
  // roboto: {
  //   name: 'Roboto',
  //   displayName: 'Roboto',
  //   source: { ... },
  //   license: { ... },
  //   ...
  // }
  jetbrainsmono: {
    name: 'JetBrainsMono',
    displayName: 'JetBrains Mono',
    source: {
      type: 'github-repo',
      owner: 'JetBrains',
      repo: 'JetBrainsMono',
      filePattern: 'fonts/ttf/JetBrainsMono-Regular.ttf',
      url: 'https://github.com/JetBrains/JetBrainsMono',
    },
    license: {
      type: 'SIL Open Font License 1.1',
      url: 'https://github.com/JetBrains/JetBrainsMono/blob/master/OFL.txt',
    },
    weight: 400,
    style: 'normal',
    subset: {
      type: 'size-based-chunks',
    },
    css: {
      srcFormat: "url('../fonts/{fontId}/{filename}') format('woff2')",
    },
  },
};
