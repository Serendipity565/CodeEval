FROM golang:1.23-alpine AS executor-build
ENV GOPROXY=https://goproxy.cn,direct
WORKDIR /src
COPY go.mod ./
COPY protocol ./protocol
COPY executor ./executor
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /sandbox-executor ./executor

FROM golang:1.23-alpine AS go
COPY --from=executor-build /sandbox-executor /usr/local/bin/sandbox-executor
ENV SANDBOX_LANGUAGE=go HOME=/tmp GOCACHE=/tmp/go-cache
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/sandbox-executor"]

FROM python:3.13-alpine AS python
COPY --from=executor-build /sandbox-executor /usr/local/bin/sandbox-executor
ENV SANDBOX_LANGUAGE=python PYTHONDONTWRITEBYTECODE=1 HOME=/tmp
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/sandbox-executor"]

FROM eclipse-temurin:21-jdk-alpine AS java
COPY --from=executor-build /sandbox-executor /usr/local/bin/sandbox-executor
ENV SANDBOX_LANGUAGE=java HOME=/tmp
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/sandbox-executor"]

FROM alpine:3.21 AS cpp
RUN sed -i 's#https://dl-cdn.alpinelinux.org/alpine#https://mirrors.cloud.tencent.com/alpine#g' /etc/apk/repositories \
    && apk add --no-cache g++
COPY --from=executor-build /sandbox-executor /usr/local/bin/sandbox-executor
ENV SANDBOX_LANGUAGE=cpp HOME=/tmp
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/sandbox-executor"]
