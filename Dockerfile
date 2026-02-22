FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.html styles.css app.js server.js ./
RUN mkdir -p /app/data

ENV PORT=8080 \
    MESHCORE_MQTT_URL="" \
    MESHCORE_MQTT_TOPIC="meshcore/#" \
    MESHCORE_WARDRIVE_CHANNEL_KEYS="" \
    MARKER_LOG_PATH="/app/data/markers-log.json"

EXPOSE 8080
CMD ["npm", "start"]
