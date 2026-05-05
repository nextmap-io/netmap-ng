.PHONY: dev backend-dev frontend-dev backend-deps backend-format backend-lint backend-typecheck backend-test \
        frontend-install frontend-lint frontend-typecheck frontend-build frontend-test \
        docker-up docker-down docker-build ci clean

# Sentinel files so we don't reinstall on every invocation.
BACKEND_DEPS_SENTINEL := backend/.deps-installed
FRONTEND_DEPS_SENTINEL := frontend/node_modules/.package-lock.json

# ── Development ──────────────────────────────────────

dev: docker-up
	@echo "Redis is running."
	@echo "Run 'make backend-dev' and 'make frontend-dev' in separate terminals."

backend-dev:
	cd backend && uvicorn app.main:app --reload --port 8000

frontend-dev: $(FRONTEND_DEPS_SENTINEL)
	cd frontend && npm run dev

# ── Dependency installation (once, via sentinels) ────

$(BACKEND_DEPS_SENTINEL): backend/requirements.txt
	pip install -r backend/requirements.txt
	pip install ruff mypy sqlalchemy[mypy] pytest pytest-asyncio httpx anyio
	@touch $(BACKEND_DEPS_SENTINEL)

backend-deps: $(BACKEND_DEPS_SENTINEL)

$(FRONTEND_DEPS_SENTINEL): frontend/package-lock.json
	cd frontend && npm ci

frontend-install: $(FRONTEND_DEPS_SENTINEL)

# ── Backend checks (mirror ci.yml) ───────────────────

backend-format: $(BACKEND_DEPS_SENTINEL)
	cd backend && ruff format app/

backend-lint: $(BACKEND_DEPS_SENTINEL)
	cd backend && ruff format --check app/
	cd backend && ruff check app/

backend-typecheck: $(BACKEND_DEPS_SENTINEL)
	cd backend && mypy app/

backend-test: $(BACKEND_DEPS_SENTINEL)
	cd backend && APP_SECRET_KEY=test-secret-key-ci-only AUTH_DISABLED=true \
		python -m pytest tests/ -v --tb=short

# ── Frontend checks (mirror ci.yml) ──────────────────

frontend-lint: $(FRONTEND_DEPS_SENTINEL)
	cd frontend && npm run lint

frontend-typecheck: $(FRONTEND_DEPS_SENTINEL)
	cd frontend && npx tsc -b

frontend-build: $(FRONTEND_DEPS_SENTINEL)
	cd frontend && npm run build

# Run frontend tests if a `test` script exists; otherwise no-op.
frontend-test: $(FRONTEND_DEPS_SENTINEL)
	@cd frontend && \
		if node -e "process.exit((require('./package.json').scripts||{}).test ? 0 : 1)"; then \
			npm test --silent -- --run 2>/dev/null || npm test --silent ; \
		else \
			echo "frontend: no test script — skipping"; \
		fi

# ── Docker ───────────────────────────────────────────

docker-up:
	docker compose up -d

docker-down:
	docker compose down

docker-build:
	docker compose build

# ── CI: run all checks locally (matches .github/workflows/ci.yml) ─

ci: backend-lint backend-typecheck backend-test \
    frontend-lint frontend-typecheck frontend-build frontend-test
	@echo "All CI checks passed."

# ── Clean ────────────────────────────────────────────

clean:
	rm -rf frontend/dist/ backend/__pycache__ backend/app/__pycache__ backend/data/ \
		$(BACKEND_DEPS_SENTINEL)
