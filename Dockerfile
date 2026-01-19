# Build stage
FROM golang:1.25-alpine AS builder

WORKDIR /build

COPY go.mod go.sum ./
RUN go mod download

COPY main.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -o bookmarkd main.go

# Runtime stage
FROM alpine:3.21

WORKDIR /app

COPY --from=builder /build/bookmarkd .
COPY index.html ./
COPY static/ ./static/
COPY extension/components.js ./extension/

EXPOSE 8080

CMD ["./bookmarkd"]
