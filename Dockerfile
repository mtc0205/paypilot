# ---- build stage -------------------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---- runtime stage -----------------------------------------------------------
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/dist ./dist
# writable volume for the JSON store (auto-seeds on first boot in mock mode)
VOLUME ["/app/data"]
ENV PORT=5075 PAYPAL_ENV=mock AI_PROVIDER=mock
EXPOSE 5075
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:${PORT}/api/health || exit 1
CMD ["node", "dist-server/src/server/index.js"]
