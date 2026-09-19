FROM golang:1.23-alpine AS builder
ENV GOPROXY=https://goproxy.cn,direct
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/codeeval-server .

FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=builder /out/codeeval-server ./codeeval-server
EXPOSE 8080
USER 65532:65532
ENTRYPOINT ["./codeeval-server"]
