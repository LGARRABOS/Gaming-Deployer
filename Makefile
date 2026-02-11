SHELL := /usr/bin/env bash

.PHONY: build-backend build-frontend build run test-backend lint-backend

build-backend:
	cd backend && go build ./cmd/server

build-frontend:
	cd frontend && npm install && npm run build

build: build-frontend build-backend

run:
	cd backend && APP_LISTEN_ADDR=:8080 APP_DB_PATH=./data/app.db go run ./cmd/server

test-backend:
	cd backend && go test ./...

lint-backend:
	cd backend && go vet ./...

