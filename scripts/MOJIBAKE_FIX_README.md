# 🐛 Mojibake Comments Bug Fix

## Problem Description

**Bug**: Corrupted comment characters (`"€"€"€`) appear in TypeScript files, particularly in `src/lib/multi-model-service.ts`

**Cause**: File corruption during crashes or editor issues

**Impact**: Cosmetic issue that reappears after commits

---

## Solution

### 1. **Quick Fix (Manual)**

Run the fix script to automatically clean all mojibake patterns:

```bash
npm run fix-mojibake
```

Or with PowerShell:

```powershell
.\scripts\fix-mojibake.ps1
```

### 2. **Automatic Prevention (Git Hook)**

Set up a pre-commit hook to automatically check and fix before commits:

**On macOS/Linux:**
```bash
cp scripts/pre-commit-hook.sh .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

**On Windows (Git Bash):**
```bash
cp scripts/pre-commit-hook.sh .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

### 3. **Scripts Available**

| Script | Description | Usage |
|--------|-------------|-------|
| `scripts/fix-mojibake.js` | Node.js script to scan and fix | `npm run fix-mojibake` |
| `scripts/fix-mojibake.ps1` | PowerShell script | `.\scripts\fix-mojibake.ps1` |
| `scripts/pre-commit-hook.sh` | Git pre-commit hook | `cp to .git/hooks/pre-commit` |

---

## How It Works

### Pattern Detection
```regex
"€"€"€[^\n]*
```

### Fix Action
```
"€"€"€[anything on this line] → // ---
```

### Files Scanned
- All `.ts` and `.tsx` files in `src/` directory and subdirectories

---

## Status Check

To verify your repository is clean:

```bash
npm run fix-mojibake
```

**Output examples:**

✅ **Clean** (no issues):
```
✨ No mojibake comments found. Repository is clean!
```

⚠️ **Issues found and fixed**:
```
⚠️  Found mojibake in: multi-model-service.ts
✅ Fixed: multi-model-service.ts
✅ Fixed 1 file(s)
```

---

## Prevention Tips

1. **Enable auto-save** in your editor to minimize corruption risk
2. **Use version control regularly** - commit frequently
3. **Keep backups** of important files
4. **Use the pre-commit hook** to catch issues before they're committed
5. **Run `npm run fix-mojibake`** periodically as part of your workflow

---

## Troubleshooting

### Issue: Script not found
```bash
# Make sure you're in the project root
pwd  # Should show: .../NOX-fresh
npm run fix-mojibake
```

### Issue: Permission denied (on macOS/Linux)
```bash
chmod +x scripts/fix-mojibake.js
chmod +x scripts/fix-mojibake.ps1
chmod +x scripts/pre-commit-hook.sh
```

### Issue: Pre-commit hook not running
```bash
# Verify hook is executable
ls -la .git/hooks/pre-commit

# Re-install if needed
cp scripts/pre-commit-hook.sh .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

---

## Last Checked
✅ Repository checked on **2026-09-02** - No mojibake comments found

---

## Related Files
- [src/lib/multi-model-service.ts](../../src/lib/multi-model-service.ts)
- [package.json](../../package.json) - Contains `fix-mojibake` script
