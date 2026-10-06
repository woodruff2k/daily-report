PROJECT_ID  := fluid-skyline-430301-d0
REGION      := asia-northeast3
SERVICE     := daily-report
REGISTRY    := asia-northeast3-docker.pkg.dev
REPO        := daily-report
IMAGE       := $(REGISTRY)/$(PROJECT_ID)/$(REPO)/app
TAG         ?= latest

# Cloud Run 은 linux/amd64 만 실행한다. Apple Silicon 에서 그냥 빌드하면 arm64
# 이미지가 나오고, push 는 성공하는데 배포가 실패한다.
#
# 기본값은 비워 둔다 — 네이티브 빌드가 빨라야 로컬에서 자주 돌린다. 에뮬레이션
# 빌드는 이 저장소에서 10분을 넘긴다. 대신 두 곳에서 막는다.
#   - deploy-prod 는 PLATFORM 을 linux/amd64 로 강제한다(타깃 전용 변수는
#     선행 조건인 build 에도 전파된다).
#   - push 는 이미지 아키텍처를 보고 amd64 가 아니면 거부한다. make build 와
#     make push 를 따로 실행해도 잘못된 이미지가 올라가지 않는다.
PLATFORM    ?=
# 지연 확장(`=`)이어야 한다. `:=` 로 두면 파싱 시점에 빈 값으로 굳어서
# deploy-prod 의 타깃 전용 PLATFORM 이 반영되지 않는다(확인했다).
PLATFORM_FLAG = $(if $(PLATFORM),--platform $(PLATFORM),)

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
	docker build $(PLATFORM_FLAG) --tag $(IMAGE):$(TAG) .

# 로컬에서 운영 이미지를 띄워 본다. make db-up 으로 DB 가 떠 있어야 한다.
#
# .env 를 --env-file 로 넘기지 않는다. docker 의 --env-file 은 셸·dotenv 와 달리
# 따옴표를 벗기지 않아서, .env 의 DATABASE_URL="postgresql://..." 가 컨테이너 안에서
# 따옴표까지 포함된 값이 된다. Prisma 가 "the URL must start with the protocol
# postgresql://" 로 죽는다. JWT_SECRET 은 더 나쁘다 — 어떤 문자열이든 HMAC 키로
# 유효해서 조용히 다른 비밀로 서명한다.
#
# 그리고 .env 의 URL 은 호스트 기준(localhost:5433)이라 컨테이너 안에서는 자기
# 자신을 가리킨다. 그래서 compose 네트워크에 붙고 서비스 이름으로 접속한다.
#
# 아래 자격증명은 docker-compose.yml 에 그대로 있는 로컬 전용 더미다. 실제
# 시크릿이 아니고, 운영에서는 Secret Manager 가 주입한다.
.PHONY: run
run:
	docker run --rm -p 8080:8080 \
	  --network daily-report_default \
	  -e DATABASE_URL="postgresql://postgres:postgres@postgres:5432/daily_report?schema=public" \
	  -e JWT_SECRET="local-docker-run-only-not-a-real-secret" \
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
	@arch=$$(docker image inspect $(IMAGE):$(TAG) --format '{{.Architecture}}' 2>/dev/null); \
	 if [ -z "$$arch" ]; then \
	   echo "✗ $(IMAGE):$(TAG) 이미지가 없다. make build 를 먼저 실행한다."; exit 1; \
	 elif [ "$$arch" != "amd64" ]; then \
	   echo "✗ 이미지가 $$arch 다. Cloud Run 은 amd64 만 실행한다."; \
	   echo "  make build PLATFORM=linux/amd64 로 다시 빌드한다 (또는 make deploy-prod)."; \
	   exit 1; \
	 fi
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
deploy-prod: PLATFORM := linux/amd64
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

.PHONY: db-up
db-up:
	docker compose up -d --wait

.PHONY: db-down
db-down:
	docker compose down

.PHONY: db-seed
db-seed:
	npx prisma db seed

.PHONY: bootstrap-admin
bootstrap-admin:
	npm run bootstrap:admin
