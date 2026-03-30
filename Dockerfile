# Dockerfile for Seal Monorepo
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Build backend and frontend
RUN npm run build && cd apps/web && npm install && npm run build

WORKDIR /app

# Expose the port your gateway uses
EXPOSE 8080

# Start all services using a script
CMD ["sh", "docker/start-all.sh"]
