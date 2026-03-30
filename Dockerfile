# Dockerfile for Seal Monorepo
FROM node:20-alpine

WORKDIR /app

# Copy the entire monorepo (including packages, apps, etc.)
COPY . .


# Install dependencies and build everything inside the container
RUN npm install
RUN npm run build:all
# Debug: List dist/ contents for all internal packages
RUN echo "==== DEBUG: Listing dist/ for all internal packages ====" \
	&& for pkg in packages/*; do \
		if [ -d "$pkg/dist" ]; then \
			echo "Contents of $pkg/dist:"; \
			ls -l "$pkg/dist"; \
		else \
			echo "$pkg/dist does not exist"; \
		fi; \
	done
RUN cd apps/web && npm install && npm run build

# Expose the port your gateway uses
EXPOSE 8080

# Start all services using a script
CMD ["sh", "docker/start-all.sh"]
