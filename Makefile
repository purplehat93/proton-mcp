SHELL := /bin/bash

.PHONY: install dev test lint typecheck format check build docker-check smoke

install:
	npm ci --ignore-scripts

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
	@user="$$(docker image inspect proton-mcp:local --format '{{.Config.User}}')"; \
	case "$$user" in ""|0|0:0|root|root:root) echo "Container is configured to run as root: $${user:-<empty>}" >&2; exit 1;; esac
	docker run --rm proton-mcp:local --input-type=module -e 'const m = await import("./dist/index.js"); if (typeof m.createServer !== "function") throw new Error("createServer export missing")'

smoke: docker-check
