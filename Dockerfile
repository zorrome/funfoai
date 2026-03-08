FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache docker-cli
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3100 5175
CMD ["sh", "-lc", "npm run server & npm run dev -- --host 0.0.0.0 --port 5175"]
