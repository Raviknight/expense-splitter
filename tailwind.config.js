/** Tailwind configuration.
 *
 * Replaces the Play CDN (`cdn.tailwindcss.com`), which shipped ~400KB of
 * JavaScript and then COMPILED THE CSS IN THE BROWSER on every page load by
 * scanning the DOM — render-blocking, and explicitly warned against for
 * production. This builds a static stylesheet at build time instead.
 *
 * ⚠️ `content` must match every file that can contain a class name, or those
 * classes are dropped from the output and the styling silently breaks. If
 * something looks unstyled after a change, check this list first.
 *
 * Tailwind scans these files as PLAIN TEXT looking for class-like strings, so
 * conditional expressions such as
 *     `${pinned ? 'border-indigo-200' : 'border-stone-200'}`
 * are picked up fine — both literals are present in the source. What does NOT
 * work is building a name from pieces (`bg-${color}-500`), because no complete
 * class string exists to find. Avoid that pattern.
 */
export default {
  content: [
    './src/**/*.{js,jsx}',
    './public/index.html',
  ],
  // Dark mode is driven by a `.dark` class on <html> (set by the no-flash
  // script in index.html and the appearance toggle), not the OS preference.
  darkMode: 'class',
  theme: { extend: {} },
  plugins: [],
};
