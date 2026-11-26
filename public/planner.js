// Logique de calcul (aucune dépendance) : utilisée par la page et par les tests.

// Correspondance métier MetaBot (clé du fichier recipes.json) -> id Blizzard / Forever AH
export const PROFESSIONS = {
  leatherworking: { id: 165, fr: "Travail du cuir" },
  blacksmithing: { id: 164, fr: "Forge" },
  tailoring: { id: 197, fr: "Couture" },
  engineering: { id: 202, fr: "Ingénierie" },
  enchanting: { id: 333, fr: "Enchantement" },
  alchemy: { id: 171, fr: "Alchimie" },
  cooking: { id: 185, fr: "Cuisine" },
  "first-aid": { id: 129, fr: "Secourisme" },
  mining: { id: 186, fr: "Minage (fonte)" },
};
export const TRAINER_CAPS = [75, 150, 225, 300];
const FREE_SOURCES = /^(auto|trainer)/i;
export const AH_CUT = 0.95; // l'HV garde 5 %

export const norm = (s) => String(s || "").toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();

// Ligne du fichier MetaBot : [name, slug, new, learn, learnEstimated, [o,y,g,grey], [[reagent, qty]], source]
export function parseRecipes(rows) {
  return rows
    .filter((r) => Array.isArray(r[5]) && r[5].length === 4)
    .map((r) => ({
      name: r[0], isNew: !!r[2], learn: r[3] ?? r[5][0], learnEstimated: !!r[4],
      o: r[5][0], y: r[5][1], g: r[5][2], grey: r[5][3],
      reagents: (r[6] || []).map(([n, q]) => ({ name: n, qty: q })),
      source: r[7] || "?",
      free: FREE_SOURCES.test(r[7] || ""),
    }));
}

// Carte des prix (cuivre) à partir des lignes de /api/crafting : réactifs + objets fabriqués.
export function priceMap(craftRows) {
  const m = new Map();
  for (const row of craftRows) {
    for (const [n, , price] of row.r) if (price != null && !m.has(norm(n))) m.set(norm(n), price);
  }
  for (const row of craftRows) if (row.item && row.v && !m.has(norm(row.item))) m.set(norm(row.item), row.v);
  return m;
}

// Fusionne recette MetaBot + données de marché ; calcule coût et revente par craft.
export function enrich(recipes, craftRows, opts = {}) {
  const byName = new Map(craftRows.map((r) => [norm(r.n), r]));
  const prices = priceMap(craftRows);
  const known = new Set((opts.known || []).map(norm));
  return recipes.map((rec) => {
    const m = byName.get(norm(rec.name));
    let cost = m && m.ok ? m.cost : null;
    let missing = [];
    if (cost == null) {
      cost = 0;
      for (const g of rec.reagents) {
        const p = prices.get(norm(g.name));
        if (p == null) missing.push(g.name); else cost += p * g.qty;
      }
      if (missing.length) cost = null;
    }
    const qty = m?.qty || 1;
    const ahValue = m?.v ? m.v * qty * AH_CUT : 0;
    const liquid = (m?.spd ?? 0) >= 1;
    const vendorValue = (m?.vs || 0) * qty;
    const resale = Math.max(vendorValue, liquid ? ahValue : 0);
    return {
      ...rec, market: m || null, cost, missing,
      resale, net: cost == null ? null : cost - (opts.sell === false ? vendorValue : resale),
      known: known.has(norm(rec.name)),
    };
  });
}

// Probabilité de gagner un point : orange 100 %, puis (gris - skill) / (gris - jaune).
export function skillChance(r, s) {
  if (s < r.learn || s >= r.grey) return 0;
  if (s < r.y) return 1;
  if (r.grey === r.y) return 0;
  return Math.max(0, Math.min(1, (r.grey - s) / (r.grey - r.y)));
}

// Plan glouton : à chaque point, la recette au plus faible coût net espéré par point.
// opts: { target, includeBuyable, timeValue (cuivre par craft, pour départager), knownOnly }
export function plan(enriched, start, opts = {}) {
  const target = Math.min(opts.target ?? 300, 300);
  const timeValue = opts.timeValue ?? 25;
  const usable = enriched.filter((r) => r.net != null && (r.free || r.known || opts.includeBuyable));
  const points = [];
  for (let s = start; s < target; s++) {
    let best = null;
    for (const r of usable) {
      const p = skillChance(r, s);
      if (p <= 0) continue;
      const score = (r.net + timeValue) / p;
      if (!best || score < best.score) best = { r, p, score };
    }
    if (!best) { points.push({ s, r: null }); continue; }
    points.push({ s, r: best.r, p: best.p });
  }
  // Regroupe les points consécutifs en étapes.
  const steps = [];
  for (const pt of points) {
    const last = steps[steps.length - 1];
    if (last && last.recipe === pt.r) { last.to = pt.s + 1; last.crafts += pt.r ? 1 / pt.p : 0; }
    else steps.push({ from: pt.s, to: pt.s + 1, recipe: pt.r, crafts: pt.r ? 1 / pt.p : 0 });
  }
  for (const st of steps) {
    st.crafts = Math.ceil(st.crafts - 1e-9);
    if (st.recipe) {
      st.cost = st.crafts * st.recipe.cost;
      st.resale = st.crafts * st.recipe.resale;
      st.net = st.crafts * st.recipe.net;
    }
    st.trainer = TRAINER_CAPS.filter((c) => c >= st.from && c < st.to && c < 300);
  }
  const shopping = new Map();
  for (const st of steps) if (st.recipe) for (const g of st.recipe.reagents) {
    shopping.set(g.name, (shopping.get(g.name) || 0) + g.qty * st.crafts);
  }
  const totals = steps.reduce((a, st) => ({
    crafts: a.crafts + st.crafts, cost: a.cost + (st.cost || 0), resale: a.resale + (st.resale || 0), net: a.net + (st.net || 0),
  }), { crafts: 0, cost: 0, resale: 0, net: 0 });
  return { steps, shopping: [...shopping].sort((a, b) => b[1] - a[1]), totals, gaps: steps.filter((s) => !s.recipe) };
}

// Recettes rentables faisables au skill actuel.
export function goldList(enriched, skill, opts = {}) {
  const cap = opts.salesCap ?? 10;
  return enriched
    .filter((r) => r.market && r.market.ok && r.market.profit > 0 && r.learn <= skill)
    .filter((r) => r.free || r.known || opts.includeBuyable)
    .map((r) => {
      const m = r.market;
      const roi = m.cost > 0 ? m.profit / m.cost : null;
      const perDay = m.profit * Math.min(m.spd || 0, cap);
      return { r, profit: m.profit, cost: m.cost, value: m.v, roi, spd: m.spd, perDay };
    })
    .sort((a, b) => b.perDay - a.perDay);
}

export function money(c) {
  if (c == null || isNaN(c)) return "?";
  const neg = c < 0; c = Math.round(Math.abs(c));
  const g = Math.floor(c / 10000), s = Math.floor((c % 10000) / 100), cu = c % 100;
  const parts = [];
  if (g) parts.push(`${g.toLocaleString("fr-CA")}g`);
  if (s || g) parts.push(`${s}s`);
  if (!g) parts.push(`${cu}c`);
  return (neg ? "−" : "") + parts.join(" ");
}
