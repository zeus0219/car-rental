import { defineConfig } from 'prisma';

export default defineConfig({
  seed: 'tsx ./prisma/seed.ts',
});
