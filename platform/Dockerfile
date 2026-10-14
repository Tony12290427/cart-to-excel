FROM node:22.22.2-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY vite.config.js ./
COPY frontend ./frontend
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:22.22.2-bookworm-slim
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY server.js ./
COPY lib ./lib
COPY tools ./tools
RUN mkdir -p /data && chown node:node /data
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DB_PATH=/data/orders.sqlite
EXPOSE 8787
CMD ["node", "server.js"]
