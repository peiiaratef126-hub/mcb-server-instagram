# syntax=docker/dockerfile:1
FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json ./
COPY tsconfig.json ./
RUN npm ci --ignore-scripts || npm install

COPY src/ ./src/
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts || npm install --omit=dev
COPY --from=builder /app/dist ./dist

ENTRYPOINT ["node", "dist/index.js"]
