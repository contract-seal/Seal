#!/bin/sh
# Start all services for Seal monorepo in the background, then start the gateway in the foreground

# Start dependencies (if needed)
# e.g., migrations, etc.

# Start backend microservices in the background
node dist/apps/user-service/src/main.js &
node dist/apps/job-service/src/main.js &
node dist/apps/payment-service/src/main.js &
node dist/apps/escrow-service/src/main.js &
node dist/apps/dispute-service/src/main.js &
node dist/apps/reputation-service/src/main.js &
node dist/apps/scheduler-service/src/main.js &
node dist/apps/notification-service/src/main.js &
node dist/apps/ussd-service/src/main.js &

# Start the gateway in the foreground (so container stays alive)
exec node dist/apps/gateway/src/main.js
