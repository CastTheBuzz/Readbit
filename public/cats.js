// Categories shared by the catalog builder (setup/build-catalog.mjs) and the app.
// The order is the bit position in each book's category mask — only ever ADD to the end.
export const CATS = [
  { key: 'fiction',   name: 'Novels & stories',       icon: '📖' },
  { key: 'life',      name: 'Real lives',             icon: '🧭' },
  { key: 'ideas',     name: 'Philosophy & big ideas', icon: '🏛️' },
  { key: 'mind',      name: 'Psychology & the mind',  icon: '🧠' },
  { key: 'faith',     name: 'Religion & spirit',      icon: '🕯️' },
  { key: 'money',     name: 'Money, work & business', icon: '💰' },
  { key: 'growth',    name: 'Self-improvement',       icon: '🌱' },
  { key: 'history',   name: 'History',                icon: '🏺' },
  { key: 'society',   name: 'Politics & society',     icon: '⚖️' },
  { key: 'science',   name: 'Science & nature',       icon: '🔭' },
  { key: 'adventure', name: 'Adventure',              icon: '⛵' },
  { key: 'mystery',   name: 'Mystery & crime',        icon: '🔍' },
  { key: 'romance',   name: 'Romance',                icon: '💌' },
  { key: 'scifi',     name: 'Sci-fi & fantasy',       icon: '🚀' },
  { key: 'horror',    name: 'Horror & ghosts',        icon: '🕸️' },
  { key: 'humor',     name: 'Humour',                 icon: '😄' },
  { key: 'war',       name: 'War',                    icon: '🎖️' },
  { key: 'poetry',    name: 'Poetry',                 icon: '🪶' },
  { key: 'drama',     name: 'Plays',                  icon: '🎭' },
  { key: 'travel',    name: 'Travel & places',        icon: '🗺️' },
  { key: 'kids',      name: "Children's",             icon: '🧸' },
  { key: 'sport',     name: 'Sport & outdoors',       icon: '🏃' },
  { key: 'arts',      name: 'Art & music',            icon: '🎨' },
  { key: 'health',    name: 'Health & body',          icon: '🩺' },
  { key: 'food',      name: 'Food & home',            icon: '🍲' },
  { key: 'classics',  name: 'Great classics',         icon: '⭐' },
  { key: 'periodicals', name: 'Magazines & journals', icon: '🗞️' },
  { key: 'deep',      name: 'Deep messages',          icon: '💭' },
];
export const BIT = Object.fromEntries(CATS.map((c, i) => [c.key, 1 << i]));
export const LANGS = { en: 'English', sq: 'Shqip', fr: 'Français', de: 'Deutsch' };
