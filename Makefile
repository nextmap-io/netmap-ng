.PHONY: dev backend-dev frontend-dev backend-lint backend-typecheck backend-test frontend-lint frontend-typecheck frontend-build docker-up docker-down docker-build ci clean

# ── Development ──────────────────────────────────────

dev: docker-up
	@echo "Redis is running."
	@echo "Run 'make backend-dev' and 'make frontend-dev' in separate terminals."

backend-dev:
	cd backend && uvicorn app.main:app --reload --port 8000

frontend-dev:
	cd frontend && npm run dev

# ── Backend checks ───────────────────────────────────

backend-lint:
	cd backend && pip install -q ruff && ruff check app/

backend-format:
	cd backend && pip install -q ruff && ruff format app/

backend-typecheck:
	cd backend && pip install -q mypy && mypy app/ --ignore-missing-imports

backend-test:
	cd backend && python -m pytest tests/ -v --tb=short

# ── Frontend checks ─────────────────────────────────

frontend-install:
	cd frontend && npm ci

frontend-lint:
	cd frontend && npm run lint

frontend-typecheck:
	cd frontend && npx tsc -b

frontend-build:
	cd frontend && npm run build

# ── Docker ───────────────────────────────────────────

docker-up:
	docker compose up -d

docker-down:
	docker compose down

docker-build:
	docker compose build

# ── CI: run all checks locally ───────────────────────

ci: backend-lint backend-typecheck backend-test frontend-lint frontend-typecheck frontend-build
	@echo "All CI checks passed."

# ── Clean ────────────────────────────────────────────

clean:
	rm -rf frontend/dist/ backend/__pycache__ backend/app/__pycache__ backend/data/
