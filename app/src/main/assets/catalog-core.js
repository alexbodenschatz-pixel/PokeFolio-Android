(function(root, factory) {
  const api = factory();
  // Blob worker has no network/importScripts dependency (the WebView uses file assets).
  api.workerSource = 'const Catalog = (' + factory.toString() + ')();\n' + `
    let index;
    onmessage = event => {
      const {id, type, cards, sets, hints, manual} = event.data;
      try {
        if (type === 'init') { Catalog.registerSets(sets); index = new Catalog.Index(cards); }
        if (type === 'add') index.add(cards);
        postMessage({id, result: type === 'lookup' ? index.lookup(hints, manual) : true});
      } catch (error) { postMessage({id, error: error.message}); }
    };`;
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PokeCatalog = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const normalizeName = value => String(value || '').normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  function normalizeNumber(value) {
    return String(value || '').toUpperCase().replace(/\s/g, '').replace(/[|／\\]/g, '/')
      .replace(/O(?=\d)/g, '0').split('/').map(part => part.replace(/^(\D*)0+(?=\d)/, '$1')).join('/');
  }
  function normalizeSet(value) {
    const text = String(value || '').toUpperCase().replace(/[.\s-]/g, '');
    const match = text.match(/^([A-Z0-9]{2,8}?)(DE|EN|FR|IT|ES|PT)$/);
    return {code: match ? match[1] : text, language: match ? match[2].toLowerCase() : ''};
  }
  const aliases = {pal: 'sv02', svi: 'sv01', obf: 'sv03', par: 'sv04', paf: 'sv04.5',
    tef: 'sv05', twm: 'sv06', sfa: 'sv06.5', scr: 'sv07', ssp: 'sv08',
    pre: 'sv08.5', jtg: 'sv09', dri: 'sv10', mep: 'mep', svp: 'svp'};
  const setNames = new Map();
  function setId(value) {
    const id = String(value || '').toLowerCase().replace(/^tcgdex:/, '')
      .replace(/^pokemon:[a-z-]+:/, '').replace(/\s/g, '');
    return (aliases[normalizeSet(id).code.toLowerCase()] || id).replace(/^(sv|swsh|me)0*(\d+)/, (_, p, n) => p + Number(n));
  }
  function registerSets(sets) {
    for (const set of sets || []) {
      const official = set.abbreviation && set.abbreviation.official;
      if (official) aliases[String(official).toLowerCase()] = set.id;
      const key = normalizeName(set.name);
      const id = setId(set.id);
      // Ambiguous names never become alias evidence.
      setNames.set(key, setNames.has(key) && setNames.get(key) !== id ? null : id);
    }
  }
  function canonicalSetId(card) {
    const game = String(card.tcg || 'pokemon').toLowerCase();
    const language = String(card.language || card.lang || 'de').toLowerCase();
    const raw = card.setId || card.setCode || '';
    const knownName = game === 'pokemon' && setNames.get(normalizeName(card.set));
    const id = game === 'pokemon' ? (knownName || setId(raw || card.set)) : normalizeName(raw || card.set);
    return game + ':' + language + ':' + (id || 'unknown');
  }
  function similarity(a, b) {
    a = normalizeName(a); b = normalizeName(b);
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a))) return .88;
    let row = Array.from({length: b.length + 1}, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const next = [i];
      for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j-1]+1, row[j]+1, row[j-1]+(a[i-1] === b[j-1] ? 0 : 1));
      row = next;
    }
    return 1 - row[b.length] / Math.max(a.length, b.length);
  }
  function parseName(value) {
    const displayName = String(value || '').normalize('NFKC').replace(/[‐‑–—]/g, '-')
      .replace(/\b(?:KP|HP)\s*\d+|\b\d+\s*(?:KP|HP)\b/gi, '').trim();
    const prefix = displayName.match(/^(Mega|Alola|Galar|Hisui|Paldea|Shiny|M)(?:[- ]|(?=[A-ZÄÖÜ]))/i);
    const suffix = displayName.match(/(?:[- ]|^)(VSTAR|VMAX|TAG TEAM|GX|EX|ex|V)(?=\s*(?:δ|Delta Species)?\s*$)/);
    const delta = /δ|delta\s*species/i.test(displayName);
    const basePokemon = displayName.replace(/^(Mega|Alola|Galar|Hisui|Paldea|Shiny|M)[- ]/i, '')
      .replace(/[- ](?:VSTAR|VMAX|TAG TEAM|GX|EX|ex|V)(?=\s*(?:δ|Delta Species)?\s*$)/, '')
      .replace(/δ|delta\s*species/gi, '').trim();
    return {displayName, normalizedFullName: normalizeName(displayName), basePokemon,
      variantPrefix: prefix ? prefix[1].toLowerCase().replace(/^m$/, 'mega') : '',
      variantSuffix: suffix ? suffix[1] : '', delta};
  }
  function variantMismatch(query, candidate) {
    const regional = new Set(['alola','galar','hisui','paldea']);
    const prefixConflict = query.variantPrefix !== candidate.variantPrefix
      && (query.variantPrefix || candidate.variantPrefix && !regional.has(candidate.variantPrefix));
    return Boolean(prefixConflict || query.variantSuffix !== candidate.variantSuffix || query.delta !== candidate.delta);
  }
  function fullName(hints, manual) {
    if (manual) return manual;
    const top = String(hints.ocrByRegion?.top || '').split('\n').map(line => line.trim())
      .filter(line => !/entwickelt|evolves|copyright|nintendo|creatures|game freak|illus|fähigkeit|ability|©/i.test(line));
    const variantTitle = top.find(line => /^(?:Mega|Alola|Galar|Hisui|Paldea|Shiny)[- ]/i.test(line));
    return variantTitle || hints.mainTitle || hints.nameHints?.[0]?.value || '';
  }
  function constrain(candidate) {
    if (!candidate.similarOnly) return candidate;
    return {...candidate, confidence: Math.min(.39, Number(candidate.confidence) || 0),
      identificationScore: Math.min(.39, Number(candidate.identificationScore) || 0),
      finalConfidence: Math.min(.39, Number(candidate.finalConfidence ?? candidate.confidence) || 0)};
  }
  function guardCandidate(card, hints) {
    const f = features(hints);
    const number = f.number.split('/')[0];
    const wrongSet = f.set && canonicalSetId(card) !== 'pokemon:' + f.language + ':' + f.set;
    const wrongNumber = number && normalizeNumber(card.number).split('/')[0] !== number;
    const wrongVariant = f.name && variantMismatch(f.parsedName, parseName(card.name));
    return constrain({...card, similarOnly: Boolean(card.similarOnly || wrongSet || wrongNumber || wrongVariant)});
  }
  function features(hints, manual) {
    const collector = (hints.collectorNumbers || [])[0] || {};
    const footer = (hints.bottomRoiText || hints.bottomMetadataText || '')
      + '\n' + (hints.regionTexts && hints.regionTexts.BOTTOM_METADATA || '');
    const set = normalizeSet((hints.pokemonSetCodes || [])[0]?.value || hints.setCode || '');
    return {name: normalizeName(fullName(hints, manual)), parsedName: parseName(fullName(hints, manual)),
      number: normalizeNumber(collector.number || hints.pokemonNumber || ''),
      total: normalizeNumber(collector.total || ''), set: setId(set.code),
      code: set.code, language: set.language || hints.language || 'de', footer};
  }
  class Index {
    constructor(cards = []) {
      this.cards = new Map(); this.byNumber = new Map(); this.byName = new Map();
      this.bySetNumber = new Map(); this.bySet = new Map(); this.byBaseName = new Map(); this.add(cards);
    }
    add(cards) {
      const put = (map, key, id) => { if (!key) return; if (!map.has(key)) map.set(key, new Set()); map.get(key).add(id); };
      for (const card of cards) {
        if (!card.id || !card.name) continue;
        const id = (card.language || 'de') + ':' + card.id;
        const old = this.cards.get(id);
        if (old) {
          for (const [map, key] of [[this.byNumber, normalizeNumber(old.number).split('/')[0]],
            [this.byName, normalizeName(old.name)], [this.byBaseName, normalizeName(parseName(old.name).basePokemon)], [this.bySet, canonicalSetId(old)],
            [this.bySetNumber, canonicalSetId(old) + ':' + normalizeNumber(old.number).split('/')[0]]]) map.get(key)?.delete(id);
        }
        const merged = {...old, ...card, imageSmall: card.imageSmall || old?.imageSmall, imageLarge: card.imageLarge || old?.imageLarge}; this.cards.set(id, merged);
        const number = normalizeNumber(merged.number).split('/')[0];
        const set = canonicalSetId(merged);
        put(this.byBaseName, normalizeName(parseName(merged.name).basePokemon), id);
        put(this.byNumber, number, id); put(this.byName, normalizeName(merged.name), id);
        put(this.bySet, set, id); put(this.bySetNumber, set + ':' + number, id);
      }
    }
    lookup(hints, manual) {
      const lookupStarted = performance.now();
      const f = features(hints, manual); const ids = new Set();
      const set = 'pokemon:' + f.language + ':' + f.set;
      const number = f.number.split('/')[0];
      const collect = matches => { for (const id of matches || []) ids.add(id); };
      const exactIds = f.set && number ? this.bySetNumber.get(set + ':' + number) : null;
      const exactCount = exactIds?.size || 0;
      if (exactCount) collect(exactIds);
      if (!exactCount && number) collect(this.byNumber.get(number));
      if (!exactCount && f.name) {
        collect(this.byName.get(f.name));
        collect(this.byBaseName.get(normalizeName(f.parsedName.basePokemon)));
        // Fuzzy work visits unique names, never the entire card catalog.
        const exactName = this.byName.has(f.name);
        for (const [name, matches] of this.byName) {
          if (Math.min(name.length, f.name.length) >= 4 && (name.includes(f.name) || f.name.includes(name))
            || !exactName && Math.abs(name.length - f.name.length) <= 3 && similarity(f.name, name) >= .70) collect(matches);
        }
      }
      const lookupMs = performance.now() - lookupStarted;
      const rankingStarted = performance.now();
      const ranked = [];
      for (const id of ids) {
        const card = this.cards.get(id);
        if ((card.language || 'de') !== f.language) continue;
        const n = !!number && normalizeNumber(card.number).split('/')[0] === number;
        const s = !!f.set && canonicalSetId(card) === set;
        const title = similarity(f.name, card.name);
        const total = !f.total || !card.printedTotal || normalizeNumber(card.printedTotal) === f.total;
        const exact = n && s && total;
        const form = parseName(card.name);
        const variantConflict = !!f.name && variantMismatch(f.parsedName, form);
        const baseScore = similarity(f.parsedName.basePokemon, form.basePokemon);
        const contradictions = [f.set && !s ? 'SET' : '', number && !n ? 'NUMBER' : '',
          !total ? 'TOTAL' : '', variantConflict ? 'VARIANT' : ''].filter(Boolean);
        const similarOnly = contradictions.length > 0;
        let score = exact ? (title >= .70 ? .98 : f.name ? .78 : .94)
          : n && title >= .70 && total ? .90 : title >= .70 ? .55 + .18 * title : n ? .32 : 0;
        if (similarOnly) score = Math.max(0, Math.min(.39, Math.max(score, baseScore >= .70 ? .25 + baseScore * .14 : 0)) - (variantConflict ? .12 : 0) - (number && !n ? .02 : 0));
        if (!score || !exact && title < .50 && baseScore < .70) continue;
        const stage = exact ? 'set+number' : n && title >= .70 ? 'name+number' : title >= .70 ? 'name' : 'number';
        ranked.push({...card, confidence: score, identificationScore: score,
          localMatchStage: stage, similarOnly, identityContradictions: contradictions, parsedName: form,
          matchDetails: {collector: n ? 'match' : number ? 'mismatch' : 'unknown',
            set: s ? 'match' : f.set ? 'mismatch' : 'unknown', variant: variantConflict ? 'mismatch' : 'match', name: title, hp: 'unknown'}, localCatalog: true});
      }
      ranked.sort((a,b) => b.confidence - a.confidence);
      const unique = new Map();
      for (const card of ranked) {
        const key = canonicalSetId(card) + ':' + normalizeNumber(card.number);
        if (!unique.has(key)) unique.set(key, card);
      }
      const candidates = [...unique.values()].slice(0, 80);
      return {candidates, exactCount, fuzzyCount: exactCount ? 0 : candidates.length, lookupMs, rankingMs: performance.now() - rankingStarted, features: f, stage: candidates[0]?.localMatchStage || 'catalog-miss',
        strong: candidates[0]?.confidence >= .94 && (!candidates[1] || candidates[0].confidence - candidates[1].confidence >= .06)};
    }
  }
  return {Index, normalizeName, normalizeNumber, normalizeSet, setId, registerSets, canonicalSetId, features, similarity, parseName, fullName, variantMismatch, constrain, guardCandidate};
});
