# API Gateway image. Build context is the REPO ROOT (not this folder) so
# the image can also copy the shared public/ frontend - the gateway is the
# only service that serves it. Same single-stage node:20-alpine pattern as
# the Phase 1 monolith Dockerfile.
#
#   docker build -f services/api-gateway/Dockerfile -t globetrotter-api-gateway .
FROM node:20-alpine

WORKDIR /usr/src/app

COPY services/api-gateway/package*.json ./
RUN npm install --omit=dev

COPY services/api-gateway/src ./src
# Served as static files by src/app.js - it probes a couple of candidate
# paths, this is the one that exists inside the image (/usr/src/app/public).
COPY public ./public

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||4000)+'/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "src/server.js"]
