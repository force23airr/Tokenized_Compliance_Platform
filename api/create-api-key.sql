-- Create a test API key
-- Run this in your Neon SQL Editor or via Prisma Studio

INSERT INTO "ApiKey" (
  id,
  key,
  name,
  permissions,
  active,
  "createdAt"
) VALUES (
  gen_random_uuid(),
  'test_rwa_dev_key_12345',
  'Development Test Key',
  '["*"]'::jsonb,
  true,
  NOW()
);

-- Check it was created
SELECT * FROM "ApiKey";
