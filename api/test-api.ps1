# Test RWA API - PowerShell Script
# Run with: .\test-api.ps1

$API_KEY = "test_rwa_dev_key_a0vjfo"  # Replace with your actual key
$BASE_URL = "http://localhost:3000/v1"

Write-Host "`n🚀 Testing RWA Tokenization API`n" -ForegroundColor Cyan

# Test 1: Create a Treasury Token
Write-Host "1️⃣  Creating US Treasury Token..." -ForegroundColor Yellow

$tokenPayload = @{
    asset_type = "TREASURY"
    asset_details = @{
        cusip = "912828YK0"
        face_value = 10000000
        maturity_date = "2026-12-31"
        coupon_rate = 0.0425
    }
    token_config = @{
        name = "US Treasury 4.25% 2026"
        symbol = "UST-425-26"
        total_supply = 10000000
        decimals = 18
        blockchain = "ETHEREUM"
    }
    compliance_rules = @{
        accredited_only = $true
        max_investors = 2000
        lockup_period_days = 180
        allowed_jurisdictions = @("US", "UK", "SG")
    }
} | ConvertTo-Json -Depth 10

try {
    $response = Invoke-RestMethod `
        -Uri "$BASE_URL/tokens/create" `
        -Method POST `
        -Headers @{
            "Authorization" = "Bearer $API_KEY"
            "Content-Type" = "application/json"
        } `
        -Body $tokenPayload

    Write-Host "✅ Token created!" -ForegroundColor Green
    Write-Host "   Token ID: $($response.token_id)" -ForegroundColor White
    Write-Host "   Status: $($response.status)" -ForegroundColor White
    Write-Host "   Blockchain: $($response.blockchain)" -ForegroundColor White

    $TOKEN_ID = $response.token_id

    # Test 2: Get Token Details
    Write-Host "`n2️⃣  Fetching token details..." -ForegroundColor Yellow

    $tokenDetails = Invoke-RestMethod `
        -Uri "$BASE_URL/tokens/$TOKEN_ID" `
        -Method GET `
        -Headers @{
            "Authorization" = "Bearer $API_KEY"
        }

    Write-Host "✅ Token retrieved!" -ForegroundColor Green
    Write-Host "   Name: $($tokenDetails.name)" -ForegroundColor White
    Write-Host "   Symbol: $($tokenDetails.symbol)" -ForegroundColor White
    Write-Host "   Total Supply: $($tokenDetails.total_supply)" -ForegroundColor White

    Write-Host "`n🎉 API is working perfectly!`n" -ForegroundColor Green

} catch {
    Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "`nResponse:" -ForegroundColor Yellow
    Write-Host $_.ErrorDetails.Message
}
