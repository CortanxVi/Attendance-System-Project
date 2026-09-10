# Light OCR's verified Linux native addon requires glibc 2.38 or newer.
# Debian Trixie provides a compatible runtime; Bookworm (glibc 2.36) does not.
FROM node:22-trixie-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force

COPY --chown=node:node ocr-server.js security.mjs ./

USER node
EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=5 \
    CMD node -e "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "ocr-server.js"]
