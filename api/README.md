# RWA Tokenization Platform - REST API

Stripe-style infrastructure API for tokenizing real-world assets.

## Quick Start

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your configuration

# Set up database
npm run db:push

# Start development server
npm run dev
```

## API Endpoints

### Authentication
All requests require an API key in the Authorization header:
```
Authorization: Bearer YOUR_API_KEY
```

### Tokens

**Create Token**
```http
POST /v1/tokens/create
Content-Type: application/json

{
  "asset_type": "TREASURY",
  "asset_details": {
    "cusip": "912828YK0",
    "face_value": 10000000,
    "maturity_date": "2026-12-31",
    "coupon_rate": 0.0425
  },
  "token_config": {
    "name": "US Treasury 4.25% 2026",
    "symbol": "UST-425-26",
    "total_supply": 10000000,
    "decimals": 18,
    "blockchain": "ETHEREUM"
  },
  "compliance_rules": {
    "accredited_only": true,
    "max_investors": 2000,
    "lockup_period_days": 180,
    "allowed_jurisdictions": ["US", "UK", "SG"]
  }
}
```

**Response:**
```json
{
  "token_id": "tok_abc123",
  "contract_address": "0x742d35Cc...",
  "status": "deployed",
  "blockchain": "ethereum",
  "created_at": "2025-12-09T10:30:00Z",
  "estimated_deployment_time": 300
}
```

### Investors

**Verify Investor**
```http
POST /v1/investors/verify
Content-Type: application/json

{
  "investor_type": "individual",
  "personal_info": {
    "first_name": "Jane",
    "last_name": "Smith",
    "email": "jane.smith@example.com",
    "date_of_birth": "1985-03-15",
    "ssn_last4": "5678"
  },
  "address": {
    "street": "123 Main St",
    "city": "New York",
    "state": "NY",
    "postal_code": "10001",
    "country": "US"
  },
  "wallet_address": "0xabcdef1234567890..."
}
```

### Transfers

**Initiate Transfer**
```http
POST /v1/transfers/initiate
Content-Type: application/json

{
  "token_id": "tok_abc123",
  "from_investor_id": "inv_seller123",
  "to_investor_id": "inv_buyer456",
  "amount": "1000000000000000000000",
  "payment": {
    "currency": "USDC",
    "amount": 1042500.00,
    "payment_address": "0x789...",
    "settlement_type": "ATOMIC_DVP"
  }
}
```

## Database Schema

Uses PostgreSQL with Prisma ORM.

```bash
# Generate Prisma client
npm run db:generate

# Create migration
npm run db:migrate

# Push schema to database (development)
npm run db:push
```

## Architecture

```
api/
├── src/
│   ├── index.ts              # Express server
│   ├── config/               # Configuration
│   ├── controllers/          # Route handlers
│   ├── middleware/           # Auth, rate limiting, error handling
│   ├── routes/               # API routes
│   ├── services/             # Business logic
│   │   ├── blockchain.ts     # Ethers.js integration
│   │   ├── aiCompliance.ts   # AI compliance engine
│   │   └── compliance.ts     # AML/KYC checks
│   └── utils/                # Utilities
└── prisma/
    └── schema.prisma         # Database schema
```

## Rate Limits

- Standard tier: 100 requests per minute
- Enterprise tier: 1000 requests per minute

## Error Codes

| Code | Description |
|------|-------------|
| `UNAUTHORIZED` | Missing or invalid API key |
| `FORBIDDEN` | Insufficient permissions |
| `TOKEN_NOT_FOUND` | Token does not exist |
| `INVESTOR_NOT_FOUND` | Investor does not exist |
| `VALIDATION_ERROR` | Invalid request data |
| `COMPLIANCE_VIOLATION` | Transfer violates compliance rules |
| `RATE_LIMIT_EXCEEDED` | Too many requests |

## Development

```bash
# Run tests
npm test

# Lint code
npm run lint

# Build for production
npm run build

# Start production server
npm start
```

## Production Deployment

1. Set up PostgreSQL database
2. Set up Redis for rate limiting
3. Configure environment variables
4. Run database migrations
5. Deploy to your infrastructure (AWS, GCP, etc.)

```bash
npm run build
npm start
```

## Support

- Documentation: https://docs.rwaplatform.io
- GitHub: https://github.com/your-org/rwa-platform
- Email: support@rwaplatform.io
