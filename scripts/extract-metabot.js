// Rafraîchir public/data/recipes.json (seuils de skill des recettes).
// 1. Ouvre https://metabot.gg/en/wow-forever/professions/leatherworking dans ton navigateur.
// 2. Ouvre la console (F12), colle tout ce fichier, Entrée.
// 3. Le navigateur télécharge forever-recipes-skill.json : copie-le dans public/data/recipes.json.
// Données tirées du client WoW Forever par MetaBot.gg ; un usage personnel/entre amis, crédite la source.
(async () => {
  const profs = ["leatherworking", "blacksmithing", "tailoring", "engineering", "enchanting", "alchemy", "cooking", "first-aid", "mining", "comprehension"];
  const parse = (d) => {
    const t = [...d.querySelectorAll("table")].find((t) => /SKILL COLORS/i.test(t.rows[0]?.textContent || ""));
    if (!t) return [];
    return [...t.rows].slice(1).filter((r) => r.cells.length >= 5).map((r) => {
      const c = r.cells, a = c[0].querySelector("a"), learn = c[1].textContent.trim();
      return [
        c[0].querySelector("bdi")?.textContent.trim(),
        a?.getAttribute("href")?.split("/").pop() || null,
        c[0].querySelector("[class*=newTag]") ? 1 : 0,
        parseInt(learn) || null,
        learn.includes("*") ? 1 : 0,
        [...c[2].querySelectorAll("[class*=skillNums] > span")].map((s) => parseInt(s.textContent)),
        [...c[3].querySelectorAll("li")].map((li) => [li.querySelector("bdi")?.textContent.trim(), parseInt((li.querySelector("[class*=qty]")?.textContent || "1").replace(/\D/g, "")) || 1]),
        c[4].textContent.trim(),
      ];
    });
  };
  const all = { _cols: ["name", "slug", "new", "learn", "learnEstimated", "skill[o,y,g,grey]", "reagents[[name,qty]]", "source"], _src: "metabot.gg, WoW Forever client", _date: new Date().toISOString().slice(0, 10) };
  for (const p of profs) {
    const h = await fetch("/en/wow-forever/professions/" + p).then((r) => r.text());
    all[p] = parse(new DOMParser().parseFromString(h, "text/html"));
    console.log(p, all[p].length);
    await new Promise((r) => setTimeout(r, 500));
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(all)], { type: "application/json" }));
  a.download = "forever-recipes-skill.json";
  document.body.appendChild(a); a.click();
})();
