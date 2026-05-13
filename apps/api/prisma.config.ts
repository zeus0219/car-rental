import { defineConfig } from '@prisma/internals';

export default defineConfig({
  seed: 'tsx ./prisma/seed.ts',
});
