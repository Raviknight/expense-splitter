# Email to Dodo Payments (and Paddle — send the same, unchanged)

Send this to **both** providers. Identical questions make the answers
comparable; a tailored email to each produces two things you cannot line up.

The unit-economics question (Q1) is the one that decides this, and it is the
question a salesperson is least likely to volunteer. Ask it first so it cannot
be lost at the bottom of a reply.

---

**Subject:** Questions before signing up — India-based SaaS, low-price plan

Hello,

I run Splitab (https://splitab.app), an expense-splitting web app. I am based in
India and sell to customers worldwide. I am choosing a merchant of record and
have four questions before I sign up.

**1. Unit economics at a low price point.**
I plan to sell in India at about **INR 50** (roughly USD 0.55). On your published
rates, a fixed per-transaction fee of USD 0.15–0.40 would take somewhere between
a quarter and two-thirds of that sale before your percentage fee applies. That
does not work for me as a monthly price.

- Do you have pricing that suits low-value transactions of this size?
- Does your India domestic rate (4% + 15c) apply when both the customer and I
  are in India, and is the +1.5% international surcharge and +0.5% subscription
  surcharge applied on top of that?
- Would an **annual** plan (about INR 500) be charged one fixed fee per year, or
  one per billing cycle?

Please give a worked example of what I would actually receive on a single
INR 50 charge and on a single INR 500 annual charge.

**2. FIRA / FIRC for Indian export compliance.**
As an Indian exporter of services I need documentary proof of foreign inward
remittance.

- Do you issue **India-format FIRA or FIRC** for payouts to an Indian bank
  account?
- Is it issued automatically per payout, or on request?
- If you do not issue it, what do Indian sellers use instead to satisfy their
  bank and their auditor?

**3. API and webhooks.**
My app must grant and revoke a premium flag by itself; I am not willing to do it
by hand.

- Do you provide **webhooks** for subscription created, renewed, payment failed,
  and cancelled?
- Are webhook payloads signed, and is there a documented way to verify them?
- Is there a sandbox or test mode for building the integration before going live?
- A link to your API documentation would be helpful.

**4. Tax as merchant of record.**
- Which taxes do you register for, collect and remit on my behalf — EU VAT, UK
  VAT, US sales tax, India GST?
- Which legal entity appears as the seller on the customer's statement and
  invoice, and in which country is it registered?
- What remains **my** obligation to file in India?

**Also, briefly:** minimum payout threshold, payout frequency and any hold
period, whether a rolling reserve applies and for how long, refund and
chargeback fees, and any setup, monthly or inactivity fee.

Thank you,
Ravi
https://splitab.app

---

## Why these four, and what a good answer looks like

**Q1 — the one that actually decides it.** At INR 50, a USD 0.40 fixed fee is
about INR 35: you would keep roughly a quarter of the sale. Even the INR 13 that
a USD 0.15 fee costs is a quarter of the price. No percentage rate rescues that —
**the fixed fee is the problem, not the percentage.** A good answer offers either
a genuinely low fixed fee on domestic Indian rails, or agrees that annual billing
is the right shape. A bad answer quotes the headline percentage again.

**Q2 — non-negotiable, and the one most likely to be fudged.** Without FIRA/FIRC
you have no clean proof of export earnings for your bank or your auditor. Playto's
terms do not mention it at all. Accept only a direct yes or no.

**Q3 — disqualifying if absent.** Without webhooks you are marking premium users
by hand forever, which is exactly the state you are in now and the reason this
work exists.

**Q4 — the whole point of a merchant of record.** If they do not actually register
for and remit foreign VAT, you are paying merchant-of-record rates for a payment
gateway. Note whether the seller-of-record entity is Indian or foreign: an Indian
private limited company handling EU VAT is a claim worth checking, not assuming.
