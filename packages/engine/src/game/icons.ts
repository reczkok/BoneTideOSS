import type { AbilityId } from './abilities.ts';

export const abilityIconName = (id: AbilityId) => `ability-${id}`;

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ` +
  `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ABILITY_ICONS: Record<AbilityId, string> = {
  nova: svg(
    '<circle cx="12" cy="12" r="4.5"/>' +
      '<path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/>',
  ),
  meteor: svg(
    '<circle cx="8.5" cy="15.5" r="4"/>' +
      '<path d="M12.3 11.7L21 3M15 15.5l5.5-5.5M8.5 9L13 4.5"/>',
  ),
  chain: svg('<path d="M13 2L5.5 13.5H11L9.5 22l8-11.5H12L13 2z"/>'),
  volley: svg(
    '<path d="M4 20L15 5M15 5l-.5 4.5M15 5l-4.5.5M7.5 20l6-8"/>' +
      '<path d="M18.5 13.5c1.3 1.8 2 3 2 4a2 2 0 1 1-4 0c0-1 .7-2.2 2-4z"/>',
  ),
  well: svg(
    '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/>' +
      '<circle cx="12" cy="12" r="0.8" fill="currentColor" stroke="none"/>',
  ),
  spikes: svg(
    '<path d="M3 20h18"/><path d="M4.8 20l2.4-7.5 2.4 7.5"/>' +
      '<path d="M8.9 20L12 3.5 15.1 20"/><path d="M14.6 20l2.4-6 2.4 6"/>',
  ),
  fire: svg(
    '<path d="M12 2.5c.5 4-5 5.5-5 10.5a5 5 0 0 0 10 0c0-2.4-1.2-4-2.5-5.5-.2 1.2-.8 2.2-1.8 2.8.8-2.6.3-5.3-.7-7.8z"/>',
  ),
  deluge: svg(
    '<path d="M2 15c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/>' +
      '<path d="M2 19.5c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/>' +
      '<path d="M14 10.5c0-3.5-2.6-5-5.5-5C11 4 15 4.5 16.5 7.5"/>',
  ),
  blades: svg(
    '<path d="M4.5 4.5L17 17M19.5 4.5L7 17M17 17l2.5 2.5M7 17l-2.5 2.5M14.5 19l4.5-4.5M9.5 19 5 14.5"/>',
  ),
};

export const DASH_ICON = svg('<path d="M5 5l7 7-7 7M13 5l7 7-7 7"/>');

export const KNIGHT_NODE_ICONS: Record<string, string> = {
  'k-damage': svg(
    '<path d="M19 5L8 16M19 5l-4 1 3 3 1-4z"/><path d="M6.5 14.5L4 17l3 3 2.5-2.5M4.5 19.5L3 21"/>',
  ),
  'k-hp': svg(
    '<path d="M12 20.5S4.5 15.5 4.5 10a4 4 0 0 1 7.5-2 4 4 0 0 1 7.5 2c0 5.5-7.5 10.5-7.5 10.5z"/>',
  ),
  'k-speed': svg('<path d="M8 12h12M15 7l5 5-5 5M3 8h4M3 12h3M3 16h4"/>'),
  'k-swing': svg('<circle cx="12" cy="12" r="8"/><path d="M12 7v5l4 2"/>'),
  'k-dash': svg('<path d="M3 8h9a2.5 2.5 0 1 0-2.5-2.5M3 12h13a2.5 2.5 0 1 1-2.5 2.5M3 16h7"/>'),
  'k-phase': svg(
    '<circle cx="12" cy="12" r="8.5" stroke-dasharray="2.5 3"/>' +
      '<path d="M4 12h11M12 8.5l4 3.5-4 3.5"/>',
  ),
  'k-arc': svg(
    '<path d="M4 18a9.5 9.5 0 0 1 16 0"/><path d="M12 8.5V5M6.8 10.2 4.5 7.9M17.2 10.2l2.3-2.3"/>',
  ),
  'k-reach': svg('<path d="M4 12h15M14 7l5 5-5 5M4 8v8"/>'),
  'k-keystone': svg(
    '<path d="M8 3a12 12 0 0 1 0 18 9 9 0 0 0 0-18z"/><path d="M13 8l6 0M13 12h8M13 16h6"/>',
  ),
};

export const ABILITY_NODE_ICONS: Record<string, string> = {
  'nova-power': svg(
    '<circle cx="12" cy="12" r="3.2"/>' +
      '<circle cx="12" cy="12" r="8" stroke-dasharray="2.5 3.5"/>' +
      '<path d="M12 1v2M12 21v2M1 12h2M21 12h2"/>',
  ),
  'nova-charge': svg(
    '<path d="M20 12a8 8 0 1 1-2.9-6.2"/><path d="M20 2.5V7h-4.5"/>' +
      '<path d="M12.5 8l-2.5 4h4l-2.5 4"/>',
  ),
  'meteor-power': svg(
    '<circle cx="9" cy="15" r="4.5"/>' +
      '<path d="M13.2 10.8L21 3M15.8 15l4.2-4.2M9 8.5l3.5-3.5"/>' +
      '<path d="M3.5 19.5L2 21M14 20l1.5 1.5"/>',
  ),
  'meteor-cd': svg(
    '<path d="M12 2.5V14M7.5 9.5L12 14l4.5-4.5"/><path d="M4 17a8 4.5 0 0 0 16 0"/>',
  ),
  'meteor-keystone': svg(
    '<circle cx="5" cy="15.5" r="2.4"/><path d="M7.3 13.2L11.5 9"/>' +
      '<circle cx="12.5" cy="18" r="2"/><path d="M14.4 16.1L18 12.5"/>' +
      '<circle cx="16.5" cy="8.5" r="2.8"/><path d="M19.2 5.8L22.5 2.5"/>',
  ),
  'chain-power': svg(
    '<path d="M10.5 2L4.5 11h4.2L7.5 18l6-8.5H9.6L10.5 2z"/>' +
      '<path d="M18.5 8L15 13.5h2.8L16.5 20l4.5-6.8h-2.6L19.5 8z"/>',
  ),
  'chain-keystone': svg(
    '<path d="M13.5 2L8.5 9.5h3.6L10.5 15"/>' +
      '<path d="M5.5 13.5l-2 1M16 12.5l2 1"/>' +
      '<path d="M2.5 19.5c2.4 0 2.4-1.6 4.8-1.6s2.4 1.6 4.7 1.6 2.4-1.6 4.7-1.6 2.4 1.6 4.8 1.6"/>',
  ),
  'volley-power': svg(
    '<path d="M12 2.8c3 4.2 6 7.4 6 11.2a6 6 0 1 1-12 0c0-3.8 3-7 6-11.2z"/>' +
      '<path d="M9.5 14a3 3 0 0 0 2.2 2.9"/>',
  ),
  'volley-count': svg(
    '<path d="M3 12l7-7M10 5l-.3 2.8M10 5l-2.8.3"/>' +
      '<path d="M7 16l7-7M14 9l-.3 2.8M14 9l-2.8.3"/>' +
      '<path d="M11 20l7-7M18 13l-.3 2.8M18 13l-2.8.3"/>',
  ),
  'volley-keystone': svg(
    '<path d="M8 16L19 5M19 5l-.5 4M19 5l-4 .5"/>' +
      '<circle cx="4" cy="14.5" r="1.2" fill="currentColor" stroke="none"/>' +
      '<circle cx="6" cy="19.5" r="1.4" fill="currentColor" stroke="none"/>' +
      '<circle cx="10.5" cy="20.5" r="1.1" fill="currentColor" stroke="none"/>',
  ),
  'well-power': svg(
    '<circle cx="12" cy="12" r="8.5"/>' +
      '<path d="M12 3.5V8M12 16v4.5M3.5 12H8M16 12h4.5"/>' +
      '<circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  ),
  'well-keystone': svg(
    '<path d="M12 21a9 9 0 1 1 9-9"/><path d="M16.5 12A4.5 4.5 0 1 0 12 16.5"/>' +
      '<circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  ),
  'spikes-power': svg(
    '<path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9"/>' +
      '<path d="M9.8 4.8L12 7l2.2-2.2M9.8 19.2L12 17l2.2 2.2"/>',
  ),
  'spikes-keystone': svg(
    '<rect x="4.5" y="4.5" width="15" height="15" rx="2.5"/>' +
      '<path d="M12 8v8M8.5 10l7 4M15.5 10l-7 4"/>',
  ),
  'fire-power': svg(
    '<path d="M9.5 3c.4 3.2-4 4.4-4 8.4a4 4 0 0 0 8 0c0-1.9-1-3.2-2-4.4-.2 1-.6 1.8-1.4 2.2.6-2.1.2-4.2-.6-6.2z"/>' +
      '<path d="M17.8 10.5c.2 1.9-2.2 2.6-2.2 4.8a2.5 2.5 0 0 0 5 0c0-1.1-.5-1.9-1.1-2.6-.1.6-.3 1-.8 1.3.3-1.2.1-2.4-.9-3.5z"/>',
  ),
  'fire-keystone': svg(
    '<path d="M12 2c.4 3.2-4 4.4-4 8.4a4 4 0 0 0 8 0c0-1.9-1-3.2-2-4.4-.2 1-.6 1.8-1.4 2.2.6-2.1.2-4.2-.6-6.2z"/>' +
      '<path d="M4.5 21l15-3.5M4.5 17.5l15 3.5"/>',
  ),
  'deluge-power': svg(
    '<path d="M2 18.5c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/>' +
      '<path d="M12 12V3.5M8.5 7L12 3.5 15.5 7"/>',
  ),
  'deluge-keystone': svg(
    '<path d="M2 8.5c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/>' +
      '<path d="M20 12.5c0 4.5-3.5 7-8 7s-8-2.5-8-7"/>' +
      '<path d="M4 12.5l-2 2M4 12.5l2.6 1.2"/>',
  ),
  'blade-count': svg(
    '<circle cx="12" cy="12" r="8.5" stroke-dasharray="2 4"/>' +
      '<circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>' +
      '<path d="M12 1.5v4M3.2 17.6l3.4-2M20.8 17.6l-3.4-2"/>',
  ),
  'blade-power': svg(
    '<path d="M18.5 3.5L7 15M18.5 3.5l-3.8 1 2.8 2.8 1-3.8z"/>' +
      '<path d="M5.5 13.5L4 15l5 5 1.5-1.5M4.8 18.2L3 20"/>' +
      '<path d="M19.5 12.5l2.5 2.5M17 15l2.5 2.5"/>',
  ),
};

export const HUB_ICON = svg(
  '<path d="M12 3l7 3v5.5c0 4.8-3.2 7.7-7 9.5-3.8-1.8-7-4.7-7-9.5V6z"/><path d="M12 8v6M9 11h6"/>',
);

export const BOOK_ICON = svg(
  '<path d="M12 6.3C10.1 4.8 7.4 4.1 4.5 4.1v14.2c2.9 0 5.6.7 7.5 2.2 1.9-1.5 4.6-2.2 7.5-2.2V4.1c-2.9 0-5.6.7-7.5 2.2z"/>' +
    '<path d="M12 6.3v14.2"/>',
);

export const CLEAR_ICON = svg('<path d="M6 6l12 12M18 6L6 18"/>');

export const SKULL_ICON = svg(
  '<path d="M12 3a7.2 7.2 0 0 0-7.2 7.2c0 2.7 1.5 4.6 3.2 5.7V19a1.8 1.8 0 0 0 1.8 1.8h4.4A1.8 1.8 0 0 0 16 19v-3.1c1.7-1.1 3.2-3 3.2-5.7A7.2 7.2 0 0 0 12 3z"/>' +
    '<circle cx="9.3" cy="11" r="1.5" fill="currentColor" stroke="none"/>' +
    '<circle cx="14.7" cy="11" r="1.5" fill="currentColor" stroke="none"/>' +
    '<path d="M10.5 20.5v-1.4M13.5 20.5v-1.4"/>',
);
