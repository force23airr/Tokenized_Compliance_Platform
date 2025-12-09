# Test Sandbox Routes - PowerShell Script
# Run with: .\test-sandbox.ps1

$API_KEY = "test_rwa_dev_key_a0vjfo"
$BASE_URL = "http://localhost:3000/v1"

Write-Host ""
Write-Host "Testing RWA API Sandbox Routes" -ForegroundColor Cyan
Write-Host ""

# Test 1: Get Sandbox Examples
Write-Host "1. Getting sandbox examples..." -ForegroundColor Yellow

try {
    $examples = Invoke-RestMethod `
        -Uri "$BASE_URL/sandbox/examples" `
        -Method GET `
        -Headers @{
            "Authorization" = "Bearer $API_KEY"
        }

    Write-Host "   ✓ Sandbox examples retrieved!" -ForegroundColor Green
    Write-Host "   Available endpoints: $($examples.examples.Count)" -ForegroundColor White
    Write-Host ""

    # Test 2: Create Treasury Token via Sandbox
    Write-Host "2. Creating sandbox Treasury token..." -ForegroundColor Yellow

    $treasuryResponse = Invoke-RestMethod `
        -Uri "$BASE_URL/sandbox/treasury/create" `
        -Method POST `
        -Headers @{
            "Authorization" = "Bearer $API_KEY"
            "Content-Type" = "application/json"
        }

    Write-Host "   ✓ Treasury token created!" -ForegroundColor Green
    Write-Host "   Token ID: $($treasuryResponse.token_id)" -ForegroundColor White
    Write-Host "   Name: $($treasuryResponse.details.name)" -ForegroundColor White
    Write-Host "   Symbol: $($treasuryResponse.details.symbol)" -ForegroundColor White
    Write-Host ""

    # Test 3: Create Private Credit Token via Sandbox
    Write-Host "3. Creating sandbox Private Credit token..." -ForegroundColor Yellow

    $creditResponse = Invoke-RestMethod `
        -Uri "$BASE_URL/sandbox/private-credit/create" `
        -Method POST `
        -Headers @{
            "Authorization" = "Bearer $API_KEY"
            "Content-Type" = "application/json"
        }

    Write-Host "   ✓ Private Credit token created!" -ForegroundColor Green
    Write-Host "   Token ID: $($creditResponse.token_id)" -ForegroundColor White
    Write-Host ""

    # Test 4: Create Real Estate Token via Sandbox
    Write-Host "4. Creating sandbox Real Estate token..." -ForegroundColor Yellow

    $realEstateResponse = Invoke-RestMethod `
        -Uri "$BASE_URL/sandbox/real-estate/create" `
        -Method POST `
        -Headers @{
            "Authorization" = "Bearer $API_KEY"
            "Content-Type" = "application/json"
        }

    Write-Host "   ✓ Real Estate token created!" -ForegroundColor Green
    Write-Host "   Token ID: $($realEstateResponse.token_id)" -ForegroundColor White
    Write-Host ""

    # Test 5: Create Test Investor via Sandbox
    Write-Host "5. Creating sandbox investor..." -ForegroundColor Yellow

    $investorResponse = Invoke-RestMethod `
        -Uri "$BASE_URL/sandbox/investor/create" `
        -Method POST `
        -Headers @{
            "Authorization" = "Bearer $API_KEY"
            "Content-Type" = "application/json"
        }

    Write-Host "   ✓ Investor created!" -ForegroundColor Green
    Write-Host "   Investor ID: $($investorResponse.investor_id)" -ForegroundColor White
    Write-Host "   Wallet: $($investorResponse.wallet_address)" -ForegroundColor White
    Write-Host ""

    # Test 6: Check Metrics
    Write-Host "6. Checking performance metrics..." -ForegroundColor Yellow

    $metrics = Invoke-RestMethod `
        -Uri "http://localhost:3000/metrics" `
        -Method GET

    Write-Host "   ✓ Metrics retrieved!" -ForegroundColor Green
    Write-Host "   Total HTTP requests: $($metrics.performance.http.requests_total)" -ForegroundColor White
    Write-Host "   Avg request duration: $($metrics.performance.http.duration_ms.avg)ms" -ForegroundColor White
    Write-Host ""

    Write-Host ""
    Write-Host "All sandbox tests passed!" -ForegroundColor Green
    Write-Host ""

    Write-Host "Summary:" -ForegroundColor Cyan
    Write-Host "  Tokens created: 3 (Treasury + Private Credit + Real Estate)" -ForegroundColor White
    Write-Host "  Investors created: 1" -ForegroundColor White
    Write-Host "  Total API calls: 6" -ForegroundColor White
    Write-Host ""

} catch {
    Write-Host "Error occurred: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "Response details:" -ForegroundColor Yellow
    Write-Host $_.ErrorDetails.Message
}
