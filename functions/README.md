# Order reminders on WhatsApp

Two scheduled Firebase Functions are prepared for `Asia/Kolkata`:

- 9:00 AM: orders due tomorrow.
- 6:00 AM: orders due today.

Only `Confirmed`, `In progress`, and `Ready` orders are sent. Each order is sent once per phase to each configured recipient. The message includes the client, product, quantity or weight, cake message, and a fixed link to the Orders page. Delivery attempts are recorded in the private `orderReminderDeliveries` collection to limit duplicate sends.

## Meta setup required before deployment

1. In [Meta for Developers](https://developers.facebook.com/documentation/business-messaging/whatsapp/overview), create or select a business app and set up WhatsApp Business Platform / Cloud API. The simplest route is a separate sender number. Keeping the existing WhatsApp Business phone app on the same number requires Meta's [coexistence onboarding](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users), which Meta currently documents for Solution Partners or Tech Providers. Do not migrate the existing number before reviewing the effect on its phone-app features.
2. Obtain the **Phone Number ID** of the sender and a long-lived system-user access token with `whatsapp_business_messaging`. Keep the token out of source code and chat.
3. In WhatsApp Manager, create an English (US) message template named `mannam_order_reminder`. Submit it for approval. Proposed body, with variables in this exact order:

   ```text
   Mannam order reminder for {{1}}. Client: {{2}}. Product: {{3}}. Quantity: {{4}}. Cake message: {{5}}. Check https://mannam-expense.web.app/orders for additional details.
   ```

   Example values: `tomorrow`, `Riya`, `Custom cake`, `2 lb`, `Happy Birthday Riya`. Request Utility classification if Meta accepts it; Meta decides the final category and associated price. The template must be approved before the first send.
4. Set the Firebase secret interactively:

   ```text
   firebase functions:secrets:set MANNAM_WHATSAPP_CONFIG --project cognylync
   ```

   Enter one JSON object like this, substituting the real sender ID, token, and recipient number in international format without `+`:

   ```json
   {"phoneNumberId":"SENDER_PHONE_NUMBER_ID","accessToken":"SYSTEM_USER_ACCESS_TOKEN","recipients":["91XXXXXXXXXX"],"templateName":"mannam_order_reminder","language":"en_US"}
   ```

5. From the repository root, run `npm run deploy:firebase:reminders`. This deploys only Functions; the normal Hosting and Firestore rules deployments remain separate.

The current recipient supplied for setup is an Indian number ending in **3996**. Confirm that it differs from the Cloud API sender number before activation. Scheduled Functions require the Firebase project to stay on its billing-enabled plan. WhatsApp template messages and any Meta partner may incur charges.

Run `npm test` inside this directory to check India date boundaries, eligible statuses, and the message fields.
