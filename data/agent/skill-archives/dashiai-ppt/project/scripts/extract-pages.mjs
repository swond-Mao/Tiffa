import { pages } from '../src/components/themes/theme09/metadata.js';
const types = pages.map(p => ({key: p.key, layout: p.layout, slot: p.slot, label: p.label}));
console.log(JSON.stringify(types, null, 2));
