FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data/ars-store.sqlite

WORKDIR /app

# better-sqlite3 may need native compilation on the target architecture.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev

COPY . .
RUN mkdir -p /data

EXPOSE 3000
CMD ["npm", "start"]
