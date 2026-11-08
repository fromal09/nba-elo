// Line icons for the seven sections (section bar, home page, tour)
const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', viewBox: '0 0 24 24', 'aria-hidden': true }
export const ICONS = {
  binders: <svg {...P}><path d="M5 3.5h11.5a1.5 1.5 0 0 1 1.5 1.5v15H6.5A1.5 1.5 0 0 1 5 18.5z" /><path d="M8 3.5v16.5M10.5 8h5M10.5 11h4" /><path d="M3 21h18" /></svg>,
  library: <svg {...P}><path d="M4 4v16M8 4v16M4 4h4M4 20h4" /><path d="M11 6v14M14 6v14M11 6h3M11 20h3" /><path d="M16.5 5.5l3.5 14" /><path d="M3 21h18" /></svg>,
  scoreboard: <svg {...P}><rect x="3" y="5" width="18" height="12" rx="2" /><path d="M12 5v12M8 21h8M12 17v4" /><path d="M6.5 9.5h2v3h-2zM15.5 9.5h2v3h-2z" /></svg>,
  gameroom: <svg {...P}><rect x="3" y="8" width="18" height="10" rx="4" /><path d="M8 11v4M6 13h4" /><circle cx="15.5" cy="12" r=".8" fill="currentColor" /><circle cx="17.5" cy="14" r=".8" fill="currentColor" /><path d="M12 8V5" /></svg>,
  store: <svg {...P}><path d="M4 9l1.5-5h13L20 9" /><path d="M4 9c0 1.5 1.2 2.5 2.7 2.5S9.3 10.5 9.3 9c0 1.5 1.2 2.5 2.7 2.5s2.7-1 2.7-2.5c0 1.5 1.2 2.5 2.7 2.5S20 10.5 20 9" /><path d="M5.5 11.5V20h13v-8.5M10 20v-5h4v5" /></svg>,
  rankings: <svg {...P}><path d="M9 20V9h6v11M3 20v-7h6M15 20v-4h6v4M2 20h20" /><path d="M12 3.5l.9 1.8 2 .3-1.4 1.4.3 2-1.8-1-1.8 1 .3-2-1.4-1.4 2-.3z" /></svg>,
  elo: <svg {...P}><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-2 5-5 2 2-5z" /><circle cx="12" cy="12" r=".8" fill="currentColor" /></svg>,
}
