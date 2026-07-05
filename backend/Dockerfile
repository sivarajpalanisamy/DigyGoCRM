# Local development image for the DigyGo/Hawcus backend.
# Runs the TypeScript source directly via nodemon + ts-node (hot reload via the
# ./backend/src bind-mount in docker-compose.yml). Not a production image.
FROM node:20-bookworm-slim

WORKDIR /app

# Build tools for any native node modules (bcrypt, etc.) that lack a prebuild.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install deps first (better layer caching). node_modules is built for linux here,
# not copied from the host (see .dockerignore).
COPY package*.json ./
RUN npm install --legacy-peer-deps

# App source (overlaid at runtime by the src bind-mount for hot reload).
COPY . .

EXPOSE 4000

# Run ts-node directly (bypass the `predev` kill-port step, which is host-only).
# -L = legacy/polling watch: inotify events don't cross a Windows->Linux bind mount,
# so polling is required for nodemon to pick up host edits to ./backend/src.
CMD ["npx", "nodemon", "-L", "--watch", "src", "--ext", "ts", "--exec", "ts-node src/index.ts"]
