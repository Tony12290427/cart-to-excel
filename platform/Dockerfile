FROM node:22.22.2-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server.js ./
COPY lib ./lib
COPY public ./public
COPY tools ./tools
RUN mkdir -p /data && chown node:node /data
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DB_PATH=/data/orders.sqlite
EXPOSE 8787
CMD ["node", "server.js"]
