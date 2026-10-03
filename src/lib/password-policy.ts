/**
 * 비밀번호 정책 상수.
 *
 * `password.ts`(bcrypt 의존)와 분리해 둔다. 입력 스키마가 길이 상수 하나 때문에
 * 해싱 모듈을 끌어오면, 그 모듈을 모킹하는 테스트마다 상수까지 함께 넘겨야 한다.
 */

/** 최소 길이. 관리자가 지정하는 비밀번호와 본인이 바꾸는 비밀번호 모두에 적용된다. */
export const MIN_PASSWORD_LENGTH = 12;

/** bcrypt 는 72바이트를 넘는 입력을 잘라내므로 그 지점을 상한으로 둔다. */
export const MAX_PASSWORD_LENGTH = 72;
