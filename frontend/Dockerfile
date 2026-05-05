# Build stage
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

# Runtime stage
FROM nginx:1.27-alpine AS runtime
RUN addgroup -g 10001 -S app && adduser -S -u 10001 -G app app
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
RUN chown -R app:app /usr/share/nginx/html /var/cache/nginx /var/log/nginx \
    && chmod -R g+rwx /var/cache/nginx /var/log/nginx \
    && touch /var/run/nginx.pid && chown app:app /var/run/nginx.pid
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:8080/healthz || exit 1
CMD ["nginx", "-g", "daemon off;"]
