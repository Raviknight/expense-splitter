# Reddit post draft — Indian subs

**Status: draft for the owner to edit and post. Nobody should post this verbatim —
it reads better in your own voice, and Reddit is unusually good at spotting copy
that was not written by the person posting it.**

## Before posting — checks, in order

1. **Resend daily email cap.** Every sign-in and sign-up sends an email. On
   Resend's free tier that is 100/day. Hit it and the next person simply cannot
   get in — they request a code and nothing arrives. Google sign-in is the only
   path that sends no email. Check the dashboard; raise the plan or accept the
   cap knowingly.
2. **Read the sub's rules and sidebar.** Big country subs usually restrict
   self-promotion, and often require minimum account age, karma, and a flair.
   A removed post costs nothing; a ban is permanent.
3. **Post from an account with history.** A new account posting a link is
   auto-removed almost everywhere.
4. **Be around for the first 2 hours.** Reddit rewards replies. An unanswered
   thread dies regardless of what it says.

## Why it is written this way

Two threads (r/SideProject "100% free alternative to Splitwise", r/roommates
"Splitwise alternatives") show the same objections hitting every app in this
category. This draft answers them BEFORE they are raised, because in those
threads they were always the top comments:

| Objection seen in the wild | Where this draft answers it |
|---|---|
| *"How do you plan on running the backend when everything is free? Who's gonna pay for that?"* (top comment, 16 upvotes) | Says the running cost and how it is covered, plainly |
| *"My guess is you're selling data or want to build an audience for a paid product"* | States no ads / no analytics / no trackers, and LINKS the privacy policy so it is checkable rather than a claim |
| *"what does it do different/better than [X]?"* | Leads with the Indian angle instead of claiming to beat Splitwise |
| Five devs pitching their own app in one thread | Asks for feedback rather than signups; does not claim to be better than anyone |

The single strongest thing here is that the "no tracking" claim is TRUE and
verifiable — the privacy policy exists and the app genuinely carries no
analytics. Most posts in this category cannot say that.

---

## Title options

Pick one. Lower-key titles do better than superlatives.

1. `Built a free bill-splitting app because Splitwise's free tier got frustrating — would like feedback from people splitting rent/trips in India`
2. `Made an expense splitter with no ads and no tracking. Looking for honest feedback before I add UPI payments.`
3. `My flatmates and I kept arguing over who paid what, so I built a bill splitter. It's free. Tell me what's wrong with it.`

---

## Body

Hi all,

I'm a mechanical engineer who started coding fairly recently. Splitting rent,
groceries and trip costs with flatmates and friends kept turning into a mess of
WhatsApp messages and a notes app, and the existing tools annoyed me enough that
I built my own. It is called Splitab and it runs in the browser at
https://splitab.app — no app store, no install needed, though you can add it to
your home screen and it works offline.

What it does:

- Split expenses across a group, equally or with custom shares
- Works out the fewest payments needed to clear everyone's balances
- Works in INR (and per-group currencies, so a trip abroad still makes sense)
- Import a bank or card statement from CSV
- Photograph a receipt and it reads the amounts for you
- Works offline — things you add on the metro sync when you're back online

Being straight about a few things, because I would want to know them:

**It is free, and here is why that is not suspicious.** Running it costs me very
little — the database is on a free tier and the receipt scanning is a fraction
of a rupee per receipt. There are no ads, no analytics, no tracking scripts and
no third-party trackers of any kind, and I am not selling anyone's data. You do
not have to take my word for it: https://splitab.app/privacy.html spells out
exactly what is stored and who it is shared with, including the one place data
leaves my systems (receipt images go to an AI provider to be read — scanning is
optional and typing an expense sends nothing).

If it ever grows enough that the bills hurt, I will charge for the expensive
part, which is receipt scanning. Everything else stays free.

**What it does NOT do yet.** It does not send payment links. Right now you write
your UPI ID on your profile and the person paying you sees it at settle-up, then
pays in their own app. I want to make that one tap — UPI actually makes this
possible in a way it isn't in most countries — and that is the next thing I am
building.

**It is early.** Very few people use it. Things will be rough.

What I'd like: tell me what is confusing, what is missing, or what would stop
you using it with your own flat or trip group. Blunt is fine — I would rather
hear it now.

---

## Replies to have ready

- **"Who pays for the servers?"** — Answer concretely with real numbers. Vagueness
  here is what made people suspicious of the other projects.
- **"What's different from Splitwise / Splitpro / Settle Up?"** — Do NOT claim to
  be better. Honest answer: it is free where Splitwise now limits, it is built
  for INR and UPI first, and it runs in a browser with nothing to install.
- **"Is it open source?"** — It is: the repo is public. Say so, it is a genuine
  trust signal and several commenters in those threads asked for exactly this.
- **"Why should I trust you with my data?"** — Point at the privacy policy and at
  the fact that the source is readable.
