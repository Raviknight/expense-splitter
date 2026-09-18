/* Turning internal failures into something a USER can act on.
 *
 * WHY THIS EXISTS. Six places in this app told the person using it to
 * "run db/21 in Supabase". That instruction is meaningful to exactly one
 * human on earth — the developer — and to everybody else it is alarming
 * nonsense about a database they have no access to, next to a form that just
 * refused their input. Reported from a screenshot on 2026-09-18, and correct:
 * a user should never be shown a developer's to-do list.
 *
 * The messages were not pointless, though, which is why this does not simply
 * delete them. During setup they are genuinely how you find out that a
 * migration has not been run. So the detail moves to the CONSOLE, where the
 * developer looks and the user does not, and the screen gets a sentence
 * written for the person actually reading it.
 *
 * The user-facing half should always do three things: say what failed in their
 * terms, say it is not their fault, and give them somewhere to go. The last
 * one is new — until the contact address existed there was nowhere to send
 * anybody.
 */

// Log the developer detail, return the sentence to put on screen.
//
// `devHint` should name the migration or the likely cause; it is the text that
// used to be shown to the user. `error` is the raw error object, logged whole
// so nothing is lost by the message being generalised.
export function reportSetupError({ userMessage, devHint, error }) {
  try {
    // console.error, not warn: this is a real failure, and a developer
    // filtering to errors should see it.
    console.error(`[splitab] ${devHint}`, error || '');
  } catch {
    // Some embedded webviews have no usable console. Never let logging be the
    // thing that breaks a save path.
  }
  return userMessage;
}

// The default for "something on our side went wrong and you can't fix it".
// Deliberately not "an error occurred": it names the action that failed, says
// whose fault it is, and offers a route out.
export function genericSaveFailure(what) {
  return `Couldn't save ${what} just now. This is a problem on our side, not yours — ` +
         `please try again, and email hello@splitab.app if it keeps happening.`;
}
