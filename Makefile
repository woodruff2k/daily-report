PROJECT_ID  := 370670066576
REGION      := asia-northeast3
SERVICE     := daily-report
REGISTRY    := asia-northeast3-docker.pkg.dev
REPO        := daily-report
IMAGE       := $(REGISTRY)/$(PROJECT_ID)/$(REPO)/app
TAG         ?= latest

# ── 로컬 개발 ─────────────────────────────────────────────────

.PHONY: dev
dev:
	npm run dev

.PHONY: lint
lint:
	npm run lint

.PHONY: lint-fix
lint-fix:
	npm run lint:fix

.PHONY: test
test:
	npm test

.PHONY: test-coverage
test-coverage:
	npm run test:coverage

# ── Docker ────────────────────────────────────────────────────

.PHONY: build
build:
	docker build --tag $(IMAGE):$(TAG) .

.PHONY: run
run:
	docker run --rm -p 8080:8080 \
	  --env-file .env.local \
	  $(IMAGE):$(TAG)

# ── Artifact Registry ─────────────────────────────────────────

.PHONY: registry-create
registry-create:
	gcloud artifacts repositories create $(REPO) \
	  --repository-format docker \
	  --location $(REGION) \
	  --project $(PROJECT_ID)

.PHONY: docker-auth
docker-auth:
	gcloud auth configure-docker $(REGISTRY)

.PHONY: push
push: docker-auth
	docker push $(IMAGE):$(TAG)

# ── Cloud Run ─────────────────────────────────────────────────

.PHONY: deploy
deploy:
	gcloud run deploy $(SERVICE) \
	  --image $(IMAGE):$(TAG) \
	  --region $(REGION) \
	  --project $(PROJECT_ID) \
	  --platform managed \
	  --allow-unauthenticated \
	  --min-instances 0 \
	  --max-instances 10 \
	  --memory 512Mi \
	  --cpu 1 \
	  --port 8080 \
	  --set-secrets="DATABASE_URL=DATABASE_URL:latest,JWT_SECRET=JWT_SECRET:latest"

.PHONY: deploy-prod
deploy-prod: build push deploy
	@echo "✓ 배포 완료"

.PHONY: logs
logs:
	gcloud run services logs read $(SERVICE) \
	  --region $(REGION) \
	  --project $(PROJECT_ID) \
	  --limit 100

.PHONY: status
status:
	gcloud run services describe $(SERVICE) \
	  --region $(REGION) \
	  --project $(PROJECT_ID) \
	  --format "table(status.url, status.conditions[0].type, status.conditions[0].status)"

.PHONY: rollback
rollback:
	gcloud run services update-traffic $(SERVICE) \
	  --region $(REGION) \
	  --project $(PROJECT_ID) \
	  --to-revisions PREVIOUS=100

# ── DB 마이그레이션 ───────────────────────────────────────────

.PHONY: migrate
migrate:
	npx prisma migrate deploy

.PHONY: migrate-dev
migrate-dev:
	npx prisma migrate dev

.PHONY: db-studio
db-studio:
	npx prisma studio
