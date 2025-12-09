# Regulator Portal

Read-only dashboard for regulatory oversight.

## Access Control

- Regulator authentication via dedicated credentials
- IP whitelisting for regulatory agencies
- Audit log of all regulator access
- No write permissions - observation only

## Views

### Cap Table View
- Real-time investor count
- Distribution by investor type (accredited, qualified purchaser, institutional)
- Geographic distribution
- Concentration analysis

### Transfer History
- All token transfers with timestamps
- Compliance check results
- Failed transfer attempts with reasons
- Suspicious activity flags

### Compliance Reports
- Form D filings (automated)
- Blue sky notice filings
- AML/KYC summary statistics
- Investor verification status

### Alerts
- Investor cap approaching (e.g., 1800/2000)
- Failed compliance checks
- Unusual transfer patterns
- Geographic concentration changes

## Technical Implementation

**Backend:** Node.js API with read-only database replica
**Frontend:** React dashboard with role-based access
**Data Refresh:** Real-time via WebSocket for critical metrics, hourly for reports
