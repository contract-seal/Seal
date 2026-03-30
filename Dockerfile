# Dockerfile for Seal Monorepo
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .


# Build all internal packages and apps
RUN npm run build:all && cd apps/web && npm install && npm run build

# Install only production dependencies (ensures workspace links are present)
RUN npm install --production

WORKDIR /app

# Expose the port your gateway uses
EXPOSE 8080

# Start all services using a script
CMD ["sh", "docker/start-all.sh"]
