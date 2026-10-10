#!/bin/bash
# Update build version to force Portainer to rebuild

set -e

BUILDVERSION_FILE=".buildversion"

if [ ! -f "$BUILDVERSION_FILE" ]; then
    echo "1" > "$BUILDVERSION_FILE"
    echo "Created $BUILDVERSION_FILE with version 1"
    exit 0
fi

CURRENT=$(cat "$BUILDVERSION_FILE")
NEXT=$((CURRENT + 1))

echo "$NEXT" > "$BUILDVERSION_FILE"

echo "Updated $BUILDVERSION_FILE: $CURRENT → $NEXT"
echo ""
echo "Commit this change to force Portainer rebuild:"
echo "  git add $BUILDVERSION_FILE"
echo "  git commit -m \"Bump build version to $NEXT\""
echo "  git push"
