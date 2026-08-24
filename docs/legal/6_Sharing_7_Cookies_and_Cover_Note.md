# 6 · Sharing and Community Policy

*Last updated: August 19, 2026*

Shoop lets you send a look to friends and ask them to vote. This page covers what happens when you do.

## 1\. What gets shared

When you send a look, the people you send it to can see: the rendered image of your digital twin wearing the outfits; your first name; the garments in each look. They cannot see your measurements, your questionnaire answers, your other looks, or anything else about your account.

**A render shows your likeness.** Only send it to people you would be comfortable showing a photograph of yourself.

## 2\. Your consent at the point of sharing

*Position (replacing the prior counsel question):* yes — sharing a photorealistic render of an identifiable user with people outside the service requires its own consent, beyond the general biometric consent. Implemented as:

- **First share:** a one-time screen: "You're about to send a realistic image of you to people you choose. They don't need an account to see it. The link expires in \[7\] days and you can revoke it any time." Affirmative confirmation, logged.  
- **Every share:** the send screen states who can see it and when the link dies. Sharing is always initiated by you; Shoop never shares a render on its own.

## 3\. How the link works

Long and unguessable, listed nowhere; expires after \[7\] days; revocable by you at any time from your account; excluded from search indexing (no index header and robots directive); recipients need no account and we create none for them.

**We cannot prevent someone screenshotting what you send them.** No link-based sharing can. Send it to people you trust.

## 4\. Recipients

*Position (replacing the prior counsel question):* recipients have accepted no terms, so no contractual obligations can attach to them. The protections are therefore designed into the link — expiry, revocation, no index, no account creation, minimal data display — rather than promised on paper. The voting page displays the rules below as conditions of use of the page; they are house rules and design constraints, not a contract with the voter.

If you are voting: someone asked your opinion on clothes — that is the whole scope. Do not screenshot and redistribute what you were sent. Do not comment on the person's body; the question is about the garment. Do not use the link for anything other than voting.

## 5\. What we record about a vote

The option chosen, an optional short reason, and the first name the voter enters. Used to show the result and improve recommendations. Voters are not tracked, no profile is built for them, and no cookie beyond the strictly necessary is set on the voting page.

## 6\. Reporting and enforcement

If a Shoop link is used to harass you, or an image of you is shared without your permission, email [hello@shoop.email](mailto:hello@shoop.email). We disable the link immediately, before we investigate anything else. We may disable links, suspend or close accounts that breach this policy, and where the law requires, report to the appropriate authority.

---

---

# 7 · Cookie Policy

*Last updated: \[DATE\] · v2 draft, August 19, 2026*

We use a small number of cookies. Here is all of them.

| Type | Set by | What for | Can you refuse? |
| :---- | :---- | :---- | :---- |
| Essential | Shoop | Keeping you logged in, security, remembering your cart, remembering this cookie choice | No — the service does not work without them |
| Preferences | — | Region and display settings. Toggle ready. We do not currently set a preference cookie. | Yes |
| Analytics | — | Product usage. Toggle ready in the banner and Settings. We do not currently set an analytics cookie. | Yes |
| Affiliate attribution | Not set by Shoop. When you follow a product link, the retailer or their network may set cookies on *their* site. Network not confirmed. | So a retailer can attribute a visit that started on Shoop | Governed by the retailer's own cookie controls |
| Advertising | — | None. We do not run advertising cookies and we do not permit cross-site tracking from our pages. | — |

*Position (replacing the prior counsel question):* both the analytics provider and the affiliate-network cookies are disclosed here by name and category once engineering confirms the actual tools \[two confirmations bracketed above\]. For the US audience Shoop serves, the standard is notice plus opt-out for non-essential cookies — delivered by this page, the first-visit banner, and the Settings toggle; no prior-consent regime applies. Affiliate cookies set on the retailer's domain after a marked link-out are the retailer's and network's cookies, disclosed here for honesty and attributed at the point of the link per the Commission Disclosure. EU-style prior consent is not implemented because EU/UK users are geo-gated; if that changes, this policy and the banner are rebuilt first.

Manage non-essential cookies from the first-visit banner and any time afterwards in Settings.

---

---

# Cover note for counsel — what changed in v2, in one page

Nabil — every open question in the August 17 pack now has a company position drafted into the documents. The remaining brackets are pending **facts** (engineering confirmations, the Rye agreement, registered address), not pending advice. The positions, for your confirmation or correction:

1/ **Age: 13+, not 18+.** Neutral DOB gate, under-13 proactive deletion. Premise: COPPA floor plus biometric consent regimes above it. (ToS §3, Privacy §9, Biometric §9.)

2/ **Input truth: face photo only, body inferred and user-correctable.** All three documents now say so; the earlier "face and body photographs" drafting is gone.

3/ **Architecture truth: server-side, process-and-delete.** The in-browser processing claims are removed because they weren't true. Photo deleted post-extraction within \[24h — engineering to confirm\]. (Privacy §3, Biometric §4.)

4/ **BIPA §15:** dedicated consent screen before upload, electronic release via unticked box (E-SIGN/UETA), tick logged with timestamp/version/id. (Biometric preamble.)

5/ **BIPA retention:** the \[24 months\] placeholder is replaced by the statutory outer bound — purpose satisfied or 3 years from last interaction, whichever first — with earlier triggers stated; the Biometric page itself is the publicly available schedule, linked in the footer. (Biometric §6.)

6/ **Render provider:** FASHN (and the AI analysis provider) named to users; required DPA contents listed; **action item: countersigned DPA before publication.** (Privacy §5, Biometric §4.)

7/ **Transfers:** US users, US hosting → no mechanism needed; Beirut admin access documented internally; SCCs only if EU/UK ever opens. (Privacy §5.)

8/ **EU/UK scope: geo-gated out.** No Art. 27 rep, no DPO, withdrawal-right clause dormant with its trigger recorded. (Privacy §1, Returns §5.)

9/ **Merchant of record:** affiliate flow confirmed retailer-sells; **the Rye flow is the one open fact** — bracketed hard in Returns §1, must be confirmed against the Rye agreement before publication, especially for multi-retailer carts.

10/ **Liability:** US cap (greater of $100 or 12-month fees), savings clause for non-waivable rights, no EU/UK rider until direct foreign sales. (ToS §12.)

11/ **Disputes:** FAA arbitration, AAA consumer rules, Delaware law, remote hearings, class waiver, 30-day opt-out, small-claims carve-out, 60-day informal step, and a mass-arbitration batching provision — the batching paragraph is the one that most needs your drafting attention, it's the live 2026 risk. (ToS §13.)

12/ **ROSCA:** subscription clause drafted dormant; the compliance surface is specified as the checkout screen itself. (ToS §8.)

13/ **Commission claims:** substantiation file specified — signed engineering attestation, code-path documentation, an enforcing test in CI, quarterly re-verification. (Commission §2.)

14/ **Share consent:** distinct consent at first share plus per-share notice; recipient obligations replaced by design controls (expiry, revocation, noindex), with house rules on the voting page. (Sharing §2, §4.)

15/ **Cookies:** analytics and affiliate-network cookies to be named on confirmation; US notice-and-opt-out standard; EU consent regime moot via the gate. (Cookies.)

Engineering checklist created by these documents (unchanged from v1 plus): consent-tick logging; upload disabled until tick; deletion cascade to FASHN; share-link expiry/revocation/noindex; biometric-first deletion on closure; the 3-year inactivity job (was 24 months); DOB capture; commission-separation test in CI; photo auto-delete job; geo-gate on signup.

