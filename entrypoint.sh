#!/bin/sh
set -e

echo "Enabling pgvector extension..."
echo "CREATE EXTENSION IF NOT EXISTS vector;" | npx prisma db execute --stdin

echo "Running prisma db push..."
npx prisma db push --skip-generate --accept-data-loss

echo "Starting app..."
exec node dist/src/index.js
