FROM node:18-alpine AS builder
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    openssl \
    cairo-dev \
    pango-dev \
    libpng-dev \
    jpeg-dev \
    giflib-dev \
    pixman-dev \
    librsvg-dev
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npx prisma generate
RUN npm run build

# ==============================================
# Production Stage

FROM node:18-alpine AS runner
RUN apk add --no-cache \
    openssl \
    cairo \
    pango \
    libpng \
    jpeg \
    giflib \
    librsvg \
    pixman
WORKDIR /app
COPY --from=builder /app ./
EXPOSE 3000
CMD ["npm", "run", "start:prod"]
