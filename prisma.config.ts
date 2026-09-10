// 이 파일이 존재하면 Prisma CLI 는 .env 를 자동으로 읽지 않는다
// ("Prisma config detected, skipping environment variable loading").
// 그래서 dotenv 를 직접 로드한다. import 순서가 중요하므로 맨 위에 둔다.
import "dotenv/config";

import { defineConfig } from "prisma/config";

// Prisma CLI 설정. seed 설정을 package.json#prisma 에서 이 파일로 옮겼다.
// package.json#prisma 는 deprecated 라 명령마다 경고가 나왔고, 이 파일이 그 경고를 없앤다.
//
// DB 접속 URL 은 prisma/schema.prisma 의 datasource 블록에 그대로 둔다.
// 이 프로젝트는 Prisma 6 에서 유지하므로 옮길 이유가 없다.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
});
