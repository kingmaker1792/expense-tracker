# Automatic order reminders on WhatsApp

Two scheduled Firebase Functions are prepared for `Asia/Kolkata`:

- 9:00 AM: orders due tomorrow.
- 6:00 AM: orders due today.

Only `Confirmed`, `In progress`, and `Ready` orders are sent. Each order is sent once per phase to each configured recipient. The message includes the client, product, quantity or weight, cake message, and a fixed link to the Orders page. Delivery attempts are recorded in the private `orderReminderDeliveries` collection to limit duplicate sends.

## Set up a separate sender with Meta

1. Go to [Meta for Developers](https://developers.facebook.com/), create a **Business** app, and add **WhatsApp**. In the app's **WhatsApp > API Setup** page, add and verify a separate business phone number. This number will send the reminders; the receiving number is **+91 9903513996**. Keep the existing WhatsApp Business app number separate.
2. On **WhatsApp > API Setup**, copy the new sender's **Phone number ID**. The temporary test token on that page is only for testing. For daily production reminders, create a system user in **Meta Business Settings > Users > System users**, assign the WhatsApp Business Account, and generate a long-lived token with `whatsapp_business_messaging` (and `whatsapp_business_management` for template management). Keep the token out of Git and chat.
3. In **WhatsApp Manager > Message templates**, create an English (US) template named `mannam_order_reminder`. Submit it for approval. Proposed body, with variables in this exact order:

   ```text
   Mannam order reminder for {{1}}. Client: {{2}}. Product: {{3}}. Quantity: {{4}}. Cake message: {{5}}. Check https://mannam-expense.web.app/orders for additional details.
   ```

   Example values: `tomorrow`, `Riya`, `Custom cake`, `2 lb`, `Happy Birthday Riya`. Request Utility classification if Meta accepts it; Meta decides the final category and associated price. Wait until the template status is **Approved**.
4. Set the Firebase secret interactively on a trusted computer:

   ```text
   firebase functions:secrets:set MANNAM_WHATSAPP_CONFIG --project cognylync
   ```

   Enter one JSON object like this, substituting the real sender ID, token, and recipient number in international format without `+`:

   ```json
   {"phoneNumberId":"SENDER_PHONE_NUMBER_ID","accessToken":"SYSTEM_USER_ACCESS_TOKEN","recipients":["919903513996"],"templateName":"mannam_order_reminder","language":"en_US"}
   ```

5. From the repository root, run `npm run deploy:firebase:reminders`. This deploys only Functions; the normal Hosting and Firestore rules deployments remain separate.

The separate sender route does not need a coexistence provider subscription. The Firebase project must stay on its billing-enabled plan for scheduled Functions. Meta may charge per template message. These functions have **not** been deployed; reminders will not be sent until the approved template, token, Firebase secret, and deployment are complete.

Run `npm test` inside this directory to check India date boundaries, eligible statuses, and the message fields.
