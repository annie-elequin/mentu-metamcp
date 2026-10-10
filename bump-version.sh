#!/bin/bash
# Update build version to force Portainer to rebuild
# Updates hardcoded image tags in docker-compose.yml AND .buildversion

set -e

BUILDVERSION_FILE=".buildversion"
COMPOSE_FILE="docker-compose.yml"

if [ ! -f "$BUILDVERSION_FILE" ]; then
    echo "1" > "$BUILDVERSION_FILE"
    echo "Created $BUILDVERSION_FILE with version 1"
fi

if [ ! -f "$COMPOSE_FILE" ]; then
    echo "Error: $COMPOSE_FILE not found"
    exit 1
fi

CURRENT=$(cat "$BUILDVERSION_FILE")
NEXT=$((CURRENT + 1))

echo "Bumping version: $CURRENT → $NEXT"
echo ""

# Update docker-compose.yml hardcoded tags
# Replace image: mentu-metamcp:N with image: mentu-metamcp:N+1
# Replace BUILD_VERSION: "N" with BUILD_VERSION: "N+1"

sed -i "s/image: mentu-metamcp:$CURRENT/image: mentu-metamcp:$NEXT/g" "$COMPOSE_FILE"
sed -i "s/image: mentu-metamcp-ui:$CURRENT/image: mentu-metamcp-ui:$NEXT/g" "$COMPOSE_FILE"
sed -i "s/BUILD_VERSION: \"$CURRENT\"/BUILD_VERSION: \"$NEXT\"/g" "$COMPOSE_FILE"

# Update .buildversion
echo "$NEXT" > "$BUILDVERSION_FILE"

echo "✓ Updated $COMPOSE_FILE:"
echo "  - image: mentu-metamcp:$CURRENT → mentu-metamcp:$NEXT"
echo "  - image: mentu-metamcp-ui:$CURRENT → mentu-metamcp-ui:$NEXT"
echo "  - BUILD_VERSION: \"$CURRENT\" → \"$NEXT\""
echo ""
echo "✓ Updated $BUILDVERSION_FILE: $CURRENT → $NEXT"
echo ""
echo "Review changes:"
echo "  git diff $COMPOSE_FILE $BUILDVERSION_FILE"
echo ""
echo "Then commit:"
echo "  git add $COMPOSE_FILE $BUILDVERSION_FILE"
echo "  git commit -m \"Bump build version to $NEXT\""
echo "  git push"
