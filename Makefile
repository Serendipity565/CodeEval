SHELL := /bin/sh

.PHONY: help install dev web-install web-dev web-build web-preview server-dev server-test sandbox-test sandbox-docker-test docker-build docker-up docker-down docker-logs

help:
	@echo "CodeEval development commands"
	@echo "  make install       Install frontend dependencies"
	@echo "  make dev           Start backend and frontend development servers"
	@echo "  make web-dev       Start Vite development server"
	@echo "  make web-build     Type-check and build the frontend"
	@echo "  make web-preview   Preview the frontend production build"
	@echo "  make server-dev    Start the Go API"
	@echo "  make server-test   Run backend tests"
	@echo "  make sandbox-test  Run sandbox unit tests"
	@echo "  make sandbox-docker-test  Build and test all four sandbox images"
	@echo "  make docker-up     Build and start the complete stack"
	@echo "  make docker-down   Stop the complete stack"

install: web-install

dev:
	$(MAKE) -j2 server-dev web-dev

web-install:
	npm --prefix web ci

web-dev:
	npm --prefix web run dev -- --host 0.0.0.0

web-build:
	npm --prefix web run build

web-preview: web-build
	npm --prefix web run preview -- --host 0.0.0.0

server-dev:
	cd server && go run .

server-test:
	cd server && go test ./...

sandbox-test:
	cd sandbox && go test ./...

sandbox-docker-test:
	docker compose build sandbox-runner sandbox-go-image sandbox-python-image sandbox-java-image sandbox-cpp-image
	cd sandbox && CODEEVAL_DOCKER_TEST=1 go test ./runner -run TestSandboxImagesEndToEnd -v

docker-build:
	docker compose build

docker-up:
	docker compose up --build -d

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f
