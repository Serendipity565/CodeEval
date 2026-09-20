FROM golang:1.23-alpine AS build
ENV GOPROXY=https://goproxy.cn,direct
WORKDIR /src
COPY go.mod go.sum ./
COPY protocol ./protocol
COPY runner ./runner
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /runner ./runner

FROM alpine:3.21
RUN sed -i 's#https://dl-cdn.alpinelinux.org/alpine#https://mirrors.cloud.tencent.com/alpine#g' /etc/apk/repositories \
    && apk add --no-cache ca-certificates docker-cli
COPY --from=build /runner /usr/local/bin/codeeval-runner
ENTRYPOINT ["/usr/local/bin/codeeval-runner"]
