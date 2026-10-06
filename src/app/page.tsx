import { redirect } from "next/navigation";

/**
 * 루트(`/`)는 로그인 화면으로 보낸다.
 *
 * 화면정의서에 루트에 대한 정의가 없다 — SCR-100 이 진입 화면인데 거기에 어떻게
 * 도달하는지가 비어 있어서, 9개 화면을 다 만든 뒤에도 초기 스캐폴드 페이지가
 * 남아 있었다. 배포하면 Cloud Run URL 이 바로 그 막다른 화면이 된다.
 *
 * 토큰을 보고 분기하지 않는다(로그인 상태면 /reports 로 보내는 식). 그러려면
 * 루트가 토큰을 해석해야 하는데, 이슈 #102 에서 신뢰 경계를 라우트 한 곳으로
 * 줄였다. 로그인된 사용자가 /login 에 닿아도 그 화면이 /reports 로 보낸다.
 */
export default function Home() {
  redirect("/login");
}
