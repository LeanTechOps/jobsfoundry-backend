FROM node:18-alpine
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
COPY package*.json ./
RUN npm install --legacy-peer-deps
COPY . .
RUN npx prisma generate
RUN npm run build
EXPOSE 3000
CMD ["npm", "run", "start:prod"]
