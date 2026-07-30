# Simple single-stage Dockerfile - appropriate for Phase 1 (Phase 3 is where
# we'll worry about multi-stage builds, image size, etc).
FROM node:20-alpine

WORKDIR /usr/src/app

# Copy dependency manifests first so Docker can cache the npm install layer
# and only re-run it when package.json actually changes.
COPY package*.json ./
RUN npm install --omit=dev

# Now copy the rest of the source.
COPY . .

ENV NODE_ENV=production
ENV PORT=4001
EXPOSE 4001

# Basic container healthcheck against our /api/health endpoint. Reads PORT
# at container-start time (not build time) so this still works if a host
# like Render injects its own PORT value.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||4001)+'/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "src/server.js"]
