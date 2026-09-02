# Fix mojibake comments (€"€"€ pattern) caused by file corruption
# Run this script to automatically clean up corrupted comment characters

$sourceDir = "$(Split-Path -Parent (Split-Path -Parent $PSScriptRoot))/src"
$fixCount = 0

Write-Host "🔍 Scanning for mojibake comments in $sourceDir..." -ForegroundColor Cyan

Get-ChildItem -Path $sourceDir -Filter "*.ts" -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
    $filePath = $_.FullName
    $content = Get-Content -Path $filePath -Raw -ErrorAction SilentlyContinue
    
    if ($content -match '"€"€"€') {
        Write-Host "⚠️  Found mojibake in: $($_.Name)" -ForegroundColor Yellow
        
        # Remove the mojibake pattern and replace with clean comment separator
        $cleaned = $content -replace '"€"€"€[^\n]*', '// ---'
        
        Set-Content -Path $filePath -Value $cleaned -Encoding UTF8 -NoNewline
        $fixCount++
        
        Write-Host "✅ Fixed: $($_.Name)" -ForegroundColor Green
    }
}

if ($fixCount -eq 0) {
    Write-Host "✨ No mojibake comments found. Repository is clean!" -ForegroundColor Green
} else {
    Write-Host "`n✅ Fixed $fixCount file(s)" -ForegroundColor Green
    Write-Host "💡 Tip: Run 'git add .' and commit your changes" -ForegroundColor Cyan
}
