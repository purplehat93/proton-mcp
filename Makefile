SHELL := /bin/bash

.PHONY: install dev test lint typecheck format check build docker-check smoke

install:
	npm install

dev:
	npm run dev

test:
	npm test

lint:
	npm run lint

typecheck:
	npm run typecheck

format:
	npm run format

check:
	npm run check

build:
	npm run build

docker-check:
	docker build -t proton-mcp:local .
	docker run --rm --entrypoint sh proton-mcp:local -c 'test "$$(id -u)" != "0"'
	docker run --rm --entrypoint node proton-mcp:local --input-type=module -e 'const m = await import("./dist/index.js"); if (typeof m.createServer !== "function") throw new Error("createServer export missing")'

smoke: docker-check
