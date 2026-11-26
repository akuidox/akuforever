import assert from "node:assert/strict";
import { parseRecipes, enrich, plan, goldList, skillChance, money } from "../public/planner.js";
import { normalizeCharacter, slugName } from "../src/worker.js";

// Extrait réel (MetaBot + Forever AH, 2026-11-25), réduit.
const lw = [
  ["Light Armor Kit", null, 0, 1, 0, [1, 30, 45, 60], [["Light Leather", 1]], "Auto"],
  ["Handstitched Leather Boots", null, 0, 1, 0, [1, 40, 55, 70], [["Light Leather", 2], ["Coarse Thread", 1]], "Auto"],
  ["Handstitched Leather Vest", null, 0, 1, 0, [1, 40, 55, 70], [["Light Leather", 3], ["Coarse Thread", 1]], "Auto"],
  ["Azure Gustwoven Boots", null, 1, 55, 0, [55, 60, 63, 65], [["Light Leather", 6], ["Coarse Thread", 3]], "Recipe"],
  ["Small Leather Ammo Pouch", null, 0, 55, 1, [55, 55, 70, 85], [["Light Leather", 3], ["Coarse Thread", 4]], "Trainer"],
  ["Embossed Leather Gloves", null, 0, 70, 1, [70, 70, 85, 100], [["Light Leather", 3], ["Coarse Thread", 2]], "Trainer"],
  ["Fine Leather Belt", null, 0, 85, 1, [85, 85, 100, 115], [["Light Leather", 6], ["Coarse Thread", 2]], "Trainer"],
  ["Dragonscale Leatherworking", null, 0, 225, 0, [], [], "Trainer"], // spécialisation : ignorée
];
const craft = [
  { n: "Light Armor Kit", q: "COMMON", qty: 1, v: 14, vs: 15, cost: 39, profit: -26, spd: 7579, ok: true, r: [["Light Leather", 1, 39]] },
  { n: "Handstitched Leather Vest", q: "UNCOMMON", qty: 1, v: 132, vs: 40, cost: 129, profit: -4, spd: 1642, ok: true, r: [["Light Leather", 3, 39], ["Coarse Thread", 1, 12]] },
  { n: "Azure Gustwoven Boots", q: "UNCOMMON", qty: 1, v: 1599, vs: 0, cost: 270, profit: 1249, spd: 435, ok: true, r: [["Light Leather", 6, 39], ["Coarse Thread", 3, 12]] },
  { n: "Small Leather Ammo Pouch", q: "COMMON", qty: 1, v: 44, vs: 25, cost: 165, profit: -124, spd: 567, ok: true, r: [["Light Leather", 3, 39], ["Coarse Thread", 4, 12]] },
  { n: "Embossed Leather Gloves", q: "UNCOMMON", qty: 1, v: 99, vs: 71, cost: 141, profit: -47, spd: 7174, ok: true, r: [["Light Leather", 3, 39], ["Coarse Thread", 2, 12]] },
  { n: "Fine Leather Belt", q: "UNCOMMON", qty: 1, v: 199, vs: 125, cost: 258, profit: -69, spd: 4605, ok: true, r: [["Light Leather", 6, 39], ["Coarse Thread", 2, 12]] },
];

const recipes = parseRecipes(lw);
assert.equal(recipes.length, 7, "la spécialisation sans seuils est ignorée");

// Chances de skill-up
const kit = recipes[0];
assert.equal(skillChance(kit, 10), 1);
assert.equal(skillChance(kit, 30), 1);          // jaune : (60-30)/(60-30)
assert.equal(skillChance(kit, 45), 0.5);        // vert
assert.equal(skillChance(kit, 60), 0);          // gris

// Coût calculé à partir des prix des réactifs quand la recette n'a pas de ligne marché
const en = enrich(recipes, craft);
const boots = en.find((r) => r.name === "Handstitched Leather Boots");
assert.equal(boots.market, null);
assert.equal(boots.cost, 2 * 39 + 12);

// Plan sans recettes à acheter : doit couvrir 1 -> 115, sans trou
const p = plan(en, 1, { target: 115 });
assert.equal(p.gaps.length, 0, "aucun trou entre 1 et 115");
assert.equal(p.steps[0].from, 1);
assert.equal(p.steps.at(-1).to, 115);
assert.ok(p.steps.every((s) => s.recipe.free), "uniquement maître/auto");
assert.ok(p.steps.some((s) => s.trainer.includes(75)), "rappel du maître à 75");
assert.ok(p.totals.crafts > 114);
for (let i = 1; i < p.steps.length; i++) assert.equal(p.steps[i].from, p.steps[i - 1].to, "étapes contiguës");

// Avec les recettes à acheter, les Azure Gustwoven Boots (rentables) entrent dans le plan vers 55-60
const pb = plan(en, 55, { target: 70, includeBuyable: true });
assert.equal(pb.steps[0].recipe.name, "Azure Gustwoven Boots");

// Liste gold
const g = goldList(en, 60, { includeBuyable: true });
assert.equal(g[0].r.name, "Azure Gustwoven Boots");
assert.equal(goldList(en, 60).length, 0, "sans recettes achetées : rien de rentable ici");

// Utilitaires
assert.equal(money(1234567), "123g 45s");
assert.equal(money(250), "2s 50c");
assert.equal(money(-26), "−26c");
assert.equal(slugName("  Ada  Brightwood "), "ada-brightwood");

const c = normalizeCharacter(
  { name: "Ada Brightwood", level: 42, race: { name: "Elfe de la nuit" }, character_class: { name: "Druide" }, faction: { type: "ALLIANCE", name: "Alliance" } },
  { primaries: [{ profession: { id: 165, name: "Travail du cuir" }, tiers: [{ skill_points: 142, max_skill_points: 150, known_recipes: [{ name: "Light Armor Kit" }] }] }] },
);
assert.deepEqual(c.professions[0], { id: 165, name: "Travail du cuir", skill: 142, max: 150, known: ["Light Armor Kit"] });

console.log("OK —", p.steps.map((s) => `${s.from}-${s.to} ${s.recipe.name} ×${s.crafts}`).join(" | "));
console.log("Coût net 1→115 :", money(p.totals.net));
