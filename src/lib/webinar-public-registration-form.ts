import { normalizeRegistrationForm, safeHttpUrl } from "@/lib/webinar-config";

/** 외부 로더에 필요한 등록 폼 계약만 내보낸다. 실행 가능한 URL은 공개 전 정제한다. */
export function buildPublicRegistrationFormPayload(config: unknown) {
  const registrationForm = normalizeRegistrationForm(config);
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
  };
}
