# Development Setup Guide

## Quick Start (Without Redis)

If you don't have Redis installed, you can use the mock queue for development:

```bash
# 1. Copy environment file
cp .env.example .env

# 2. Edit .env and set:
USE_MOCK_QUEUE=true

# 3. Install dependencies
npm install

# 4. Set up database
npx prisma db push

# 5. Start dev server
npm run dev
```

The API will work without Redis, but jobs run in-memory (not persisted).

---

## Full Setup (With Redis)

### Option 1: Install Redis on Windows

**Using Chocolatey:**
```powershell
choco install redis-64
redis-server
```

**Using Memurai (Redis for Windows):**
1. Download from https://www.memurai.com/
2. Install and start Memurai service
3. It runs on `localhost:6379` by default

**Manual Installation:**
1. Download from https://github.com/microsoftarchive/redis/releases
2. Install `Redis-x64-3.0.504.msi`
3. Start Redis service from Services

### Option 2: Use Docker (if you have it)

```bash
docker run -d -p 6379:6379 redis
```

### Option 3: Use WSL2 + Redis

```bash
# In WSL2
sudo apt-get update
sudo apt-get install redis-server
redis-server
```

Then in `.env`:
```
REDIS_URL=redis://localhost:6379
USE_MOCK_QUEUE=false
```

---

## Database Setup

### PostgreSQL

**Option 1: Local PostgreSQL**
```powershell
# Using Chocolatey
choco install postgresql

# Or download from https://www.postgresql.org/download/windows/
```

**Option 2: Docker**
```bash
docker run -d \
  -p 5432:5432 \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=rwa_platform \
  postgres:15
```

**Option 3: Cloud (Neon, Supabase)**
- Get free PostgreSQL at https://neon.tech or https://supabase.com
- Copy DATABASE_URL to `.env`

Then run migrations:
```bash
npx prisma db push
```

---

## Blockchain RPC

For testnet development, get free RPC URLs:

**Sepolia (Ethereum testnet):**
- Infura: https://infura.io (free tier)
- Alchemy: https://alchemy.com (free tier)

Add to `.env`:
```
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
```

---

## AI Compliance Engine

The AI compliance service is optional for development. The API has fallback logic.

To use it:
```bash
cd ../ai
pip install -r requirements.txt
python inference/api/compliance_api.py
```

Or set in `.env`:
```
AI_COMPLIANCE_API_URL=http://localhost:8000
```

---

## Running the API

### Development Mode
```bash
npm run dev
```

### Production Build
```bash
npm run build
npm start
```

### Run Workers Separately
```bash
# Terminal 1: API only
npm run dev

# Terminal 2: Workers only
npm run workers
```

---

## Testing

```bash
# Health check
curl http://localhost:3000/health

# Detailed health (with dependencies)
curl http://localhost:3000/health/detailed

# Metrics
curl http://localhost:3000/metrics
```

---

## Troubleshooting

### "Redis connection failed"
Set `USE_MOCK_QUEUE=true` in `.env`

### "Database connection failed"
Check `DATABASE_URL` in `.env` is correct

### "Port 3000 already in use"
Change `PORT=3001` in `.env`

### "Prisma client not generated"
Run `npx prisma generate`

---

## Next Steps

1. Create an API key in the database
2. Test `/v1/tokens/create` endpoint
3. Deploy a test token to Sepolia
4. Onboard a test investor
5. Initiate a test transfer

See main `README.md` for API documentation.
