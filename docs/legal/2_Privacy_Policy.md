# 2 · Privacy Policy

*Last updated: \[DATE\] · v2 draft, August 19, 2026*

This explains what we collect, why, how long we keep it, and what you can do about it. Biometric data is covered in more detail in the separate Biometric Data Consent and Policy, which you must accept before any photograph is processed.

The short version: **we work from one photograph of your face, we never ask for photographs of your body, we delete your photograph after we've measured what we need, we keep numbers rather than images, and we never sell your data to anyone.**

## 1\. Who we are

Shoop Inc., \[REGISTERED ADDRESS\], is the controller of your personal data. Contact: [hello@shoop.email](mailto:hello@shoop.email).

*Position (replacing the prior counsel question):* Shoop serves the United States only and geo-gates account creation from the EU and UK. No EU Article 27 representative and no UK representative are required, and no Data Protection Officer is required at current scale. The triggers that reopen this: marketing to EU/UK users, EU/UK merchant arrangements, or lifting the geo-gate.

## 2\. What we collect

| Category | Examples | Why |
| :---- | :---- | :---- |
| Account | Name, email, date of birth, password hash | To give you an account and enforce the age gate |
| Questionnaire | Height, comfort constraints, climate, style preferences, occasions | To recommend clothing that fits your life |
| Photograph | One face photo | To measure you and build your digital twin. Deleted after extraction. |
| Derived measurements | Color values and proportions, each with a confidence value | To generate styling. Covered by the Biometric Consent. You can view and correct these in Settings. |
| Renders | Images of your digital twin wearing garments | To show you how something looks before you buy |
| Activity | Items viewed, verdicts shown, reactions, saved looks, friend votes sent and received, purchases completed | To improve what we show you, and to measure whether our advice is any good |
| Transactions | Orders placed through Shoop | To operate the service and account for commission |
| Technical | IP address, device and browser type, approximate location | Security, fraud prevention, and enforcing the regions where Shoop is available |

**We never ask for a photograph of your body.** Body characteristics used for fit are inferred and correctable. **Weight is optional and is used only for sizing;** it is not used by any styling recommendation, and the product works without it.

## 3\. Where the processing happens

**Processing is server-side.** Your photograph is uploaded to our infrastructure and analyzed there to derive your measurements and create your digital twin. **The source photograph is deleted once extraction completes, and in any event within \[24 hours — CONFIRM WITH ENGINEERING\] of upload.** What persists afterward is the derived numbers and your twin — no photograph, and no face template.

*Position:* the drafting no longer claims in-browser processing, because that is not the current architecture. The protective posture is process-and-delete: minimal residence time for the image, numbers-only persistence. If extraction later moves on-device, this section will be updated to say so — and not before.

## 4\. What we do not do

- We do not use your photograph or measurements to train artificial intelligence models.  
- We do not sell your personal data, and we have not sold it in the preceding 12 months. We do not share it with advertisers.  
- We do not use your data to target advertising to you anywhere.  
- We do not show your data to other users except where you deliberately share a look.  
- We do not use your photograph or any derived data to identify you or anyone else, and we do not operate or contribute to any facial-recognition system.

## 5\. Who we share with

| Recipient | What they receive | Why |
| :---- | :---- | :---- |
| **FASHN** (render provider) | Your photograph (as image bytes) and a garment image, for the duration of the render. FASHN's public API has no deletion call we can invoke. They publish that CDN outputs expire after three days. Request records may remain in their dashboard. We delete our copies. | To generate the try-on render |
| **OpenAI** | Your photograph during extraction | To derive measurements |
| **Anthropic** | Your derived numbers and preferences during styling | To produce styling output |
| Cloud hosting (**Railway**) | Encrypted data at rest | To run the service |
| Checkout partner \[Rye\] and payment processors | Order and payment details, which we never see in full | To complete purchases you choose to make |
| Retailers | Order details when you buy — never your photograph, never your measurements | To fulfil your order |
| People you share with | The specific look you sent, and your first name | Because you chose to send it |

*Position on the render provider (replacing the prior counsel question):* the provider is named here, and in the Biometric Consent, because a user consenting to face processing should know where the image goes. The contract with the render provider must contain, at minimum: processing on our documented instructions only; deletion of the image on completion of the render and certification of deletion on request; no use of any user image for training, improvement or any purpose of the provider's own; no onward sub-processing without written approval; security measures appropriate to biometric-adjacent data; and breach notice without undue delay. \[ACTION: countersigned DPA with FASHN containing these terms — obtain before publication.\]

*Position on transfers (replacing the prior counsel question):* users are in the US and production infrastructure is hosted in the US \[CONFIRM REGIONS WITH ENGINEERING\]. No cross-border transfer mechanism is required for the consumer data flow. Administrative access by company personnel from outside the US (Lebanon) is documented in our internal security policy as controlled remote access to US-hosted systems. If EU/UK users are ever onboarded, standard contractual clauses become the mechanism and this section will be rewritten first.

We instruct processors to delete data where their contract and API allow it. FASHN does not offer a deletion API; we delete our copies and rely on their published three-day CDN expiry for theirs.

## 6\. How long we keep things

| Data | Retention |
| :---- | :---- |
| Source face photograph | Deleted after extraction, at most \[24 hours\] |
| Derived measurements and twin | Deleted on your request, on account closure, or 3 years after your last interaction with Shoop — whichever comes first (see the Biometric Consent) |
| Account and questionnaire | Until you close your account, then \[90\] days |
| Renders | Until you delete them or close your account |
| Shared links | \[7\] days from creation, then permanently unavailable |
| Transactions | \[7\] years, as required for tax and accounting |
| Technical logs | \[12\] months |

## 7\. Your rights

Wherever you live in the US, we give you the same controls: see what we hold, correct anything that is wrong (including every inferred measurement, in Settings), delete your data, get a copy in a portable format, and withdraw consent — including biometric consent — at any time. California residents: these are your CCPA rights, honored for everyone; we do not sell or share personal information as the CCPA defines those terms, and we will never treat you worse for exercising a right.

Email [hello@shoop.email](mailto:hello@shoop.email). We respond within \[30\] days, free.

## 8\. Security

Encryption in transit and at rest. Access limited to staff who need it, logged and reviewed. Share links are unguessable, expire, and are excluded from search indexing. We will notify you and the relevant regulator of a breach affecting your data within the period the law requires, and faster if we can.

## 9\. Children

**Shoop is for users 13 and older.** We ask date of birth at signup and do not knowingly collect data from anyone under 13\. If we discover that we have, we delete it, including any biometric data, without waiting for a request. Report a suspected under-13 account to [hello@shoop.email](mailto:hello@shoop.email).

## 10\. Where Shoop is available

The United States. Account creation from the EU and UK is not available, and we do not target the service there. If that changes, this policy is updated first, including the additional rights that apply in those regions.

## 11\. Changes

We tell you before any material change, and we never apply a change to biometric processing retroactively.  
