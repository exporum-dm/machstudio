import {
  normalizeRegistrationForm,
  safeHttpUrl,
  webinarFormTranslatedLocales,
} from "@/lib/webinar-config";

/**
 * 외부 로더에 필요한 등록 폼 계약만 내보낸다. 실행 가능한 URL은 공개 전 정제한다.
 *
 * `locale` 을 받으면 **이미 그 언어로 덮어쓴** 문구가 나간다 — 로더는 번역의 존재를 몰라도 되고,
 * 손으로 쓴 그 스크립트 안에 덮개 적용 로직이 한 벌 더 생기지 않는다.
 */
export function buildPublicRegistrationFormPayload(config: unknown, locale?: string) {
  const registrationForm = normalizeRegistrationForm(config, locale ? { locale } : undefined);
  return {
    fields: registrationForm.fields,
    privacyText: registrationForm.privacyText,
    marketingText: registrationForm.marketingText,
    privacyBody: registrationForm.privacyBody,
    marketingBody: registrationForm.marketingBody,
    privacyDefaultChecked: registrationForm.privacyDefaultChecked,
    marketingDefaultChecked: registrationForm.marketingDefaultChecked,
    thirdPartyEnabled: registrationForm.thirdPartyEnabled,
    thirdPartyText: registrationForm.thirdPartyText,
    thirdPartyBody: registrationForm.thirdPartyBody,
    thirdPartyDefaultChecked: registrationForm.thirdPartyDefaultChecked,
    submitLabel: registrationForm.submitLabel,
    successCta: {
      enabled: registrationForm.successCta.enabled,
      label: registrationForm.successCta.label,
      url: safeHttpUrl(registrationForm.successCta.url),
    },
    successRedirectUrl: safeHttpUrl(registrationForm.successRedirectUrl),
    /**
     * 지금 어느 언어로 그려졌는가. 로더가 등록 제출에 **그대로 되돌려 보낸다** —
     * 서버는 그 값으로 번역된 선택지를 원문 값으로 되돌려 저장한다(한 명단, 한 어휘).
     */
    locale: locale && locale !== registrationForm.defaultLocale ? locale : registrationForm.defaultLocale,
    /** 번역이 **실제로 들어 있는** 언어들. 진단용 — 로더는 쓰지 않는다. */
    locales: webinarFormTranslatedLocales(registrationForm),
  };
}

/** 폼이 실제로 지원하는 언어 — 설정 라우트가 방문자 신호를 여기에 맞춰 좁힌다. */
export function publicRegistrationFormLocales(config: unknown): { locales: string[]; defaultLocale: string } {
  const form = normalizeRegistrationForm(config);
  return { locales: webinarFormTranslatedLocales(form), defaultLocale: form.defaultLocale };
}
