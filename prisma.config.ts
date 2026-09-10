// 이 파일이 존재하면 Prisma CLI 는 .env 를 자동으로 읽지 않는다
// ("Prisma config detected, skipping environment variable loading").
// 그래서 dotenv 를 직접 로드한다. import 순서가 중요하므로 맨 위에 둔다.
import "dotenv/config";

import { defineConfig } from "prisma/config";

// Prisma CLI 설정. package.json#prisma 는 Prisma 7 에서 제거되므로 이 파일로 옮겼다.
// DB 접속 URL 은 아직 prisma/schema.prisma 의 datasource 블록에 있다.
// 7.x 로 올릴 때 이 파일의 datasource 로 이관한다. (Issue #37)
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
});
