// The little picture on a programme card.
//
// Drawn from the manifest — length, slope, rig — rather than stored as an
// asset, so a new event gets an illustration the moment it exists and none of
// them can ever fall out of step with the course they depict. It is a diagram,
// not a render: a lane seen from the side, its start and finish, and the tilt.

const W = 320;
const H = 132;
const GROUND = 96;

/** The lane's tilt in degrees, clamped so a steep event still fits the frame. */
export function tilt(slopeDeg) {
  return Math.max(-18, Math.min(18, Number(slopeDeg) || 0));
}

/**
 * How far along the lane the finish sits, in px.
 *
 * Longer courses draw a longer lane, but compressed: a 5 m event is not
 * drawn 2.5x the 2 m one, or the card would be mostly empty track. The square
 * root keeps the difference legible without letting it dominate.
 */
export function laneWidth(lengthM) {
  const metres = Math.max(0.25, Number(lengthM) || 1);
  return Math.round(70 + 130 * Math.min(1, Math.sqrt(metres / 5)));
}

export function courseArt(event) {
  const deg = tilt(event.slope_deg);
  const lane = laneWidth(event.length_m);
  const x0 = Math.round((W - lane) / 2);
  const rollers = event.rig === "rollers";

  // The duck is a suggestion, not a portrait: a body, a head and either feet
  // or wheels. Anything more detailed would be a worse version of the replay
  // that is one click away.
  const duck = rollers
    ? `<circle cx="-7" cy="-3" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6"/>
       <circle cx="7" cy="-3" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6"/>`
    : `<path d="M-6 0v-6M6 0v-6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`;

  return `
<svg viewBox="0 0 ${W} ${H}" class="card__art" role="img"
     aria-label="${event.title}: ${event.length_m} m${deg ? `, ${event.slope_deg}° climb` : ", flat"}">
  <defs>
    <linearGradient id="sky-${event.id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(255,122,47,.10)"/>
      <stop offset="100%" stop-color="rgba(80,200,255,.05)"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#sky-${event.id})"/>
  <g transform="translate(${x0} ${GROUND}) rotate(${-deg})">
    <line x1="0" y1="0" x2="${lane}" y2="0" stroke="currentColor" stroke-width="2" opacity=".55"/>
    <line x1="0" y1="-22" x2="0" y2="6" stroke="var(--cyan)" stroke-width="2.5"/>
    <line x1="${lane}" y1="-22" x2="${lane}" y2="6" stroke="var(--orange)" stroke-width="2.5"/>
    <g transform="translate(${Math.round(lane * 0.36)} -8)" opacity=".85">
      <rect x="-9" y="-16" width="18" height="13" rx="3" fill="none"
            stroke="currentColor" stroke-width="1.8"/>
      <circle cx="0" cy="-22" r="5" fill="none" stroke="currentColor" stroke-width="1.8"/>
      ${duck}
    </g>
  </g>
</svg>`;
}
