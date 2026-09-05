# Unlike the other services, the gateway also serves the shared static
# frontend (public/) at the repo root, so it needs a build CONTEXT of the
# whole repo rather than just this folder:
#   docker build -f services/gateway/Dockerfile .
# (docker-compose.phase2.yml is already set up this way.)
FROM node:20-alpine

WORKDIR /usr/src/app

COPY services/gateway/package*.json ./services/gateway/
RUN npm install --omit=dev --prefix services/gateway

COPY services/gateway ./services/gateway
COPY public ./public

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||4000)+'/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "services/gateway/src/server.js"]
