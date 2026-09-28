# syntax=docker/dockerfile:1
FROM golang:1.24-alpine AS builder

WORKDIR /app
COPY go.mod ./
RUN go mod download || true

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /bin/gateway ./cmd/gateway

FROM alpine:3.21
RUN apk --no-cache add ca-certificates tzdata
WORKDIR /app
COPY --from=builder /bin/gateway /app/gateway

EXPOSE 8080
ENTRYPOINT ["/app/gateway"]
