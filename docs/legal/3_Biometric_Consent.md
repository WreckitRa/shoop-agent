# 3 · Biometric Data Consent and Policy

*This is a separate consent. It is presented on its own screen, immediately before the photo upload control, and must be accepted by an affirmative act before any photograph is processed. It is not bundled into the Terms of Service, and acceptance of the Terms does not constitute acceptance of this. This page also serves as our publicly available retention schedule and destruction guidelines.*

*Position on form and signature (replacing the prior counsel question):* this document follows BIPA section 15(b): written notice that biometric information is being collected, the specific purpose, the length of term, and a written release obtained before collection. The release is executed electronically — an unticked box affirmatively ticked by the user — which satisfies the written-release requirement under the federal E-SIGN Act and state UETA equivalents; no wet signature is required. Placement: a dedicated screen in the flow, after account creation, before the upload control is enabled. Engineering logs the tick with timestamp, document version and user id, and retains that log as long as the consent is relied on.

## 1\. What we are asking

To style you, Shoop needs to measure you. It does that from one photograph of your face.

We are asking your permission to derive numerical measurements from that photograph. In some places the law calls this biometric information and treats it as sensitive. We agree that it is, which is why this is a separate page and not a line in a long document.

**We never ask for a photograph of your body.** Body characteristics used for fit are inferred from your face photograph and your questionnaire answers, and you can view and correct every one of them in Settings.

## 2\. Exactly what we derive

From your face photograph:

- Color values of your skin, hair and eyes  
- Facial and neck proportions  
- Inferred body proportions used for fit — shoulder to hip, torso to leg, and similar — expressed as numbers with a confidence value, and correctable by you

**We do not create or store a faceprint, a face template, or any identifier capable of recognizing you in another photograph.** We do not perform facial recognition. We do not estimate your age, gender, ethnicity, emotional state, or health. Height comes from what you tell us; weight is optional and used only for sizing.

## 3\. Why we need it

For one purpose only: to recommend clothing that suits you, and to render garments on your digital twin so you can see them before you buy.

**We will not use it for anything else without asking you again.** If we ever want to, we will come back with a new consent, and you will be free to say no and keep using the service as before.

## 4\. Where your photograph goes, by name

Your photograph is uploaded to our servers and processed there. Two named providers touch it:

- **OpenAI** — analyzes the photograph to derive the measurements above  
- **FASHN** — renders garments on your digital twin

**Your photograph is deleted from our systems once extraction and twin creation are complete, and in any event within 24 hours of upload.** What persists is the derived numbers and your twin.

FASHN's public API has no deletion instruction we can call or verify. Their documentation states that CDN-delivered outputs expire after three days, and request history may remain in their dashboard. We delete our copies immediately.

## 5\. What this is not

**This is not a health assessment.** We derive proportions in order to recommend clothing. Nothing we produce is a medical opinion.

**This is not a rating of you.** Shoop scores garments and outfits. It does not score, rank or rate a person, and it is built so that it cannot.

## 6\. Retention schedule and destruction guidelines

| What | Destroyed |
| :---- | :---- |
| Your photograph | On completion of extraction, at most \[24 hours\] after upload |
| Derived measurements | On your deletion request, on withdrawal of this consent, on account closure, or **3 years after your last interaction with Shoop** — whichever comes first |
| Your twin and renders | The same |

*Position (replacing the prior counsel question):* the schedule adopts the BIPA statutory outer bound — destruction when the purpose is satisfied or within 3 years of the individual's last interaction, whichever is first — in place of the earlier \[24 months\] placeholder, with earlier triggers (request, withdrawal, closure) stated. This page is linked from the site footer and from the consent screen, which satisfies the public-availability requirement; it also appears in the Privacy Policy retention table.

**Deletion is permanent.** When a trigger occurs, we destroy the measurements, twin and renders in our systems. FASHN does not expose a deletion API; their published CDN retention is three days. We keep no copy for training, research, or anything else. An automated job enforces the 3-year trigger without waiting for a request. Each automated or requested deletion is logged with a timestamp.

## 7\. Who else sees it

The named providers in section 4, for the purposes stated. Nobody else. We do not sell, lease, trade, or disclose your biometric information for anyone's commercial benefit, and we do not use it to train any model, ours or anyone else's. This is a permanent commitment.

## 8\. Withdrawing

Withdraw at any time in Settings or by emailing [hello@shoop.email](mailto:hello@shoop.email). When you do: your measurements, twin and renders are deleted; your account stays open; you can keep using Shoop with questionnaire answers alone.

**Withdrawing costs you the twin. It does not cost you the account.**

## 9\. Your acknowledgement

By ticking the box you confirm:

1. You have read this document.  
2. You are at least 13 years old.  
3. The photograph is of you and you have the right to upload it.  
4. You permit Shoop Inc. to collect, store and use biometric information as described here, for the purpose described here, for the period described here, including processing by the named providers in section 4\.  
5. You understand you can withdraw at any time.

**☐ I agree to Shoop measuring me from my photograph, as described above.**

*This box is not pre-ticked, is not bundled with any other consent, and is presented before the upload control is enabled. The tick is logged with timestamp, document version and user id.*  
