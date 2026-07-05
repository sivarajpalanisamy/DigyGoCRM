# Local development image for the DigyGo/Hawcus frontend (Vite dev server).
# Serves on 0.0.0.0:5173 so it is reachable from the host. Not a production image
# (production is a static `vite build` served by nginx).
FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --legacy-peer-deps

COPY . .

EXPOSE 5173

# --host binds to 0.0.0.0 so the container's port is reachable from the host browser.
CMD ["npx", "vite", "--host", "0.0.0.0"]
