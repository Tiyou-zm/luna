#!/bin/bash

icon_path_output=$(ast-grep scan -r .rules/noAbsoluteIconPath.yml 2>/dev/null)

if [ -z "$icon_path_output" ]; then
    exit 0
fi

echo "⚠️  Issue:"
echo "Icon paths (iconPath or selectedIconPath) must use relative paths starting with './'."
echo "Affected locations:"
echo "$icon_path_output"

exit 1
