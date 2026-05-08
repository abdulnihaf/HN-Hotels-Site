# Digital Signature Research — Blue-Collar Workforce, HN Hotels Pvt Ltd

**Scope:** Legal, technical, and operational analysis of digitally collecting signatures from 32 restaurant workers (cooks, helpers, cleaners, waiters; ₹18k–45k/month; Hindi/Bengali speakers; Aadhaar-linked mobile but no email, no computer) on three documents: (1) Salary-restructure amendment letter, (2) Service Rules & Code of Conduct (10pp), (3) Form 11 — EPF Composite Declaration.

**Bottom line up front:** Aadhaar OTP eSign, executed in front of the owner on a tablet, is legally valid, EPFO-acceptable, costs roughly ₹15–25 per signature, takes 2–4 minutes per worker once the document is staged, and does **not** require the worker to install any app or own an email address. Recommended provider: **Leegality** (primary) with **Digio** as fallback. Karnataka stamp duty does apply to the agreement; pay it as e-stamp on Kaveri Online before signing. Form 11 may be retained electronically by the employer — EPFO does not require employee DSC for it.

---

## 1. Legal validity under the IT Act, 2000

### 1.1 Section 3 vs Section 3A — Digital Signature vs Electronic Signature

Section 3 of the IT Act, 2000 covers the original "digital signature" — a PKI-based, asymmetric-key signature using a Class-2 / Class-3 Digital Signature Certificate (DSC) issued by a licensed Certifying Authority (CA). Each signer needs a USB hardware token. Useless for blue-collar workers.

Section 3A was inserted by the IT (Amendment) Act, 2008 and recognises a broader class — "electronic signatures" — that are **technology-neutral** so long as the technique is listed in the **Second Schedule** of the Act and meets the reliability tests of Section 3A(2): the signature must be (a) unique to the signer, (b) capable of identifying the signer, (c) under the sole control of the signer at the moment of signing, and (d) linked to the record such that any later alteration is detectable.

The Second Schedule was empty until **27 January 2015**, when MeitY issued **Notification G.S.R. 61(E)** — *"Electronic Signature or Electronic Authentication Technique and Procedure Rules, 2015"* — which inserted **"e-authentication technique using Aadhaar e-KYC services"** as the first listed method. That notification is the legal anchor for Aadhaar eSign. Subsequent amendments added "third-party trust services" (e.g., bank-account-verification-based signing) and other variants.

Section 5 then closes the loop: any law that requires a "signature" is satisfied by an electronic signature recognised under Section 3A. Section 10A confirms electronic contracts are not unenforceable merely because they were formed electronically.

[Leegality — Section 3A and the 2008 Amendments](https://www.leegality.com/blog/section3a) | [Leegality — Is Aadhaar eSign legal?](https://www.leegality.com/blog/law-around-aadhaar-esign)

### 1.2 First Schedule — what cannot be e-signed

IT Act §1(4) read with the **First Schedule** carves out five categories where the Act does not apply. These cannot be electronically signed:

1. Negotiable instruments (other than cheques) — Section 13, NI Act, 1881
2. Power-of-attorney — Section 1A, Powers-of-Attorney Act, 1882
3. Trusts — Section 3, Indian Trusts Act, 1882
4. Wills and other testamentary dispositions — Section 2(h), Indian Succession Act, 1925
5. Sale or conveyance of immovable property

**Employment contracts, salary amendment letters, service-rules acknowledgements, and Form 11 EPF declarations are NOT in this list.** They can be e-signed. MeitY further amended the First Schedule in October 2022 to relax the immovable-property carve-out for specific notified entities, but that does not affect us. [Leegality — First Schedule explainer](https://www.leegality.com/blog/first-schedule)

### 1.3 Aadhaar eSign with OTP — express legal recognition

Aadhaar eSign with mobile OTP is the most widely deployed Section-3A method. The signer enters their 12-digit Aadhaar (or VID), UIDAI sends a 6-digit OTP to the Aadhaar-registered mobile, the signer enters it, and CDAC/NSDL/Protean (the licensed eSign Service Providers, ESPs) issue a one-time PKI signing certificate in the signer's name and apply a PKCS#7 signature to the PDF. The PKI key never leaves the ESP HSM, so "sole control" is satisfied via Aadhaar OTP authentication at the moment of signing.

The **Controller of Certifying Authorities (CCA)** under MeitY currently licenses seven eSign Service Providers, including CDAC (e-Hastakshar), NSDL e-Gov / Protean, eMudhra, and Verasys. ASPs (Application Service Providers) like Leegality, Digio, SignDesk integrate with one or more ESPs. [eSign API Specifications v2.1 — CCA](https://cca.gov.in/sites/files/pdf/ACT/eSign-APIv2.1.pdf)

### 1.4 EPFO and Form 11

Form 11 (Composite Declaration) is filed *with the employer*, not directly with EPFO. The employer reviews it, derives KYC, and uploads relevant fields via the unified employer portal where the **employer's** DSC (Class-3, registered with EPFO) signs the upload. EPFO **does not require the employee to have a DSC or eSign** for Form 11. EPFO does, however, accept electronically signed copies retained by the employer as proof, and the EPFO COVID-period FAQ (May 2020) explicitly endorsed e-Sign for employer compliance filings. For HN Hotels: collect Form 11 via Aadhaar eSign from each worker, store the signed PDF in the personnel file, and use the data on the unified employer portal. [EPFO FAQ on DSC/e-Sign during lockdown](https://www.epfindia.gov.in/site_docs/PDFs/Circulars/Y2020-2021/Faq_dsc.pdf)

---

## 2. Aadhaar eSign mechanics for someone with no email

### 2.1 Email is not required

Standard eSign needs three things on the signer side: (a) the 12-digit Aadhaar / VID, (b) access to the SMS on the Aadhaar-registered mobile, (c) consent. Email is optional — providers use it only to deliver the signed-copy PDF afterwards. If the worker has no email, the **employer** receives the audit trail and signed copy and retains both.

### 2.2 Hand-on-tablet workflow

The flow that fits HN Hotels is "in-person, employer-led":

1. Owner opens the document on tablet/laptop in the eSign provider's signer view.
2. Worker reviews the document on the tablet (in Hindi/Bengali — see §4 on bilingual templates).
3. Worker types or dictates their Aadhaar number into the eSign panel on the tablet.
4. ESP triggers the OTP. SMS lands on the worker's own phone (Aadhaar-registered number).
5. Worker reads the OTP from their own phone, types it on the tablet.
6. ESP validates with UIDAI, generates the one-time signing certificate, applies PKCS#7 signature to the PDF, returns the audit trail.
7. Owner moves to the next worker. Total wall time: 3–5 minutes once the worker is in front of the tablet.

The worker installs nothing. They only need to receive an SMS.

### 2.3 Aadhaar mobile mismatch — the only real failure mode

The most frequent operational failure is "the worker's daily mobile is not the one registered with Aadhaar." UIDAI does **not** allow online mobile-number update — the worker must visit a UIDAI Permanent Enrolment Centre / Seva Kendra with the new SIM and pay ₹50. There is no API workaround; this is a UIDAI policy, not a provider gap. [UIDAI — Update Your Aadhaar](https://uidai.gov.in/en/my-aadhaar/update-aadhaar.html)

Practical mitigations before the signing day:

- Pre-flight SMS test: send each worker a test "1234" SMS and confirm receipt on the registered number.
- For mismatches, hand the worker the Seva Kendra address and a ₹100 note; reschedule signing 48–72 hours later.
- Fallback path: have the worker bring the SIM that *is* Aadhaar-linked physically to the signing session even if it is not their daily phone — a cheap dual-SIM feature phone works.
- If a worker cannot resolve the mismatch in time, fall back to **wet-ink + Aadhaar XML** (see §6.3) so the deadline does not slip.

### 2.4 Bulk operations and UIDAI's stance

UIDAI permits authentication for "any lawful purpose" with the explicit informed consent of the holder (Aadhaar Authentication and Offline Verification Regulations, 2021, Reg. 5–6). Employee onboarding and HR compliance is a routinely accepted purpose. There is no per-day cap on Aadhaar authentication for licensed ESPs, so 32 workers in a day is trivial. ASPs (Leegality, Digio) handle the bulk request orchestration — you upload one PDF template, generate 32 signing links / sessions, fire them in series at the tablet.

[UIDAI — Aadhaar Authentication & Offline Verification Regulations 2021](https://uidai.gov.in/images/The_Aadhaar_Authentication_and_Offline_Verifications_Regulations_2021.pdf)

---

## 3. Provider comparison (May 2026)

The CCA-licensed ESPs are NSDL/Protean, eMudhra, CDAC, Verasys, RailTel, IDfy and Capricorn. The **ASPs** are the customer-facing layer — they are who you actually buy from.

| Provider | Per-signature (Aadhaar OTP) | Minimums | Bulk / API | UX fit for HN Hotels |
|---|---|---|---|---|
| **Leegality** | Starts at ₹25 / Aadhaar eSign on the Basic plan; volume tiers bring this to ~₹10–15 at higher commitment. Basic plan has zero licence fee. | Pay-as-you-go credits; no monthly minimum on Basic | Robust API, "Auto-Switch to Best ESP" failover, Signer Face Match, geofencing, eStamp integration on Kaveri (Karnataka) | **Best fit.** Hindi/regional UI, in-person signing flow, eStamp built in, audit trail with §65B certificate auto-generated |
| **Digio** | Enterprise-only quotes, typically ₹10–20 / signature at 1k+ volume; not pay-as-you-go for SMBs | Sales call required; minimum annual commit ~₹1L+ | Excellent API, Aadhaar OTP/biometric, video KYC if needed | Overkill for 32-worker batch; revisit when scaling to 100+ |
| **SignDesk** | Plans from ₹499/month; per-signature ~₹15–20 | Monthly subscription | Aadhaar OTP, document templates, GST-invoice automation | Solid. Slightly weaker regional-language UI than Leegality |
| **eMudhra (emSigner / Bharat eSign)** | emSigner from ₹1,000/year unlimited (desktop signing); separate Aadhaar OTP eSign credits at ~₹10–15 | Annual licence | Mature, used by govt; API for ASP role | Better for B2B contracts; HR onboarding UX is dated |
| **NSDL eSign Gateway / Protean** | Wholesale ESP — charges ASPs roughly ₹5.90 per Aadhaar eSign as the ESP backend | Direct integration is heavy | Direct API but you become the ASP — security audit, CCA paperwork required | Don't integrate directly; use it via Leegality/Digio |
| **Zoho Sign** | Aadhaar eSign supported via eMudhra; from ₹699/user/month | Per-user subscription | Decent API, Zoho-stack integration | Good if you already use Zoho One; otherwise per-seat math is poor |
| **Adobe Acrobat Sign** | Aadhaar eSign supported via NSDL partnership | Enterprise pricing | Yes | English-only UI; not blue-collar friendly |
| **DocuSign India** | No first-class native Aadhaar eSign — partner integrations (eMudhra) only | Enterprise | Yes but Aadhaar path is bolted-on | Skip for this use case |
| **DrySign (Exela)** | Plans from ₹499/month; Aadhaar eSign included on higher tiers | Subscription | Yes | Workable but smaller market share |
| **SignSetu** | ₹15 / signature, no monthly minimum | None | API + portal | Cheap and transparent; smaller vendor — verify CCA empanelment of their ESP partner before committing PII |
| **Razorpay Sign / Zoop** | Embedded in Razorpay stack; ~₹15–20 / signature | RazorpayX account | Yes | Convenient if Razorpay payouts already used (HN Hotels does) |
| **Cashfree Aadhaar eSign** | ~₹15–25 / signature | Cashfree account | Yes | Same as Razorpay — convenient stack-fit |

[Leegality pricing](https://www.leegality.com/pricing) | [Digio pricing on Capterra](https://www.capterra.com/p/156204/Digio-eSign/) | [Protean eSign services](https://www.proteantech.in/services/e-sign/) | [eMudhra emSigner](https://emudhra.com/en-in/emsigner/) | [SignSetu pricing](https://www.signsetu.in/guides/aadhaar-esign)

### 3.1 Recommended provider for HN Hotels: Leegality

**Why:**
- Lowest friction for the in-person, employer-led flow described in §2.2 — Leegality's "embedded signer" link works on a tablet without sign-in.
- Built-in **Karnataka eStamp via Kaveri Online integration** — the salary amendment can be stamped (₹100–500) and signed in one workflow rather than as two manual steps.
- Per-signature ₹25 on Basic; for ~96 signatures (32 workers × 3 docs) the spend is roughly **₹2,400** plus stamp duty.
- Auto-switches between NSDL/eMudhra/CDAC ESPs if one is down — eliminates the "OTP service unavailable" failure mode.
- Issues a Section-65B certificate automatically with every signed PDF, which is what makes the document admissible in evidence (see §7.4).

**Account setup:** ~30 minutes on Leegality's self-serve onboarding. Need PAN + GST + bank account of HN Hotels Pvt Ltd. Typical KYC turnaround 24–48 hours.

---

## 4. Practical workflow for HN Hotels

### 4.1 One-time setup (pre-signing day)

1. **Stamp the templates.** The CTC amendment letter is an "agreement amending an existing agreement" — stamp under Article 5 of the Karnataka Stamp Act Schedule. Buy e-stamps on Kaveri Online (or via Leegality's eStamp module). Pay ₹200 per amendment as a safe ceiling. Service Rules and Form 11 do not require stamping (Service Rules is unilateral notice + acknowledgement; Form 11 is a statutory form).
2. **Translate.** Produce Hindi and Bengali versions of the salary amendment summary (1-page TLDR) and the Service Rules acknowledgement page. Full English text remains the operative version with a clause stating "the worker has had this document explained in Hindi/Bengali by the employer."
3. **Build the document set in Leegality.** One PDF per worker per document. Use mail-merge so name, designation, old CTC, new CTC are pre-filled.
4. **Pre-flight SMS check.** Two days before, send each worker a test "Aadhaar SMS test from HN Hotels" SMS to the Aadhaar-registered mobile on file. Anyone who does not receive it is routed to a Seva Kendra **before** signing day.
5. **Aadhaar consent script.** Print the UIDAI-mandated consent declaration in English/Hindi/Bengali (see §5).

### 4.2 Per-worker signing session — target 7 minutes

| Min | Step |
|---|---|
| 0:00 | Worker sits down. Owner opens the worker's three signing links on the tablet. |
| 0:30 | Owner explains, in the worker's language, what each document does, the new CTC structure, and that ESI will start being deducted. |
| 2:00 | Worker reads the Hindi/Bengali summary on screen. |
| 3:00 | Worker types or dictates their Aadhaar number. |
| 3:30 | Worker reads the consent statement aloud (printed copy in front of them) and clicks "I consent." |
| 4:00 | OTP SMS lands on worker's phone. |
| 4:30 | Worker reads OTP, owner types it (or worker types). PKCS#7 signature applied. |
| 5:00 | Repeat for document 2 (re-trigger OTP) and document 3 (re-trigger OTP). |
| 7:00 | Done. Owner prints two copies of each signed PDF — one for worker to take home, one for personnel file. |

For 32 workers at 7 minutes each = **~3.7 hours of focused work** if done in one batch. Practical: 8 workers per evening over four evenings.

### 4.3 What goes wrong and how to recover

| Failure | Recovery |
|---|---|
| OTP not received within 90 sec | Press "Resend OTP." If still nothing after 2 retries, abort, send worker to Seva Kendra. |
| Internet drops mid-signing | Aadhaar OTP is single-shot — the OTP expires (30 sec window typically). Reconnect, restart that document's signing session. Already-signed documents are saved. |
| Worker's Aadhaar registered to old mobile | Reschedule. Do not improvise with someone else's mobile — that voids consent and may be a UIDAI violation. |
| Worker refuses the salary amendment | Don't force eSign. Step out of the eSign flow, hand them the printed letter, log the refusal in the witness register, follow the procedure in `20_SOP_NOTICE_VIOLATION.md`. |
| Worker has no Aadhaar at all (Bengali migrant just arrived) | Use wet-ink + photo ID until Aadhaar is obtained. Document is enforceable under §10 of the Indian Contract Act regardless of how it was signed; eSign is one valid form among many. |
| ESP downtime (NSDL or eMudhra) | Leegality auto-switches. If using a single-ESP provider, wait 30 min and retry, or fall back to wet-ink. |

### 4.4 Audit trail and post-signing

For every signed document, Leegality (or any compliant ASP) issues:
- The signed PDF with embedded PKCS#7 signature, visible signature stamp showing the signer's name, Aadhaar last-4, timestamp.
- A separate **Certificate of Completion** PDF listing the IP, geolocation (if enabled), exact timestamp of OTP issue + verification, and the signing certificate's serial number.
- A **Section 65B(4) certificate** signed by the ASP, attesting that the PDF was generated from a properly functioning computer system.

Retain all three for each worker for 7 years (longer than the EPF retention period).

### 4.5 Delivering the signed copy back to the worker

Worker has no email. Options, in order of preference:

1. **Print and hand over** at the same session (cheapest, simplest, one A4 sheet per document).
2. **WhatsApp the PDF** to the worker's phone (most have WhatsApp even if no email). Use the Aadhaar-registered number. Note in the audit register that the PDF was sent.
3. **Owner email + worker's family member email** if any (only with worker's explicit consent).

Print is the default. WhatsApp is the convenience supplement.

---

## 5. Privacy, Aadhaar consent, data storage

### 5.1 Mandatory consent before authentication

UIDAI Regulations 2021 (Reg. 6) and the Aadhaar Notice and Consent Guidelines require, before each authentication:

- A clear statement of the **purpose** of authentication.
- Information that submission is **voluntary** and that alternatives exist.
- Explicit, recorded **consent** of the holder.

Use this script (Hindi/Bengali translations recommended):

> *"I, [Name], consent to HN Hotels Pvt Ltd using my Aadhaar number for the limited purpose of electronically signing my employment-related documents (CTC amendment, Service Rules acknowledgement, and Form 11 EPF declaration) using the Aadhaar OTP eSign service notified under Section 3A of the Information Technology Act, 2000. I understand that my Aadhaar number will not be stored by HN Hotels except in masked form (last 4 digits) on the signed PDF, and will not be used for any other purpose. I have been informed that I may decline and provide a wet-ink signature instead."*

Embed this as a checkbox + "I agree" button in the eSign flow **and** keep a printed signed copy in the worker's file.

[UIDAI — Aadhaar Notice and Consent Guidelines](https://www.uidai.gov.in/en/about-uidai/legal-framework/rules/1327-authentication-documents/16282-aadhaar-notice-and-consent-guidelines.html)

### 5.2 Purpose limitation

Aadhaar Act §29 and Regulation 8 of the 2021 Regulations forbid using Aadhaar information for any purpose other than the one consented to. **Do not** reuse the Aadhaar OTP eSign session to authenticate the worker into anything else (POS, attendance, payroll). The eSign authentication is one-shot, scoped to the document being signed.

### 5.3 Storage rules — what you may and may not retain

You may retain:
- The **signed PDF** (which contains the worker's name and the last 4 digits of Aadhaar — that is masked Aadhaar and is permitted).
- The **eSign Certificate of Completion** (transaction ID, timestamp, no full Aadhaar number).
- The **§65B certificate** issued by the ASP.

You may **not** retain:
- The full 12-digit Aadhaar number in any HR database or spreadsheet (this would trigger Aadhaar Data Vault requirements — Reg. 17 of 2021 Regs — which are heavy: HSM-backed encryption, segregated DB).
- The OTP itself (it expires in 30 sec anyway).
- Biometric data — never collect Aadhaar fingerprint/iris for eSign; OTP is sufficient.

If a worker's full Aadhaar must appear in a separate doc (e.g., bank-account opening attached to the offer letter), redact to last-4 in your scanned copy and retain the full version only on UIDAI's encrypted offline-XML format if needed at all.

### 5.4 DPDP Act 2023 overlay

The Digital Personal Data Protection Act, 2023 came into force in stages from 2024. Aadhaar number is "personal data." HN Hotels as a Data Fiduciary needs (a) consent notice in plain language including Hindi/Bengali, (b) a stated retention period, (c) a Data Principal grievance contact. For 32 workers below the "significant data fiduciary" threshold the obligations are light, but the consent script in §5.1 already covers them.

---

## 6. Compliance framework — beyond IT Act

### 6.1 Section 5 — electronic record satisfies "writing"

Whenever any law requires a record to be in writing, an electronic record stored, retained, or made available electronically satisfies that requirement (IT Act §4). Whenever a law requires a signature, an electronic signature recognised under Section 3A satisfies it (§5). The Industrial Employment (Standing Orders) Act, the Karnataka Shops & Establishments Act, and the EPF & MP Act all require "writing" — all are satisfied by Aadhaar eSign.

### 6.2 Section 10A — electronic contracts

Confirms that contracts formed via electronic means cannot be denied enforceability "merely on the ground that electronic means were used." Closes the loop on offer-acceptance-consideration via electronic medium.

### 6.3 Karnataka Stamp Act and stamping of e-signed contracts

The Karnataka Stamp (Amendment) Act 2023 (notified 3 Feb 2024) modernised the schedule and **explicitly extended the definition of "instrument" to include electronic records**. So every e-signed agreement chargeable to duty must still be stamped — stamping is independent of whether the signature is wet or electronic.

For the **CTC amendment letter**: it is an agreement amending an existing employment contract. Karnataka Stamp Act, Article 5(j) — "Agreement or memorandum of agreement, if not otherwise provided for" attracts ₹200 stamp duty. Pay it via Kaveri Online e-stamp (https://kaveri.karnataka.gov.in/) before signing; embed the stamp certificate number in the PDF or attach it as page 1.

For **Service Rules acknowledgement**: this is a unilateral notice + acknowledgement, not a bilateral agreement. The acknowledgement is a receipt; not stamp-duty-attracting. To be safe, attach a ₹100 stamp paper for the bundled "I have read and accept the Service Rules" page.

For **Form 11**: statutory form, no stamp duty.

The Supreme Court has held (multiple rulings 2020–2024) that an unstamped or under-stamped agreement is **inadmissible in evidence** until stamp duty + penalty is paid. So under-stamping does not invalidate the contract but cripples it in any future dispute. Pay the stamp duty up front; the cost is trivial. [Mondaq — Karnataka Stamp Amendment 2023](https://www.mondaq.com/india/contracts-and-commercial-law/1429310/changes-to-the-applicable-stamp-duty-basis-the-karnataka-stamp-amendment-act-2023) | [eSign.ai — How to pay stamp duty on e-signed documents](https://www.esign.ai/blog/pay-stamp-duty-electronically-signed-document-india-states)

### 6.4 Indian Evidence Act §65B (now §63 BSA 2023) — admissibility

To rely on the signed PDF in any court / labour tribunal, you need the Section 65B(4) certificate (now Section 63(4) under the Bharatiya Sakshya Adhiniyam 2023, which superseded the Evidence Act on 1 July 2024). Supreme Court in **Arjun Panditrao Khotkar v Kailash Kushanrao (2020) 7 SCC 1** held the §65B certificate is mandatory and overruled Shafhi Mohammad. Leegality / Digio auto-issue a §65B certificate for every signed PDF — keep it filed alongside the document. Without the certificate the PDF is technically inadmissible. [Cyril Amarchand — §65B revisited](https://corporate.cyrilamarchandblogs.com/2020/07/section-65b-of-the-indian-evidence-act-1872-requirements-for-admissibility-of-electronic-evidence-revisited-by-the-supreme-court/)

### 6.5 Trimex and the e-contract baseline

**Trimex International FZE v Vedanta Aluminium Ltd (2010) 3 SCC 1** — SC held that a contract concluded via email exchange is binding. Combined with Section 10A, this is the doctrinal anchor that "the medium does not matter; offer + acceptance + consideration + capacity does." Aadhaar eSign is a far stronger evidentiary record than email, so the Trimex line of authority covers us a fortiori.

---

## 7. Recent rulings and circulars (2023–2026)

- **MeitY Notification G.S.R. 776(E), 5 Oct 2022** — amended the First Schedule of the IT Act to permit electronic signature on a class of immovable-property documents for specified entities. Confirms the Schedule is being expanded, not contracted. [PIB release](https://www.meity.gov.in/) (search archive for 2022 IT Act notifications).
- **EPFO Circular C-I/E-Comm/2020 (May 2020) + extensions** — accepted DSC and e-Sign for employer compliance filings during COVID; subsequent circulars made permanent the use of e-Sign for KYC approvals on the Unified Portal.
- **Arjun Panditrao Khotkar v Kailash Kushanrao (2020) 7 SCC 1** — §65B(4) certificate mandatory.
- **Bharatiya Sakshya Adhiniyam 2023 (BSA)** — replaced Evidence Act 1872 from 1 July 2024. §63 of BSA mirrors §65B but updates language to natively cover electronic records, IoT devices, and "electronic and digital records" as documents. eSigned PDFs continue to be admissible with the equivalent §63(4) certificate.
- **A. Suresh Kumar v Amit Agarwal, Madras HC 2023** — held that a digitally signed agreement under §3A is on equal footing with a wet-signed one, rejecting the argument that the absence of a manual signature defeated enforceability of an MoU.
- **Karnataka Stamp (Amendment) Act 2023 (notified 3 Feb 2024)** — extended "instrument" to electronic records; rebased duties on 50+ instruments.
- **DPDP Act 2023** (operative in stages from late 2024) — overlays consent/notice/grievance obligations on Aadhaar processing for HR purposes.

---

## 8. Practical alternatives if Aadhaar eSign fails

Ranked by legal strength.

### 8.1 Wet-ink signature on stamped paper (gold standard)

Always works. Slowest. Use as fallback for any worker who cannot complete Aadhaar OTP eSign on the day. Take a photo of the signed sheet, store both physical and scanned copy.

### 8.2 Wet-ink + Aadhaar XML offline KYC

Worker generates an Aadhaar Paperless Offline e-KYC XML on UIDAI's site (digitally signed by UIDAI, no PII number disclosed). Worker signs document in wet-ink. Employer attaches Aadhaar XML as an annexure to evidence the signer's verified identity. Strong evidentiary value; no internet OTP needed at signing time. [UIDAI — Aadhaar Paperless Offline e-KYC](https://uidai.gov.in/en/ecosystem/authentication-devices-documents/about-aadhaar-paperless-offline-e-kyc.html)

### 8.3 Click-wrap acceptance of Service Rules

For the **Service Rules acknowledgement** specifically, a click-wrap "I have read and accept" link sent over WhatsApp / SMS to the worker's phone is enforceable per **Trimex** and the iPleaders / Lexology consensus, **provided** (a) reasonable notice — full Service Rules text is shown before the button, (b) affirmative click required, (c) timestamp + IP captured. Weaker than Aadhaar eSign because identity verification is only "person who has access to this phone number" rather than UIDAI-verified. Use only as fallback for non-financial acknowledgements; do **not** use for the salary amendment letter (which alters the employment contract). [iPleaders on click-wrap](https://blog.ipleaders.in/enforceability-of-clickwrap-agreements-in-india-all-you-need-to-know/)

### 8.4 SMS reply acceptance

"Reply YES to confirm" — admissible per **Trimex** as offer-acceptance via electronic means. Identity is "person in possession of the mobile." Weak; reserve for low-stakes notices (shift change, holiday roster).

### 8.5 Photographed wet-signed paper + WhatsApp confirmation

Worker signs paper with wet ink. Owner takes a photograph. Worker WhatsApps a confirmation message ("I have signed the salary amendment letter today") to the employer's number. The wet signature is the legal anchor; the WhatsApp message is a corroborating timestamp. Practical and legally robust.

### 8.6 Biometric thumbprint via mobile app

Most providers (Digio, Signzy) offer Aadhaar **biometric** eSign — the worker presses their thumb on a Mantra/Morpho biometric reader plugged into the tablet. UIDAI matches the print. This is the **strongest** form of eSign (biometric beats OTP for sole-control proof). Costs are higher (~₹50/signature plus ₹2,000–4,000 one-time for the reader). Recommended as a permanent fallback option for HN Hotels — buy one Mantra MFS-100 reader (~₹2,800), keep it in the back office, use it whenever a worker has a mobile mismatch.

---

## 9. Specific recommendation for HN Hotels

**Primary stack:**
- ASP: **Leegality** (Aadhaar OTP eSign on Basic plan)
- Stamping: **Kaveri Online e-stamp** integrated through Leegality, ₹200 per amendment letter
- Backup: **Mantra MFS-100 fingerprint reader** for biometric-eSign fallback (~₹2,800)
- Print: any networked printer for take-home copies

**Cost envelope (32 workers, 3 docs each = 96 signatures):**
- eSign credits: 96 × ₹25 = **₹2,400**
- Stamp duty (CTC amendments only, 32 × ₹200): **₹6,400**
- Biometric reader one-time: **₹2,800**
- **Total ≈ ₹11,600**

**Time envelope:** 4 evenings × 8 workers × 7 minutes = **~3.7 hours of owner time** spread over a week.

**Execution checklist:**

1. Owner registers HN Hotels Pvt Ltd on Leegality, completes KYC.
2. Translate the salary-amendment summary and Service Rules acknowledgement into Hindi and Bengali.
3. Pre-flight SMS test to all 32 workers — fix Aadhaar mobile mismatches via Seva Kendra.
4. Buy 32 ₹200 e-stamps on Kaveri Online, embed certificate numbers into amendment letters.
5. Mail-merge personalised PDFs.
6. Schedule four evenings, 8 workers per evening.
7. For each session: open Leegality signing link, run consent script (printed, in language), capture Aadhaar + OTP, print two copies, hand one to worker.
8. File Certificate of Completion + §65B certificate for each signature.
9. Upload Form 11 data to EPFO Unified Employer Portal using employer's Class-3 DSC.

---

## Sources

- [Leegality — Section 3A and the 2008 Amendments of the IT Act](https://www.leegality.com/blog/section3a)
- [Leegality — Is Aadhaar eSign legal and valid in India? (IT Act 2000)](https://www.leegality.com/blog/law-around-aadhaar-esign)
- [Leegality — Amendment to Schedule I of the IT Act](https://www.leegality.com/blog/first-schedule)
- [Leegality — How to use Aadhaar based eSign to sign document online](https://www.leegality.com/blog/esign-document-using-aadhaar)
- [Leegality — Aadhaar eSign FAQ](https://www.leegality.com/aadhaar-esign-faq)
- [Leegality — Pricing](https://www.leegality.com/pricing)
- [CCA — eSign API Specifications v2.1](https://cca.gov.in/sites/files/pdf/ACT/eSign-APIv2.1.pdf)
- [CCA — Template ESP-ASP agreement](https://cca.gov.in/sites/files/pdf/esign/CCA-ASP-ESP-AGMT.pdf)
- [UIDAI — Aadhaar (Authentication and Offline Verification) Regulations 2021](https://uidai.gov.in/images/The_Aadhaar_Authentication_and_Offline_Verifications_Regulations_2021.pdf)
- [UIDAI — Aadhaar Notice and Consent Guidelines](https://www.uidai.gov.in/en/about-uidai/legal-framework/rules/1327-authentication-documents/16282-aadhaar-notice-and-consent-guidelines.html)
- [UIDAI — Aadhaar Paperless Offline e-KYC](https://uidai.gov.in/en/ecosystem/authentication-devices-documents/about-aadhaar-paperless-offline-e-kyc.html)
- [UIDAI — Update Your Aadhaar (mobile number)](https://uidai.gov.in/en/my-aadhaar/update-aadhaar.html)
- [EPFO — FAQ on Employer DSC / e-Sign](https://www.epfindia.gov.in/site_docs/PDFs/Circulars/Y2020-2021/Faq_dsc.pdf)
- [Digio — DigiSign Aadhaar eSign](https://www.digio.in/digi-sign/)
- [Digio eSign on Capterra (pricing notes)](https://www.capterra.com/p/156204/Digio-eSign/)
- [eMudhra — emSigner](https://emudhra.com/en-in/emsigner/)
- [Protean (NSDL e-Gov) — eSign Services](https://www.proteantech.in/services/e-sign/)
- [SignSetu — Aadhaar eSign 2026 guide & pricing](https://www.signsetu.in/guides/aadhaar-esign)
- [Adobe — Aadhaar digital signatures in Acrobat Sign](https://www.adobe.com/in/acrobat/roc/blog/aadhaar-linked-digital-signatures.html)
- [DocuSign — eSignature Legality in India](https://www.docusign.com/products/electronic-signature/legality/india)
- [Mondaq — Karnataka Stamp (Amendment) Act 2023](https://www.mondaq.com/india/contracts-and-commercial-law/1429310/changes-to-the-applicable-stamp-duty-basis-the-karnataka-stamp-amendment-act-2023)
- [Karnataka Stamp Act 1957 — Schedule (IGR Karnataka)](https://igr.karnataka.gov.in/storage/pdf-files/Acts-Rules/THE%20KARNATAKA%20STAMP%20ACT%201957%20-%20Schedule.pdf)
- [eSign.ai — Stamp duty on e-signed documents in India](https://www.esign.ai/blog/pay-stamp-duty-electronically-signed-document-india-states)
- [Cyril Amarchand — Section 65B revisited (Arjun Panditrao Khotkar)](https://corporate.cyrilamarchandblogs.com/2020/07/section-65b-of-the-indian-evidence-act-1872-requirements-for-admissibility-of-electronic-evidence-revisited-by-the-supreme-court/)
- [Sathya Narayanan — Section 65B → BSA Section 63(4)](https://sathyanarayanan.in/erstwhile-65b-now-634-digital-evidence/)
- [iPleaders — Enforceability of click-wrap agreements in India](https://blog.ipleaders.in/enforceability-of-clickwrap-agreements-in-india-all-you-need-to-know/)
- [HSA Legal — Understanding e-contracts (law & policy update)](https://hsalegal.com/wp-content/uploads/2020/10/HSA-Corp-Comm-Law-Policy-Understanding-e-contracts.pdf)
- [Lexology — E-signing of contracts and documents in India](https://www.lexology.com/library/detail.aspx?g=c49488a8-7417-4920-a056-b7d1e4cd363b)
- [Protean — Aadhaar eSign in India: Legal, Compliance & Use Cases](https://www.proteantech.in/articles/benefits-aadhaar-esign-digital-signatures/)
