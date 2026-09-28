# syntax=docker/dockerfile:1
FROM golang:1.24-alpine AS builder

WORKDIR /app
COPY go.mod ./
RUN go mod download || true

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /bin/worker ./cmd/worker

FROM alpine:3.21
RUN apk --no-cache add ca-certificates tzdata
WORKDIR /app
COPY --from=builder /bin/worker /app/worker

ENTRYPOINT ["/app/worker"]
