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
	docker compose -f compose.example.yaml config >/dev/null

smoke:
	@echo "Smoke test not implemented yet; must remain read-only for v0.1." >&2
	@exit 2
