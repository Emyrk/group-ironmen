#!/bin/sh

echo "[entrypoint] Running bundle"
npm run bundle

echo "[entrypoint] Running serve"
exec "$@"
