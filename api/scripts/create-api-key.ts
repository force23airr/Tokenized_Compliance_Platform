/**
 * Create a test API key
 * Run with: npx tsx scripts/create-api-key.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const apiKey = await prisma.apiKey.create({
    data: {
      key: 'test_rwa_dev_key_' + Math.random().toString(36).substring(7),
      name: 'Development Test Key',
      permissions: ['*'], // All permissions
      active: true,
    },
  });

  console.log('\n✅ API Key created successfully!\n');
  console.log('━'.repeat(60));
  console.log(`Key ID:       ${apiKey.id}`);
  console.log(`Key:          ${apiKey.key}`);
  console.log(`Name:         ${apiKey.name}`);
  console.log(`Permissions:  ${JSON.stringify(apiKey.permissions)}`);
  console.log(`Active:       ${apiKey.active}`);
  console.log('━'.repeat(60));
  console.log('\nUse this key in the Authorization header:');
  console.log(`Authorization: Bearer ${apiKey.key}\n`);
}

main()
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
