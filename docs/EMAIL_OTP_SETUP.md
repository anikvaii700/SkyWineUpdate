# SkyWinBD Email OTP Setup

The frontend email OTP flow depends on the SkyWinBD Security API.

Required backend environment:
- RESEND_API_KEY: Resend API key with email sending permission.
- EMAIL_FROM: verified sender, for example `SkyWinBD <no-reply@best-product.top>`.
- OTP_PEPPER: random secret of at least 32 characters; do not reuse Firebase or Resend credentials.
- FIREBASE_SERVICE_ACCOUNT_JSON: Firebase service-account JSON used by Firebase Admin to mark an email verified.
- ADMIN_EMAILS: include the exact owner email to grant the bootstrap admin role.

Email OTP is six digits, expires after five minutes, allows five verification attempts, and enforces a one-minute resend cooldown. No SMS OTP is used.

Do not deploy until the Resend domain is verified, backend environment is configured, and the backend PR is deployed alongside this frontend.
