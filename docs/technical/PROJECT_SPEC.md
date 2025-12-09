# RWA TOKENIZATION PLATFORM - TECHNICAL DOCUMENTATION

## PROJECT OVERVIEW
Building a plug-and-play on-chain infrastructure that enables banks, asset managers, private credit funds, and real estate firms to seamlessly tokenize real-world assets (RWAs) with built-in compliance, custody, and settlement automation.

## CORE VALUE PROPOSITIONS
* Seamless Asset Onboarding: Upload traditional asset data and automatically convert to tokenized digital assets
* Instant Compliance: AI-powered KYC/AML and jurisdiction checks integrated into onboarding
* Trusted Custody: Direct API integrations with regulated custodians
* Near-Instant Settlement: Enable 24/7 settlement cutting intermediaries and costs
* Liquidity Access: Provide institutional investors access to private credit, Treasuries, and real estate through digital liquidity pools
* Transparency & Reporting: Automated real-time reporting dashboards with on-chain traceability
* Institutional-Grade Simplicity: Abstract all blockchain complexity

## TARGET CLIENTS
* Banks seeking faster settlement and digital asset exposure
* Asset Managers wanting to modernize private funds
* Private Credit & Real Estate Firms looking to unlock liquidity and fractionalize assets
* Family Offices & Institutional Investors wanting transparent, regulated access to RWAs

---

# 1. SMART CONTRACT ARCHITECTURE

## CORE CONTRACT HIERARCHY

### BaseToken Contract
- Abstract base implementing ERC-20 with compliance hooks

### SecurityToken Contract
- ERC-3643 compliant security token with transfer restrictions

### AssetVault Contract
- Manages underlying asset custody and oracle integration

### ComplianceModule
- Modular compliance rules (KYC, accreditation, jurisdiction)

### CorporateActions Contract
- Handles dividends, redemptions, and voting

### SettlementEngine
- Atomic DvP settlement with payment rails

---

## ASSET-SPECIFIC IMPLEMENTATIONS

### 3.1 US TREASURY TOKEN CONTRACT

**Purpose:** Tokenize fractional ownership of US Treasury securities with daily NAV updates

**Standard:** ERC-4626 (Tokenized Vault) with ERC-3643 compliance layer

**Valuation:** Chainlink oracle fetches daily Treasury prices from Bloomberg/Refinitiv

**Yield Distribution:** Automated monthly coupon distributions pro-rata to token holders

**Redemption:** Burn token → release proportional underlying + accrued interest

**Compliance:** Accredited investor only, US person restrictions, max 2000 holders (Reg D)

**Key Functions:**
```solidity
function mint(uint256 assets, address receiver) returns (uint256 shares)
// Deposits underlying Treasuries from custodian
// Mints proportional tokens to investor
// Emits Mint event for accounting

function distributeCoupon(uint256 totalYield) onlyOracle
// Called monthly by Chainlink Automation
// Allocates yield proportionally to all token holders
// Updates claimable balance mapping
```

---

### 3.2 PRIVATE CREDIT LOAN TOKEN CONTRACT

**Purpose:** Tokenize fractional ownership of individual loans or loan portfolios

**Standard:** ERC-1400 (Partially Fungible Token) with tranched risk profiles

**Loan Metadata:** Principal, interest rate, maturity, borrower (hashed), collateral type

**Payment Flow:** Borrower payments → Custodian → Smart contract → Token holders (waterfall)

**Default Handling:** Triggers liquidation workflow, distributes recovery proceeds to senior tranches first

**Compliance:** Qualified purchaser only ($5M+ assets), 3(c)(7) exemption, lock-up periods

**Key Functions:**
```solidity
function issueByPartition(bytes32 partition, address investor, uint256 value)
// Creates senior/junior tranches with different risk/return profiles
// Partition IDs: SENIOR_TRANCHE, JUNIOR_TRANCHE, MEZZANINE

function processPayment(uint256 principal, uint256 interest) onlyServicer
// Receives payment from loan servicer
// Applies waterfall: fees → senior interest → senior principal → junior interest → junior principal
```

---

### 3.3 REAL ESTATE PROPERTY TOKEN CONTRACT

**Purpose:** Fractional ownership of commercial/residential properties with rental income distribution

**Standard:** ERC-721 (NFT) representing whole property + ERC-20 for fractional shares

**Property Data:** Address, square footage, zoning, appraisal value, property manager contact

**Rental Income:** Monthly rent collected by property manager → net income distributed to token holders

**Governance:** Token holders vote on major decisions (sale, refinancing, CapEx >$50K)

**Compliance:** Accredited investor, max 35 non-accredited (Reg D 506(b)), state securities laws

**Key Functions:**
```solidity
function distributeRent(uint256 netIncome) onlyPropertyManager
// Called monthly after expenses deducted
// Pro-rata distribution to all token holders

function proposeGovernanceAction(bytes32 actionHash) returns (uint256 proposalId)
// Token holders propose major decisions
// Voting power = token balance, 51% approval required
```

---

## 4. COMPLIANCE MODULE ARCHITECTURE

### Modular Compliance System
Plug-and-play architecture allowing institutions to customize rules per asset class and jurisdiction without modifying core token contracts.

### Core Compliance Rules
* **Identity Verification:** KYC/AML checks via integration with Chainalysis, Elliptic
* **Accreditation:** Verify $200K+ income or $1M+ net worth (Reg D)
* **Qualified Purchaser:** Verify $5M+ investments (3(c)(7))
* **Jurisdiction:** Block sanctioned countries, restrict US persons if needed
* **Lock-up Periods:** Enforce minimum holding periods (6-24 months typical)
* **Investor Caps:** Limit to 2000 holders (public reporting trigger)

### Transfer Restriction Hook
```solidity
function canTransfer(address from, address to, uint256 amount) returns (bool, bytes32 reason)
// Called before every transfer
// Checks: sender/recipient whitelisted, lock-up expired, investor cap not exceeded, jurisdiction allowed
// Returns false + error code if any check fails
```

---

## 5. SETTLEMENT ENGINE

### Atomic DvP Settlement
Ensures simultaneous exchange of tokens and payment using atomic swaps or escrow-based settlement.

### Settlement Workflow
1. Buyer initiates purchase → payment locked in escrow (USDC/USDP)
2. Seller tokens also locked in escrow
3. Compliance checks executed
4. If all checks pass: simultaneous transfer of tokens + payment
5. If any check fails: refund both parties

**Key Function:**
```solidity
function executeSettlement(bytes32 tradeId) returns (bool success)
// Atomically transfers security tokens from seller to buyer AND payment from buyer to seller only if all conditions met
```

---

## 6. SECURITY & UPGRADEABILITY

### Security Best Practices
* **Multi-sig Administration:** 3-of-5 multi-sig for admin functions (pause, upgrade, whitelist)
* **Time-locked Upgrades:** 48-hour delay on contract upgrades for investor review
* **Circuit Breakers:** Pause transfers if oracle price deviation >5% or suspicious activity
* **Rate Limits:** Max 10% of total supply transferable per day per address
* **Formal Verification:** Critical functions (transfer, mint, burn) formally verified
* **Third-Party Audits:** Trail of Bits, OpenZeppelin, ConsenSys Diligence before mainnet

### Upgradeability Pattern
Uses OpenZeppelin Transparent Proxy pattern: immutable ProxyAdmin contract + upgradeable implementation. Storage layout preserved across upgrades to prevent data corruption.

---

## 7. TESTING & DEPLOYMENT STRATEGY

### Testing Phases
* **Phase 1 - Unit Testing:** 100% code coverage using Hardhat/Foundry
* **Phase 2 - Integration Testing:** Test oracle integrations, custodian APIs, payment rails
* **Phase 3 - Testnet Deployment:** 6-week testnet trial with pilot institutions (Goerli/Sepolia)
* **Phase 4 - Security Audits:** 3 independent audits + bug bounty program
* **Phase 5 - Mainnet Gradual Rollout:** Start with $10M TVL cap, increase after 90 days

### Deployment Checklist
* Multi-sig wallets created and secured (Gnosis Safe)
* Oracle nodes provisioned and funded
* Custodian API keys generated and tested
* Compliance module rules configured per jurisdiction
* Emergency contacts and incident response plan established
* Legal opinions obtained (securities law, tax treatment)

---

## 8. MONITORING & MAINTENANCE

### Ongoing Operations
* **Oracle Health:** Monitor price feed latency, deviation, and uptime
* **Gas Optimization:** Batch transactions during low-gas periods
* **Compliance Updates:** Quarterly review of regulatory changes, update rules
* **Incident Response:** 24/7 on-call for critical issues (oracle failure, exploit attempts)
* **Performance Metrics:** Track transfer success rate, settlement time, gas costs

---

# 2. API SPECIFICATIONS

## BASE URL
```
https://api.rwaplatform.io/v1
```

## AUTHENTICATION
All API requests require an API key passed in the Authorization header:
```
Authorization: Bearer YOUR_API_KEY
```

API keys are generated in the institutional dashboard and support role-based permissions (read-only, admin, compliance-officer).

## RATE LIMITING
* Standard tier: 100 requests per minute
* Enterprise tier: 1000 requests per minute

Rate limit headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset

## ERROR HANDLING
Standard HTTP status codes with JSON error responses:
```json
{
  "error": {
    "code": "INVALID_ASSET",
    "message": "Asset type not supported",
    "details": "Only TREASURY, PRIVATE_CREDIT, REAL_ESTATE allowed"
  }
}
```

---

## ASSET TOKENIZATION API

### Create Asset Token
```
POST /assets/tokenize
```

**Request Body:**
```json
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
  },
  "custody": {
    "custodian": "FIREBLOCKS",
    "vault_id": "abc123xyz",
    "attestation_doc_url": "https://..."
  }
}
```

**Response (201 Created):**
```json
{
  "asset_id": "ast_7h3kJ9mPqW2x",
  "token_address": "0x1234567890abcdef...",
  "status": "PENDING_DEPLOYMENT",
  "created_at": "2025-12-08T10:30:00Z",
  "estimated_deployment_time": 300
}
```

### Get Asset Details
```
GET /assets/{asset_id}
```

**Response (200 OK):**
```json
{
  "asset_id": "ast_7h3kJ9mPqW2x",
  "token_address": "0x1234567890abcdef...",
  "asset_type": "TREASURY",
  "status": "ACTIVE",
  "total_supply": "10000000.000000000000000000",
  "circulating_supply": "8500000.000000000000000000",
  "current_nav": 10425000.00,
  "nav_per_token": 1.0425,
  "investor_count": 127,
  "last_updated": "2025-12-08T15:45:00Z"
}
```

---

## INVESTOR MANAGEMENT API

### Onboard Investor
```
POST /investors/onboard
```

**Request Body:**
```json
{
  "investor_type": "INDIVIDUAL",
  "personal_info": {
    "first_name": "Jane",
    "last_name": "Smith",
    "email": "jane.smith@example.com",
    "phone": "+1-555-0123",
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
  "accreditation": {
    "status": "ACCREDITED",
    "verification_method": "INCOME",
    "verification_doc_url": "https://..."
  },
  "wallet_address": "0xabcdef1234567890..."
}
```

**Response (201 Created):**
```json
{
  "investor_id": "inv_9kL2mN4pR7s",
  "kyc_status": "PENDING_REVIEW",
  "aml_status": "SCREENING",
  "onboarding_stage": "DOCUMENT_VERIFICATION",
  "estimated_approval_time": 86400
}
```

---

## TOKEN TRANSFER & SETTLEMENT API

### Initiate Transfer
```
POST /transfers/initiate
```

**Request Body:**
```json
{
  "asset_id": "ast_7h3kJ9mPqW2x",
  "from_investor_id": "inv_seller123",
  "to_investor_id": "inv_buyer456",
  "amount": "1000.000000000000000000",
  "payment": {
    "currency": "USDC",
    "amount": 1042500.00,
    "payment_address": "0x789...",
    "settlement_type": "ATOMIC_DVP"
  },
  "settlement_date": "2025-12-10T14:00:00Z"
}
```

**Response (201 Created):**
```json
{
  "transfer_id": "txf_3j7KmN9qW2z",
  "status": "PENDING_COMPLIANCE",
  "compliance_checks": [
    {"check": "SENDER_WHITELISTED", "status": "PASSED"},
    {"check": "RECIPIENT_WHITELISTED", "status": "PASSED"},
    {"check": "LOCKUP_PERIOD", "status": "PASSED"},
    {"check": "INVESTOR_CAP", "status": "CHECKING"}
  ],
  "estimated_settlement_time": 3600
}
```

---

## CORPORATE ACTIONS API

### Declare Dividend
```
POST /assets/{asset_id}/corporate-actions/dividend
```

**Request Body:**
```json
{
  "amount_per_token": 0.0125,
  "total_distribution": 125000.00,
  "currency": "USDC",
  "ex_dividend_date": "2025-12-15",
  "payment_date": "2025-12-20",
  "record_date": "2025-12-16"
}
```

---

## REPORTING & ANALYTICS API

### Get Portfolio Summary
```
GET /investors/{investor_id}/portfolio
```

**Response (200 OK):**
```json
{
  "investor_id": "inv_9kL2mN4pR7s",
  "total_value_usd": 1250000.00,
  "total_assets": 3,
  "holdings": [
    {
      "asset_id": "ast_7h3kJ9mPqW2x",
      "asset_name": "US Treasury 4.25% 2026",
      "balance": "500000.000000000000000000",
      "current_value": 521250.00,
      "unrealized_gain": 21250.00,
      "yield_earned": 3125.00
    }
  ]
}
```

---

## WEBHOOKS

### Webhook Events
* **asset.deployed:** Token contract deployed to blockchain
* **investor.kyc_approved:** Investor passed KYC verification
* **transfer.settled:** Token transfer completed on-chain
* **corporate_action.processed:** Dividend or redemption executed
* **compliance.violation:** Attempted unauthorized transfer

**Webhook Payload Example:**
```json
{
  "event_type": "transfer.settled",
  "event_id": "evt_4k8MnP2qX5y",
  "timestamp": "2025-12-10T14:00:32Z",
  "data": {
    "transfer_id": "txf_3j7KmN9qW2z",
    "asset_id": "ast_7h3kJ9mPqW2x",
    "from": "inv_seller123",
    "to": "inv_buyer456",
    "amount": "1000.000000000000000000",
    "transaction_hash": "0xabc123def456..."
  }
}
```

---

## INTEGRATION PARTNERS

### Custody & Banking
* **Fireblocks:** Institutional MPC wallet infrastructure
* **Anchorage Digital:** Federally chartered crypto bank
* **BitGo:** Regulated custody with insurance
* **BNY Mellon/State Street:** Traditional custody integration

### Compliance & Identity
* **Chainalysis:** Transaction monitoring and sanctions screening
* **Elliptic:** Risk scoring and AML compliance
* **Onfido/Jumio:** Identity verification
* **ComplyAdvantage:** KYC/AML data provider

### Oracles & Data
* **Chainlink:** Decentralized oracle for asset pricing
* **API3:** First-party oracle for institutional data feeds
* **Pyth Network:** High-frequency financial data
* **Proof of Reserves:** Real-time custody verification

### Payment Rails
* **Circle (USDC):** Stablecoin settlement
* **Paxos (USDP):** Regulated stablecoin
* **JP Morgan Onyx:** Tokenized deposits for banks
* **Traditional wire:** Fiat on/off-ramp integration

---

Save this as `PROJECT_SPEC.md` in your repo root so Claude Code agent can reference it!

