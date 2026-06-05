#!/bin/bash

# 用于收集所有检查的退出码
EXIT_CODES=()

echo "=== Checking SCSS syntax ==="
SCSS_ERROR=0
while IFS= read -r -d '' file; do
  output=$(npx sass --no-source-map --load-path=node_modules --load-path=../node_modules "$file" /dev/null 2>&1)
  if [ $? -ne 0 ]; then
    echo "$output"
    SCSS_ERROR=1
  fi
done < <(find src -name "*.scss" -print0)
if [ $SCSS_ERROR -eq 0 ]; then
  echo "No SCSS errors found."
fi
EXIT_CODES+=($SCSS_ERROR)

npx biome lint --diagnostic-level=error
EXIT_CODES+=($?)

npx tsgo -p tsconfig.check.json
EXIT_CODES+=($?)

./scripts/checkNavigation.sh
EXIT_CODES+=($?)

./scripts/checkIconPath.sh
EXIT_CODES+=($?)

./scripts/checkAuthProvider.sh
EXIT_CODES+=($?)

npx oxlint -c .oxlintrc.json
EXIT_CODES+=($?)

ALL_PASSED=true
CHECKS=("scss" "biome" "tsgo" "navigation" "iconpath" "authprovider" "oxlint")
FAILED_CHECKS=()
for i in "${!EXIT_CODES[@]}"; do
    if [ ${EXIT_CODES[$i]} -ne 0 ]; then
        ALL_PASSED=false
        FAILED_CHECKS+=("${CHECKS[$i]}")
    fi
done

echo ""
if [ "$ALL_PASSED" = true ]; then
    echo "RESULT: ALL CHECKS PASSED ✓ Finished with 0 errors. Found no issues."
else
    echo "RESULT: FAILED — Found error in: ${FAILED_CHECKS[*]}"
    echo "Fix all errors above, then re-run 'npm run lint'."
fi

if [ "$ALL_PASSED" = true ]; then
    exit 0
else
    exit 1
fi
