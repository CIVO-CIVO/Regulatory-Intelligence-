# Regulatory Intelligence: demo guide

Your own CardioTrace project (ready to open, no build) and five example projects with real regulation texts and realistic (clearly labelled fictional) company files. Each has a tested demo script: the edits below were run on the real engine (Jev and the language model) and produced the changes described.

## Before you start

- Open the app, click the "..." button at the top right of the front page and pick an example. The files and the draft pages load. Click "Create project".
- Building takes one to two minutes (reading, sorting, rules, judging criteria). Build the examples you plan to show before the meeting: projects stay saved in that browser.
- Each page under "Our draft" has its own ratings. Only rules the page is about get a score; everything else stays neutral (grey, hidden).
- Pasting text checks the page at once. Small edits are checked after a 15 second pause, or straight away with "Check now" at the bottom of the draft.
- Click any rule to show the exact quote from the regulation, how Jev judges it, and the probabilities. "Show the exact Jev questions" shows what was sent.
- The steps are cumulative: do them in order on a fresh copy of the example. To start over, create the example project again.
- Scores move a few points from one build to the next. The red and green changes in the steps held in repeated test runs, on fresh builds and on the live site.

## CardioTrace compliance (your own project)

Your own project, published with the app: it is already in the project list on any device that opens the link, rebuilt with the current engine (457 rules from 21 CFR 812, 21 CFR 814 and 45 CFR 164) and with every page already checked, so it opens at once without a build. The CardioX dossier, test paragraphs and answer key are fictional test data.

**Files**

- Rules: CFR-2025-title21-vol8-part812.pdf (21 CFR 812, IDE)
- Rules: CFR-2025-title21-vol8-part814.pdf (21 CFR 814, PMA)
- Rules: CFR-2025-title45-vol2-part164.pdf (45 CFR 164, HIPAA)
- Project facts: CardioX_Offline_Regulatory_Dossier.txt (the full dossier, so claims are compared with it)

**Starting point** (as published)

| Page | Relevant rules | Green | Amber | Red |
|---|---|---|---|---|
| Submission draft (the launch brochure, test 8A) | 21 | 0 | 0 | 21 |
| CardioX_Offline_Regulatory_Dossier | 52 | 36 | 15 | 1 |
| CardioX_Offline_Test_Paragraphs (all 12 A and B tests at once) | 112 | 18 | 58 | 36 |
| CardioX_Test_Answer_Key | 41 | 33 | 8 | 0 |

Open the project from "Your projects" on the front page. It opens on "Submission draft". All demo steps are on that page; the test paragraphs come from your CardioX_Offline_Test_Paragraphs file.

**Demo steps**

1. **Replace the brochure (test 8A) with the corrected status statement (test 8B): PMA filed and under review, not approved.**

- Replace the paragraph starting "Asterion's launch brochure states: “CardioX has been fully FDA approved for commercial sa…" with the B text of the same test: "Asterion's internal training statement says: “CardioX is a fictional investigational implantable cardiac rhythm monitor being studied under a simulated approved IDE. The fictional PMA CX-PMA-0007 has been accepted for f…"
- You should see: The approval-status and promotion rules go from red to green.

2. **Paste test 2A: one shared password, audit logging switched off.**

- Paste at the end: "Addendum: ePHI access and audit controls Because the CardioX trial database has grown, the sponsor's information technology team will replace individual user accounts with one shared password distributed to investigator…"
- You should see: HIPAA security rules (access control, audit controls, risk analysis) appear in red with warnings.

3. **Replace it with test 2B: individual accounts, audit controls, documented risk analysis.**

- Replace the paragraph starting "Because the CardioX trial database has grown, the sponsor's information technology team w…" with the B text of the same test: "The CardioX data environment will continue to use individually assigned accounts, access authorization appropriate to each role, technical audit controls, periodic review of permissions, secure remote access procedures,…"
- You should see: The same HIPAA security rules turn green.

4. **Paste test 6A: a serious device-related injury that the sponsor will not report until the trial ends.**

- Paste at the end: "Addendum: unanticipated adverse device effect Asterion's safety group has received a new report that a CardioX sensor migrated and damaged nearby tissue in a study participant, requiring surgery. The investigator believ…"
- You should see: The IDE reporting rules (unanticipated adverse device effects, 812.46 and 812.150) appear in red with warnings.

5. **Replace it with test 6B: report and evaluate the effect on time.**

- Replace the paragraph starting "Asterion's safety group has received a new report that a CardioX sensor migrated and dama…" with the B text of the same test: "When a suspected unanticipated adverse device effect occurs in a CardioX participant, the investigator will ensure prompt medical care, preserve the clinical and device records, and report the event to the sponsor and r…"
- You should see: The reporting rules turn green.

6. **Paste test 11A: postapproval duties described as if the PMA were already approved.**

- Paste at the end: "Addendum: postapproval duties Asterion's regulatory status dashboard reports that CardioX received final FDA PMA approval on 5 November 2026 because FDA accepted the application for filing. The dashboard automatically m…"
- You should see: PMA approval-status rules (814.42, 814.44, 814.80 to 814.84) turn red: filed is not approved.

7. **Replace it with test 11B: submission, approval and follow-up kept separate.**

- Replace the paragraph starting "Asterion's regulatory status dashboard reports that CardioX received final FDA PMA approv…" with the B text of the same test: "The CardioX regulatory dashboard lists three distinct statuses: “IDE approved for the defined clinical investigations,” “IRB permissions documented by participating site and protocol version,” and “PMA filed but not app…"
- You should see: The approval-status rules turn green or amber.

8. **Delete the whole ePHI addendum.**

- Delete the paragraph "Addendum: ePHI access and audit controls The CardioX data environment will continue to use individually assigned accoun…"
- You should see: The HIPAA security rules leave the list: the page is no longer about them, so they go neutral.

## Hodevarde app privacy (GDPR)

GDPR privacy for a health app: Norway (EEA), GDPR · 6 files · 2 pages

A privacy notice for users of the Hodevarde migraine diary app and our internal personal data breach procedure, under the GDPR as it applies in Norway through the EEA Agreement (supervisory authority: Datatilsynet).

**Files**

- Rules: GDPR excerpt - principles, consent, transparency.pdf
- Rules: GDPR excerpt - processors, security, breaches, transfers.pdf
- Project facts: Record of processing activities v3.2.pdf
- Project facts: Processor and transfer register v1.4.docx
- Project facts: Information security and incident response summary.docx
- Project facts: DPIA summary v2.2.txt

Example files loaded. The two GDPR excerpts are the real Official Journal text of Regulation (EU) 2016/679; the record of processing, processor register, security summary and DPIA summary are fictional.

**Starting point** (test run: 73 rules in 9 groups)

| Page | Relevant rules | Green | Amber | Red |
|---|---|---|---|---|
| Privacy notice | 25 | 10 | 7 | 8 |
| Personal data breach procedure | 13 | 7 | 4 | 2 |

Red at the start: Lawful fair transparent processing (Article 5(1)(a)); Storage limitation (Article 5(1)(e)); Professional secrecy safeguard (Article 9(3)); Further fair processing information (Article 13(2)); Right to erasure (Article 17(1)); Documented instructions only (Article 28(3)(a)); Conditions for third-country transfers (Article 44); Safeguards and enforceable rights (Article 46(1)).

**Demo steps**

1. **Marketing wants to drop the consent step. Change the legal basis for health data to legitimate interest.** (on the page "Privacy notice")

- Find: "We process your diary data only with your explicit consent, which you give on a separate screen before you start the diary. You can withdraw your con…"  Replace with: "We process your diary data on the basis of our legitimate interest in improving the app, so we do not ask for your consent."
- You should see: Article 9(1) on health data turns red with a warning, and so do the Article 6 legal basis rules.

2. **Write it properly: explicit consent on its own screen, not pre-ticked, easy to withdraw.** (on the page "Privacy notice")

- Find: "We process your diary data on the basis of our legitimate interest in improving the app, so we do not ask for your consent."  Replace with: "We process your diary data only with your explicit consent. You give it on a separate consent screen, apart from the terms of use, and the box is not pre-ticked. You can withdraw your consent at any time in Settings, Privacy, as easily as you gave it, and this does not affect processing before the withdrawal."
- You should see: Article 9 turns green again, and the Article 7 consent rules (proof of consent, withdrawal) turn green.

3. **Replace "as long as we find it useful" with the real retention periods from the record of processing.** (on the page "Privacy notice")

- Find: "We keep your diary data for as long as we find it useful, with no fixed deletion date."  Replace with: "We keep your diary entries while your account is active. If you delete your account or withdraw your consent, we delete your diary entries within 30 days, and they are removed from our encrypted backups within a further 35 days."
- You should see: Storage limitation (Article 5(1)(e)) and the right to erasure (Article 17(1)) go from red to green.

4. **Fix the claim that no data leaves the EU/EEA: the processor register shows a US support platform.** (on the page "Privacy notice")

- Find: "All your data, including your messages to customer support, stays in the EU/EEA: we do not transfer personal data to countries outside the EU/EEA."  Replace with: "Corvantis Inc. stores your messages to customer support in the United States. This transfer is based on the EU Standard Contractual Clauses, and you can ask our DPO for a copy. Your diary data is stored only in the EU/EEA."
- You should see: The transfer rule (Article 44) goes from red to green, and the Article 46 safeguard rules appear in green.

5. **Paste a new paragraph about how the data is protected.** (on the page "Privacy notice")

- Paste at the end: "How we protect your data Your diary data is encrypted on your phone, in transit with TLS 1.3 and at rest in our database with AES-256. Your email address and your diary are stored in separate databases. Only two named engineers and our Head of Security can access production data, with multi-factor authentication, and every access is logged. We test restoring from backup every quarter, and an external penetration test is done every year."
- You should see: New Article 32 rules (encryption, regular testing) appear, rated green.

6. **Switch to the breach procedure. Fix the deadline: 7 days becomes 72 hours from awareness.** (on the page "Personal data breach procedure")

- Find: "within 7 days of the risk assessment"  Replace with: "without undue delay and, where feasible, no later than 72 hours after we become aware of the breach, and gives the reasons for any delay"
- You should see: The 72-hour rule (Article 33(1)) goes from red to green.

7. **Fix the processor deadline: the processor agreements say 24 hours, not 72.** (on the page "Personal data breach procedure")

- Find: "within 72 hours of becoming aware of it"  Replace with: "without undue delay and no later than 24 hours after becoming aware of it, as our data processing agreements require"
- You should see: The processor rule (Article 33(2)) goes from red to green: the page now matches the 24 hours in the processor register.

8. **Delete the whole paragraph on informing affected users.** (on the page "Personal data breach procedure")

- Delete: "Informing affected users When a breach is likely to result in a high risk to users, we inform the affected users without undue delay by email and in-app message. The message uses clear and plain language. It explains what happened, the likely consequences, what we have done and what users can do to…"
- You should see: The rules on telling users about a breach (Article 34(1) and 34(2)) leave the list: they go neutral, not red.

## Kandisort 2.4 instructions for use

AI Act: CV ranking instructions: EU AI Act, Regulation 2024/1689 · 6 files · 3 pages

Instructions for use, with guidance for deployers, for Kandisort 2.4, a high-risk AI system that screens and ranks job applications (EU AI Act, Annex III, point 4(a), employment). Kandisort reads text CVs only and uses no biometric data.

**Files**

- Rules: AI Act - requirements for high-risk AI systems (Art 10-15).pdf
- Rules: AI Act - classification, logs and deployer obligations (Art 6, 19, 26, 86).pdf
- Project facts: Kandisort 2.4 model card and validation report.pdf
- Project facts: Kandisort risk management register rev 6.pdf
- Project facts: Logging and data retention specification v1.4.docx
- Project facts: Human oversight design note v1.2.txt

Example files loaded. The two AI Act excerpts are real Official Journal text; the Kandisort model card, risk register, logging specification and oversight note are fictional.

**Starting point** (test run: 54 rules in 9 groups)

| Page | Relevant rules | Green | Amber | Red |
|---|---|---|---|---|
| Instructions for use | 16 | 15 | 1 | 0 |
| Human oversight and logging | 19 | 7 | 3 | 9 |
| Accuracy, limitations and data | 15 | 3 | 7 | 5 |

Red at the start: Automatic logging over lifetime (Article 12(1)); Minimum logging content (Article 12(3)); Characteristics and limitations (Article 13(3)(b)); Log collection mechanisms (Article 13(3)(f)); Two-person verification of identifications (Article 14(5)); Provider log retention (Article 19(1)); Use per instructions for use (Article 26(1)); Monitoring and incident reporting (Article 26(5)).

**Demo steps**

1. **Fix the red log retention: 7 days becomes 190 days, as the logging specification says.** (on the page "Human oversight and logging")

- Find: "The ranking logs are deleted after 7 days to limit the storage of applicant data."  Replace with: "Kandisort keeps the ranking logs for 190 days, which is more than six months, and then deletes them automatically. Deployers can extend the retention period of the ranking logs to up to 24 months."
- You should see: The log retention rules (Articles 19 and 26(6)) and the rule on describing the logs (Article 13(3)(f)) go from red to green.

2. **Add a sentence that lets Kandisort reject low scores automatically.** (on the page "Human oversight and logging")

- After "and mark a ranking as wrong with a reason." add: "To save time, applications with a match score below 40 are rejected automatically before a recruiter sees them, so recruiters can rely on the ranking."
- You should see: The human oversight rules (Article 14) and the rule on oversight in the instructions (Article 13(3)(d)) turn red with a warning.

3. **Rewrite it the correct way: no automatic rejection, a recruiter decides.** (on the page "Human oversight and logging")

- Find: "To save time, applications with a match score below 40 are rejected automatically before a recruiter sees them, so recruiters can rely on the ranking."  Replace with: "No application is rejected automatically: there is no score cut-off, and every rejection is an action taken by a recruiter after opening the application."
- You should see: The same rules turn green again.

4. **Replace the 99% claim with the real figures from the validation report.** (on the page "Accuracy, limitations and data")

- Find: "In validation, Kandisort was 99% accurate for all applicants, regardless of age, gender or language."  Replace with: "The accuracy metric is top-quartile agreement: the share of the applications that the panel placed in the top quarter that Kandisort also placed in its top quarter. Overall top-quartile agreement was 87.4%. Accuracy is lower for applicants aged 50 and over (81.7%), applicants with a career gap of more than 24 months (79.3%), applicants with education from outside the Nordic countries (80.2%) and…"
- You should see: The accuracy rules (Article 15(3), Article 13) go from red to green.

5. **Delete the whole robustness and cybersecurity paragraph.** (on the page "Accuracy, limitations and data")

- Delete: "Robustness and cybersecurity Kandisort gives the same score when an application is uploaded again, and small changes in spelling or formatting change the score by less than 2 points. Hidden text, such as white keywords added to a CV, is detected and removed before scoring. Kandisort runs in an isol…"
- You should see: The cybersecurity rules (Article 15(5)) leave the list: the page no longer covers them, so they go neutral, not red.

6. **Paste a new paragraph on informing workers and applicants.** (on the page "Human oversight and logging")

- Paste at the end: "Informing workers and applicants Before an employer starts using Kandisort, it must inform the workers' representatives and the affected workers. Deployers must also tell every applicant, in the job advertisement and in the confirmation of receipt, that Kandisort is used to rank applications. An applicant who is rejected can ask the deployer for an explanation of the role Kandisort played in the decision and the main reasons for the decision; the explanation panel and the ranking logs give the…"
- You should see: New rules appear: informing workers' representatives and applicants (Article 26(7) and 26(11)) and the right to an explanation (Article 86).

7. **On the first page, claim that Finnish is supported with the same accuracy. The model card says Finnish is not supported.** (on the page "Instructions for use")

- Find: "plain text files in Norwegian, Swedish, Danish and English."  Replace with: "plain text files in Norwegian, Swedish, Danish, Finnish and English, and scores applications in all five languages with the same accuracy."
- You should see: Rules on the instructions for use (Article 13) turn red with a warning: the claim contradicts the model card.

## Stillnora Evening Calm labeling

US supplement label and claims: US FDA, 21 CFR 101 · 6 files · 3 pages

Label copy, product web page and social media posts for Stillnora Evening Calm, a magnesium and L-theanine sleep-support dietary supplement sold in the US, with structure/function claims under DSHEA (21 CFR 101.93) and a Supplement Facts panel (21 CFR 101.36).

**Files**

- Rules: 21 CFR 101.93 dietary supplement statements.pdf
- Rules: 21 CFR 101.36 Supplement Facts labeling.pdf
- Rules: 21 CFR 101.3 identity labeling.pdf
- Project facts: Product specification FPS-SN-EC-001 rev C.docx
- Project facts: FDA notification letter TN-REG-2026-014.pdf
- Project facts: Substantiation summary SUB-SN-EC-001 v2.1.pdf

Example files loaded. The three 21 CFR texts (101.3, 101.36 and 101.93) are real public regulations from eCFR; the product specification, FDA notification letter and substantiation summary are fictional.

**Starting point** (test run: 88 rules in 10 groups)

| Page | Relevant rules | Green | Amber | Red |
|---|---|---|---|---|
| Label copy | 23 | 11 | 6 | 6 |
| Product web page | 19 | 15 | 2 | 2 |
| Social media posts | 7 | 3 | 4 | 0 |

Red at the start: Nutrition label required (§ 101.36(a)); Required nutrition information (§ 101.36(b)); Quantitative amounts by weight (§ 101.36(b)(2)(ii)); Percent Daily Value required (§ 101.36(b)(2)(iii)); Amounts of other ingredients (§ 101.36(b)(3)(ii)); Per unit and per day amounts (§ 101.36(e)(9)); Plural statement disclaimer text (§ 101.93(c)(2)); Permitted structure/function statements (§ 101.93(f)).

**Demo steps**

1. **On the label, correct L-theanine from 400 mg to 200 mg, the amount in the product specification.** (on the page "Label copy")

- Find: "L-Theanine 400 mg, marked †."  Replace with: "L-Theanine 200 mg, marked †."
- You should see: The Supplement Facts amount rules go from red to green.

2. **Delete the whole Supplement Facts paragraph.** (on the page "Label copy")

- Delete: "Supplement Facts panel Serving Size 2 Capsules. Servings Per Container 30. Amount Per Serving, with % Daily Value in the right column. Vitamin B6 (as pyridoxine hydrochloride) 2 mg, 118%. Magnesium (as magnesium bisglycinate) 120 mg, 29%. L-Theanine 200 mg, marked †. Lemon balm (Melissa officinalis…"
- You should see: The detailed Supplement Facts rules leave the list (neutral). The rule that a label must carry a Supplement Facts panel can turn red: the label no longer has one.

3. **On the web page, add a sentence that says the product is clinically proven to cure insomnia.** (on the page "Product web page")

- After "than those who took a placebo." add: "That makes Stillnora Evening Calm clinically proven to cure insomnia."
- You should see: The disease claim rules (21 CFR 101.93(g)) turn red with a warning.

4. **Rewrite it as a structure/function claim: supports restful sleep.** (on the page "Product web page")

- Find: "That makes Stillnora Evening Calm clinically proven to cure insomnia."  Replace with: "In short, Stillnora Evening Calm supports restful sleep in healthy adults.*"
- You should see: The disease claim rules turn green again or leave the list.

5. **Replace the home-made disclaimer with the exact text from 21 CFR 101.93(c)(2).** (on the page "Product web page")

- Find: "*These statements have not been reviewed by the FDA. Individual results may vary."  Replace with: "*These statements have not been evaluated by the Food and Drug Administration. This product is not intended to diagnose, treat, cure, or prevent any disease."
- You should see: The disclaimer rule (21 CFR 101.93(c)(2)) goes from red to green.

6. **Delete the cortisol claim. FDA was never notified of it and the substantiation file rejects it.** (on the page "Product web page")

- Delete: "Supports healthy cortisol levels and stress resilience during the workday.*"
- You should see: The disease-suggestion rule turns green, and the permitted-claims rule follows.

7. **On the social media page, remove the "FDA approved" sentence from post 2.** (on the page "Social media posts")

- Find: "Our formula is FDA approved, so you know it is safe and that it works. It pairs magnesium with L-theanine and lemon balm."  Replace with: "Our formula pairs magnesium with L-theanine and lemon balm, and every batch is tested by an independent laboratory."
- You should see: The red rule on this page turns green, and most amber rules turn green with it.

8. **Paste a new paragraph about the 30-day notification to FDA.** (on the page "Product web page")

- Paste at the end: "Our notification to FDA Tunravn Nutrition sent FDA's Office of Dietary Supplement Programs a 30-day notification for Stillnora Evening Calm on 26 May 2026, 22 days after the product first went on sale. The notice listed our name and address, the product name and the exact wording we use on the label and on this page. Our chief executive officer signed it and certified that we hold substantiation that this wording is truthful and not misleading."
- You should see: New rules about the notification (21 CFR 101.93(a)) appear and are rated green.

## VARDE-1 informed consent form

Consent form for a device study: US FDA, 21 CFR 50 · 5 files · 3 pages

Master informed consent form (version 3.0) for VARDE-1, a US pivotal IDE study of the GlucoVarde 180 implantable continuous glucose sensor, written in plain language for adult participants.

**Files**

- Rules: 21 CFR 50 subpart B excerpt.pdf
- Rules: 21 CFR 812.7.pdf
- Project facts: CIP synopsis VARDE-1 v3.0.pdf
- Project facts: Investigator's brochure section 6 v4.0.docx
- Project facts: IRB approval letter KP-2026-0418.pdf

Example files loaded. 21 CFR 50.20, 50.25 and 50.27 (Part 50 Subpart B) and 21 CFR 812.7 are real public texts from the eCFR; the investigation plan synopsis, investigator's brochure and IRB letter are fictional.

**Starting point** (test run: 31 rules in 7 groups)

| Page | Relevant rules | Green | Amber | Red |
|---|---|---|---|---|
| Study overview and procedures | 10 | 6 | 3 | 1 |
| Risks, benefits and alternatives | 9 | 4 | 0 | 5 |
| Your rights, costs and contacts | 16 | 10 | 3 | 3 |

Red at the start: Research purpose and procedures (§ 50.25(a)(1)); Research purpose and procedures (§ 50.25(a)(1)); Foreseeable risks described (§ 50.25(a)(2)); Expected benefits described (§ 50.25(a)(3)); Contact persons identified (§ 50.25(a)(7)); No safety or efficacy claims (§ 812.7(d)); Research purpose and procedures (§ 50.25(a)(1)); Voluntary participation statement (§ 50.25(a)(8)).

**Demo steps**

1. **On the risks page, add a sentence where the participant gives up the right to make a claim.** (on the page "Risks, benefits and alternatives")

- After "Talk to the study doctor if this happens." add: "By signing this form, you agree not to make any claim against Isbrann Medical AS, the study doctor or the hospital for an injury caused by the sensor."
- You should see: The rule against exculpatory language (21 CFR 50.20) turns red with a warning.

2. **Replace the whole injury paragraph with the research-injury language the IRB approved.** (on the page "Risks, benefits and alternatives")

- Find: "If you are hurt because of the study, Isbrann Medical AS may help with some of the costs. Talk to the study doctor if this happens. By signing this f…"  Replace with: "If you are injured as a direct result of the GlucoVarde 180 sensor or a procedure done for this study, the study doctor will give you medical treatment or arrange it for you. Isbrann Medical AS will pay the reasonable costs of this treatment that are not paid by your health insurance or another third party. You will not have to pay these costs yourself. Isbrann Medical AS will not pay for lost wa…"
- You should see: The exculpatory language rule turns green, and so does the rule on compensation and treatment for injury (50.25(a)(6)).

3. **Remove the claim that the sensor is safe and more accurate.** (on the page "Risks, benefits and alternatives")

- Find: "The GlucoVarde 180 is safe and gives more accurate readings than the continuous glucose monitor you wear on your skin today."  Replace with: "You may not benefit from being in this study. We do not yet know how safe or how accurate the GlucoVarde 180 is; that is what this study will find out."
- You should see: The rule against calling an investigational device safe or effective (21 CFR 812.7(d)) and the benefits rule turn green.

4. **Correct the infection rate to the one in the investigator's brochure (about 1 in 80).** (on the page "Risks, benefits and alternatives")

- Find: "Infection at the insertion site happens in fewer than 1 in 500 people"  Replace with: "Infection at the insertion site happens in about 1 in 80 people"
- You should see: The risk description rule goes from red to green: the rate now matches the project facts.

5. **Delete the whole paragraph about other choices.** (on the page "Risks, benefits and alternatives")

- Delete: "What other choices do I have? You do not have to take part in this study to manage your diabetes. Other choices include finger-stick meters and continuous glucose monitors that FDA has already cleared, which you wear on the skin. Your own doctor can talk with you about these choices."
- You should see: The alternatives rule (50.25(a)(4)) leaves the list: the page no longer deals with it, so it goes neutral.

6. **Go to the rights page and fix the sentence that says you cannot leave once the sensor is implanted.** (on the page "Your rights, costs and contacts")

- Find: "Once the sensor is implanted, you cannot leave the study until it is removed at the day 180 visit."  Replace with: "You can leave the study at any time, also after the sensor has been implanted, without penalty or loss of benefits. If you leave, we will offer you a removal visit so the study doctor can take the sensor out safely. You do not have to come to that visit."
- You should see: The voluntary participation rule (50.25(a)(8)) and the withdrawal rule (50.25(b)(4)) go from red to green.

7. **Paste the ClinicalTrials.gov statement the regulation requires, word for word.** (on the page "Your rights, costs and contacts")

- After "that might change your mind about staying in it." add: "Is this study listed online? A description of this clinical trial will be available on http://www.ClinicalTrials.gov, as required by U.S. Law. This Web site will not include information that can identify you. At most, the Web site will include a summary of the results. You can search this Web site at any time."
- You should see: A new rule on the ClinicalTrials.gov statement (50.25(c)) appears and is green.

8. **On the overview page, correct the number of clinic visits to the 11 in the investigation plan.** (on the page "Study overview and procedures")

- Find: "come to 6 clinic visits"  Replace with: "come to 11 clinic visits"
- You should see: The duration and procedures rule (50.25(a)(1)) goes from red to green: the visit count now matches the plan.

## FlexiGuard 510(k)

FDA 510(k) for a wound dressing: US FDA, 21 CFR 807 · 6 files · 1 page

A traditional 510(k) premarket notification to the US FDA for the FlexiGuard FG-200 wound dressing (silicone contact layer and polyurethane foam).

**Files**

- Rules: 21 CFR 807 subpart E.pdf
- Rules: FDA guidance - 510(k) format.txt
- Rules: ISO 10993-1 summary.txt
- Project facts: Clinical study report v3.pdf
- Project facts: Risk management file.docx
- Other: Labeling draft.docx

Example files loaded. The clinical, risk and labeling files are fictional; the CFR and FDA texts are real public documents.

**Starting point** (test run: 102 rules in 8 groups)

| Page | Relevant rules | Green | Amber | Red |
|---|---|---|---|---|
| Submission draft | 14 | 8 | 3 | 3 |

Red at the start: Proposed labeling submitted (Table 1: Labeling); Predicate identification (§ 807.92(a)(3)); FG-200 device description (Annex A.1).

**Demo steps**

1. **Add a sentence that calls the device FDA approved.** (on the page "Submission draft")

- After "The label includes warnings and instructions for use." add: "Because the 510(k) has been submitted, our brochure will call the FlexiGuard FG-200 an FDA approved dressing."
- You should see: The rule against official-approval claims (21 CFR 807.97) turns red with a warning.

2. **Rewrite it the correct way: 510(k) cleared, never FDA approved.** (on the page "Submission draft")

- Find: "Because the 510(k) has been submitted, our brochure will call the FlexiGuard FG-200 an FDA approved dressing."  Replace with: "Once FDA finds the device substantially equivalent, our brochure will describe it as 510(k) cleared, never as FDA approved."
- You should see: The same rule turns green.

3. **Fill the biocompatibility gap: name every endpoint from the ISO summary.** (on the page "Submission draft")

- Find: "Testing per ISO 10993-1 included cytotoxicity and sensitization."  Replace with: "Testing on the final finished, ethylene oxide sterilized device covered cytotoxicity (ISO 10993-5), sensitization (ISO 10993-10) and intracutaneous reactivity (ISO 10993-23). Acute systemic toxicity, material-mediated pyrogenicity, subacute toxicity and genotoxicity were addressed by chemical characterization with a toxicological risk assessment."
- You should see: Biocompatibility rules (the ISO 10993 endpoints, testing on the final finished device) appear or go from amber to green.

4. **Change a number so it no longer matches the clinical study report (it reports 2 device-related events).** (on the page "Submission draft")

- Find: "reported 2 device-related adverse events"  Replace with: "reported no device-related adverse events"
- You should see: Several rules turn red with a warning, among them the clinical and performance test rules: the page now contradicts the clinical study report.

5. **Delete the whole substantial equivalence paragraph.** (on the page "Submission draft")

- Delete: "Substantial equivalence The predicate device is K123456."
- You should see: The predicate rules leave the list: the page is no longer about them, so they go neutral.

6. **Paste a new paragraph about sterility and shelf life.** (on the page "Submission draft")

- Paste at the end: "Sterility and shelf life The dressing is sterilized with ethylene oxide to a sterility assurance level of 10^-6. The shelf life is 3 years from the date of manufacture, and the use-by date is printed on each pouch and carton."
- You should see: New rules about sterility and shelf life appear. Sterility is green; shelf life can show red until the test method is named.

7. **Add how the shelf life was tested.** (on the page "Submission draft")

- After "printed on each pouch and carton." add: "The shelf life is supported by accelerated aging per ASTM F1980 followed by package integrity and seal strength testing, with real-time aging studies ongoing."
- You should see: The shelf-life method rule turns green.

