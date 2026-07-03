import nextConfig from "eslint-config-next";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  ...nextConfig,
  ...nextCoreWebVitals,
  {
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // 미사용 변수 오류 처리
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      // any 타입 사용 경고
      "@typescript-eslint/no-explicit-any": "warn",
      // 비동기 함수에서 await 누락 방지 (type-aware)
      "@typescript-eslint/require-await": "error",
      // 서버 로그 PII 혼입 방지 (NFR-04)
      "no-console": ["warn", { allow: ["warn", "error"] }],
      // dangerouslySetInnerHTML 사용 금지 (XSS 방어)
      "react/no-danger": "error",
      // React Hook 규칙 준수
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // App Router 경로 설정
      "@next/next/no-html-link-for-pages": ["error", "src/app"],
    },
  },
];

export default eslintConfig;
