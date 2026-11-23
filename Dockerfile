# RoomQ backend — vanilla Node.js HTTP server + mysql2 client.
FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Application source.
COPY src ./src
COPY public ./public

EXPOSE 3000

# The app binds to HOST/PORT from the environment; compose sets HOST=0.0.0.0.
CMD ["node", "src/server.js"]
