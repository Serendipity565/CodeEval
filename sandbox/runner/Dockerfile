FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY protocol ./protocol
COPY runner ./runner
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /runner ./runner

FROM alpine:3.21
RUN apk add --no-cache ca-certificates docker-cli
COPY --from=build /runner /usr/local/bin/codeeval-runner
ENTRYPOINT ["/usr/local/bin/codeeval-runner"]
