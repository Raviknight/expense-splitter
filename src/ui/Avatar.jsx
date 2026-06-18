// Avatar.jsx
// A tiny, dependency-free profile picture component used everywhere a person
// appears (top bar, group cards, members list, connections).
//
// How it decides what to show:
//   • If `url` is provided → render the photo as an <img> (cropped to a circle).
//   • Otherwise → render an "initials circle": the person's initials on a soft
//     indigo background. This matches the circles the app used before photos.
//
// It is intentionally self-contained — it carries its OWN initials helper so it
// never has to import from App.jsx (which would risk a circular import).
//
// Props:
//   name      : the person's display name (used for initials + the img alt text)
//   url       : the photo URL (profiles.avatar_url). When empty/undefined we
//               fall back to initials, so this is safe BEFORE db/08 is run.
//   size      : diameter in pixels (default 28). Keeps every caller consistent.
//   className : extra Tailwind classes the caller wants to add (e.g. a ring).

import { useState } from 'react';

// Turn a name into 1–2 initials.
//   "Ravi Knight" -> "RK"  (first letter of first + last word)
//   "Shailja"     -> "S"   (single word -> just its first letter)
//   ""/blank      -> "?"
function initials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0][0].toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export default function Avatar({ name, url, size = 28, className = '' }) {
  // If the image fails to load (broken/expired URL), fall back to initials.
  const [imgFailed, setImgFailed] = useState(false);

  // A square box sized in pixels; rounded-full makes it a circle.
  const style = { width: size, height: size };

  // Scale the initials text roughly with the circle so big avatars read well.
  // (size * 0.4 gives ~11px for a 28px circle, ~22px for a 56px circle.)
  const fontStyle = { fontSize: Math.max(9, Math.round(size * 0.4)) };

  const showImage = url && !imgFailed;

  return (
    <span
      title={name || ''}
      style={style}
      className={
        'rounded-full overflow-hidden shrink-0 flex items-center justify-center ' +
        // The initials look: soft indigo background, indigo text.
        (showImage ? '' : 'bg-indigo-50 text-indigo-600 font-semibold ') +
        className
      }
    >
      {showImage ? (
        <img
          src={url}
          alt={name || ''}
          style={style}
          className="w-full h-full object-cover"
          // If the photo can't load, drop back to the initials circle.
          onError={() => setImgFailed(true)}
        />
      ) : (
        <span style={fontStyle} className="leading-none select-none">
          {initials(name)}
        </span>
      )}
    </span>
  );
}
