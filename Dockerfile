# Dockerfile for Seal Monorepo
FROM node:20-alpine

WORKDIR /app

# Copy the entire monorepo (including packages, apps, etc.)
COPY . .

# Install dependencies and build everything inside the container
RUN npm install
RUN npm run build:all
RUN cd apps/web && npm install && npm run build
RUN npm install --production

# Expose the port your gateway uses
EXPOSE 8080

# Start all services using a script
CMD ["sh", "docker/start-all.sh"]
