// Forever Crafter — Cloudflare Worker
// Sert le site statique (dossier public/) et une petite API :
//   GET /api/character?name=prenom-nom&region=us   -> perso + métiers (API Battle.net, clé cachée ici)
//   GET /api/houses                                 -> liste des hôtels des ventes (Forever AH)
//   GET /api/crafting?house=17&profession=165       -> recettes + coûts + profits (Forever AH, cache 1 h)

const FAH = "https://forever-ah.com";
const REGIONS = new Set(["us", "eu", "kr", "tw"]);
const UA = { "User-Agent": "forever-crafter (fan site; contact via GitHub)" };

let tokenCache = { token: null, exp: 0 };

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    kvEnv = env;
    try {
      switch (url.pathname) {
        case "/api/character": return await character(url, env, ctx);
        case "/api/houses": return await houses(ctx);
        case "/api/crafting": return await crafting(url, ctx);
        default: return json({ error: "Route inconnue" }, 404);
      }
    } catch (e) {
      return json({ error: e.message || String(e) }, e.status || 500);
    }
  },
};

// ---------- utilitaires ----------
function json(data, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": maxAge ? `public, max-age=${maxAge}` : "no-store",
    },
  });
}

function fail(msg, status) { const e = new Error(msg); e.status = status; throw e; }

// Cache : KV (binding CACHE) s'il est configuré — marche sur workers.dev comme sur un domaine perso —
// sinon Cache API de Cloudflare. TTL en secondes.
let kvEnv = null;
async function cached(ctx, key, ttl, producer) {
  if (kvEnv?.CACHE) {
    const hit = await kvEnv.CACHE.get(key, "json");
    if (hit) return hit;
    const data = await producer();
    ctx.waitUntil(kvEnv.CACHE.put(key, JSON.stringify(data), { expirationTtl: Math.max(60, ttl) }));
    return data;
  }
  const cache = caches.default;
  const req = new Request("https://cache.internal/" + encodeURIComponent(key));
  const hit = await cache.match(req);
  if (hit) return hit.json();
  const data = await producer();
  ctx.waitUntil(cache.put(req, new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json", "cache-control": `public, max-age=${ttl}` },
  })));
  return data;
}

async function getJSON(u, init) {
  const r = await fetch(u, init);
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    fail(`${new URL(u).host} a répondu ${r.status}${body ? " : " + body.slice(0, 200) : ""}`, r.status === 404 ? 404 : 502);
  }
  return r.json();
}

// ---------- Battle.net ----------
async function bnetToken(env) {
  if (tokenCache.token && Date.now() < tokenCache.exp) return tokenCache.token;
  if (!env.BNET_CLIENT_ID || !env.BNET_CLIENT_SECRET) fail("Clé Battle.net absente : configure BNET_CLIENT_ID et BNET_CLIENT_SECRET (voir README).", 500);
  const r = await fetch("https://oauth.battle.net/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${env.BNET_CLIENT_ID}:${env.BNET_CLIENT_SECRET}`),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) fail(`Connexion Battle.net refusée (${r.status}). Vérifie le Client ID / Secret.`, 502);
  const t = await r.json();
  tokenCache = { token: t.access_token, exp: Date.now() + (t.expires_in - 300) * 1000 };
  return tokenCache.token;
}

// "Ada Brightwood" -> "ada-brightwood"
export function slugName(raw) {
  return String(raw || "").trim().toLowerCase().replace(/\s+/g, "-");
}

async function character(url, env, ctx) {
  const region = (url.searchParams.get("region") || "us").toLowerCase();
  if (!REGIONS.has(region)) fail("Région invalide", 400);
  const name = slugName(url.searchParams.get("name"));
  if (!/^[\p{L}'’]+-[\p{L}'’-]+$/u.test(name)) fail("Entre le prénom ET le nom du perso (ex. : Ada Brightwood).", 400);

  const data = await cached(ctx, `char:${region}:${name}`, 600, async () => {
    const token = await bnetToken(env);
    const base = `https://${region}.api.blizzard.com/profile/wow/character/${encodeURIComponent(name)}`;
    const qs = `?namespace=profile-forever-${region}&locale=fr_FR`;
    const init = { headers: { Authorization: `Bearer ${token}` } };
    let profile;
    try { profile = await getJSON(base + qs, init); }
    catch (e) {
      if (e.status === 404) fail(`Perso « ${name} » introuvable en ${region.toUpperCase()}. Vérifie l'orthographe (prénom et nom).`, 404);
      throw e;
    }
    let prof = null;
    try { prof = await getJSON(base + "/professions" + qs, init); } catch { /* métiers indisponibles */ }
    return normalizeCharacter(profile, prof);
  });
  return json(data, 200, 300);
}

// Normalise la réponse (format retail : primaries/secondaries -> tiers). Défensif : Forever peut différer.
export function normalizeCharacter(p, prof) {
  const nm = (x) => (x && typeof x === "object" ? (x.name ?? x.type ?? null) : x ?? null);
  const out = {
    name: p.name,
    level: p.level,
    race: nm(p.race),
    class: nm(p.character_class),
    faction: nm(p.faction),
    guild: p.guild ? nm(p.guild) : null,
    professions: [],
  };
  const list = [...(prof?.primaries || []), ...(prof?.secondaries || [])];
  for (const e of list) {
    const tiers = e.tiers || [];
    const best = tiers.reduce((a, t) => ((t.skill_points ?? 0) >= (a?.skill_points ?? -1) ? t : a), null);
    const known = tiers.flatMap((t) => (t.known_recipes || []).map((r) => r.name)).filter(Boolean);
    out.professions.push({
      id: e.profession?.id ?? null,
      name: e.profession?.name ?? "?",
      skill: e.skill_points ?? best?.skill_points ?? null,
      max: e.max_skill_points ?? best?.max_skill_points ?? null,
      known,
    });
  }
  return out;
}

// ---------- Forever AH ----------
async function houses(ctx) {
  const data = await cached(ctx, "houses", 86400, () => getJSON(`${FAH}/v1/houses`, { headers: UA }));
  return json(data, 200, 3600);
}

async function crafting(url, ctx) {
  const house = parseInt(url.searchParams.get("house") || "17", 10);
  const profession = parseInt(url.searchParams.get("profession") || "", 10);
  if (!house || !profession) fail("Paramètres house et profession requis", 400);

  const data = await cached(ctx, `craft:${house}:${profession}`, 3600, async () => {
    const rows = [];
    let offset = 0, total = Infinity, as_of = null, houseInfo = null;
    while (offset < total && offset < 2000) {
      const r = await getJSON(`${FAH}/v1/houses/${house}/crafting?profession=${profession}&limit=200&offset=${offset}`, { headers: UA });
      total = r.total; as_of = r.as_of; houseInfo = r.house;
      rows.push(...r.rows);
      if (!r.rows.length) break;
      offset += r.rows.length;
      if (offset < total) await new Promise((res) => setTimeout(res, 1000)); // ~1 requête/s demandé par Forever AH
    }
    // On réduit à l'essentiel pour le navigateur.
    return {
      as_of, house: houseInfo,
      rows: rows.map((x) => ({
        n: x.recipe_name, id: x.recipe_id, cat: x.category,
        item: x.item?.name, iid: x.item?.item_id, q: x.item?.quality,
        qty: x.crafted_quantity || 1, v: x.unit_value, vs: x.item?.sell_price || 0,
        cost: x.cost, profit: x.profit, spd: x.sold_per_day, ok: x.complete,
        r: (x.reagents || []).map((g) => [g.name, g.quantity, g.unit_price, g.source, g.item_id]),
      })),
    };
  });
  return json(data, 200, 600);
}
