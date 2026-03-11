#!/bin/sh
set -e

echo "Running prisma db push..."
npx prisma db push --skip-generate --accept-data-loss

echo "Starting app..."
exec node dist/src/index.js
