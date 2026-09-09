###############################################
# Frontend Image
###############################################
FROM node:22-alpine AS production-frontend

WORKDIR /app

COPY ["./package.json", "./package-lock.json*", "./"]
RUN npm ci --ignore-scripts

COPY . .

ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
CMD ["npm","run","serve"]
