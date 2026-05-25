#!/bin/bash

auth_provider_output=$(ast-grep scan -r .rules/noNestedRouteGuard.yml 2>/dev/null)

if [ -z "$auth_provider_output" ]; then
    exit 0
fi

echo "⚠️  Issue:"
echo "AuthProvider should not wrap RouteGuard component."
echo "✅ Correct usage:"
echo "  <AuthProvider>{children}</AuthProvider>"
echo "$auth_provider_output"

exit 1
