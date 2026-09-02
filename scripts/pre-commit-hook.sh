#!/bin/bash
# Pre-commit hook to fix mojibake comments before committing
# Install: cp scripts/pre-commit-hook.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit

echo "🔍 Checking for mojibake comments..."

node scripts/fix-mojibake.js

# If mojibake was found and fixed, add the fixed files to the staging area
if grep -r '"€"€"€' src/ 2>/dev/null; then
    echo "❌ Mojibake pattern found - please review and re-commit"
    exit 1
else
    echo "✅ No mojibake comments detected"
    exit 0
fi
