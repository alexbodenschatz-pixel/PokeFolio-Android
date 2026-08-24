(function (root, factory) {
  const names = typeof module === 'object' && module.exports
    ? require('./pokemon-names.js')
    : root.PokeNames;
  const api = factory(names || {entries: []});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PokeRecognition = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (PokemonNames) {
  'use strict';

  const bannedNameTerms = [
    'basis', 'basic', 'phase 1', 'phase 2', 'stage 1', 'stage 2', 'trainer',
    'energy', 'energie', 'pokemon', 'pokémon', 'sammeln', 'ziehe', 'schaden',
    'damage', 'attack', 'ability', 'fähigkeit', 'illustrator', 'illustration',
    'copyright', 'bandai', 'konami', 'character', 'leader', 'counter', 'don!!',
    'event', 'retreat', 'weakness', 'resistance', 'schwäche', 'resistenz',
    'pokedex', 'pokédex', 'national', 'nummer', 'größe', 'gewicht', 'entwickelt sich',
    'entwicklung', 'rückzug', 'illus', 'nr.'
  ];
  const pokemonCollectorPrefixes = new Set([
    'TG', 'GG', 'SV', 'RC', 'SH', 'H',
    'SWSH', 'SVP', 'SM', 'XY', 'BW', 'DP', 'HGSS', 'PR'
  ]);
  const pokemonNameEntries = Array.isArray(PokemonNames && PokemonNames.entries)
    ? PokemonNames.entries
    : [];
  const pokemonVariantOrder = ['VMAX', 'VSTAR', 'GX', 'EX', 'ex', 'V'];
  let pokemonNameIndex;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function norm(value) {
    return String(value || '')
      .toLocaleLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function pokemonNameKey(value) {
    return norm(String(value || '').replace(/♀/g, ' female ').replace(/♂/g, ' male '));
  }

  function similarity(left, right) {
    const a = norm(left);
    const b = norm(right);
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.includes(b) || b.includes(a)) return 0.91;
    const aa = a.split(' ');
    const bb = b.split(' ');
    let overlap = 0;
    aa.forEach(token => {
      if (token.length > 2 && bb.includes(token)) overlap++;
    });
    const tokenScore = overlap / Math.max(aa.length, bb.length, 1);
    const previous = Array.from({length: b.length + 1}, (_, index) => index);
    for (let i = 1; i <= a.length; i++) {
      let diagonal = previous[0];
      previous[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const old = previous[j];
        previous[j] = Math.min(
          previous[j] + 1,
          previous[j - 1] + 1,
          diagonal + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
        diagonal = old;
      }
    }
    return clamp(Math.max(tokenScore, 1 - previous[b.length] / Math.max(a.length, b.length)), 0, 1);
  }

  function pokemonNames() {
    if (pokemonNameIndex) return pokemonNameIndex;
    const aliases = [];
    const byId = new Map();
    pokemonNameEntries.forEach(entry => {
      const normalized = {
        id: Number(entry.id),
        en: String(entry.en || ''),
        de: String(entry.de || '')
      };
      if (!normalized.id || !normalized.en || !normalized.de) return;
      byId.set(normalized.id, normalized);
      [['en', normalized.en], ['de', normalized.de]].forEach(([language, display]) => {
        const key = pokemonNameKey(display);
        if (key) aliases.push({id: normalized.id, language, display, key, entry: normalized});
      });
    });
    aliases.sort((left, right) => right.key.length - left.key.length);
    pokemonNameIndex = {aliases, byId};
    return pokemonNameIndex;
  }

  function normalizePokemonVariant(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (raw === 'ex') return 'ex';
    const upper = raw.toUpperCase();
    return pokemonVariantOrder.includes(upper) ? upper : '';
  }

  function extractPokemonVariant(value) {
    const source = String(value || '');
    const matches = source.match(/(?:^|\s)(VMAX|VSTAR|GX|EX|ex|V)(?=\s|$|[^\p{L}\p{N}])/gu) || [];
    for (const match of matches) {
      const token = match.trim().match(/VMAX|VSTAR|GX|EX|ex|V/u);
      const normalized = normalizePokemonVariant(token && token[0]);
      if (normalized) return normalized;
    }
    return '';
  }

  function cleanPokemonIdentityText(value) {
    return String(value || '')
      .replace(/\b(?:KP|HP)\s*[0-9OIL|]{2,3}\b/ig, ' ')
      .replace(/^(?:BASIS|BASIC|PHASE|STAGE)\s*\d*\s*/i, '')
      .replace(/\b(?:VMAX|VSTAR|GX|EX|ex|V)\b/g, ' ')
      .replace(/[^\p{L}\p{N}.'’♀♂ -]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function bestKnownPokemonName(value, allowFuzzy) {
    const cleaned = cleanPokemonIdentityText(value);
    const normalized = pokemonNameKey(cleaned);
    if (!normalized) return null;
    const index = pokemonNames();
    const padded = ` ${normalized} `;
    const exact = index.aliases.find(alias => padded.includes(` ${alias.key} `));
    if (exact) return {...exact, confidence: 1, exact: true};
    if (!allowFuzzy) return null;

    const words = normalized.split(' ').filter(Boolean);
    let best = null;
    index.aliases.forEach(alias => {
      const aliasWords = alias.key.split(' ');
      if (aliasWords.length > words.length) return;
      for (let start = 0; start <= words.length - aliasWords.length; start++) {
        const phrase = words.slice(start, start + aliasWords.length).join(' ');
        if (Math.abs(phrase.length - alias.key.length) > (alias.key.length >= 9 ? 2 : 1)) continue;
        if (phrase[0] !== alias.key[0]) continue;
        const score = similarity(phrase, alias.key);
        const threshold = alias.key.length >= 8 ? 0.84 : alias.key.length >= 5 ? 0.86 : 0.9;
        if (score >= threshold && (!best || score > best.confidence)) {
          best = {...alias, confidence: score, exact: false};
        }
      }
    });
    return best;
  }

  function candidatePokemonIdentity(name) {
    const match = bestKnownPokemonName(name, false);
    return match ? {
      speciesId: match.id,
      englishName: match.entry.en,
      germanName: match.entry.de,
      variant: extractPokemonVariant(name)
    } : null;
  }

  function cleanOcrDigits(value) {
    const compact = String(value || '').toUpperCase().replace(/[\s_]/g, '');
    if (!/\d/.test(compact)) return '';
    return compact.replace(/O/g, '0').replace(/[IL|]/g, '1');
  }

  function numberKey(value) {
    const cleaned = cleanOcrDigits(value).replace(/[^A-Z0-9]/g, '');
    const match = cleaned.match(/^([A-Z]*)(\d+)([A-Z]*)$/);
    if (!match) return cleaned;
    return match[1] + String(parseInt(match[2], 10)) + match[3];
  }

  function parsePokemonCollector(numberValue, totalValue, context) {
    const line = String(context && context.text || '');
    const y = Number(context && context.y);
    const simpleInput = Boolean(context && context.simpleInput);
    if (/\b(?:pok[eé]dex|national(?:er)?\s+pok[eé]dex|nr\.?|no\.?)\s*[:#-]?\s*0*\d{1,4}\b/i.test(line)) {
      return null;
    }
    const number = cleanOcrDigits(numberValue).replace(/[^A-Z0-9]/g, '');
    const totalRaw = cleanOcrDigits(totalValue).replace(/[^A-Z0-9]/g, '');
    const numberMatch = number.match(/^([A-Z]{0,4})(\d{1,3})([A-Z]?)$/);
    const totalMatch = totalRaw.match(/^([A-Z]{0,4})(\d{1,3})$/);
    if (!numberMatch || !totalMatch) return null;
    const numberPrefix = numberMatch[1];
    const totalPrefix = totalMatch[1];
    if (numberPrefix && !pokemonCollectorPrefixes.has(numberPrefix)) return null;
    if (totalPrefix && !pokemonCollectorPrefixes.has(totalPrefix)) return null;
    if (numberPrefix && totalPrefix && numberPrefix !== totalPrefix) return null;
    if (!simpleInput && Number.isFinite(y)) {
      const minimumY = numberPrefix || totalPrefix ? 0.46 : 0.58;
      if (y < minimumY) return null;
    }
    const total = String(parseInt(totalMatch[2], 10));
    if (!total || Number(total) < 1 || Number(total) > 999) return null;
    const digits = numberPrefix
      ? numberMatch[2]
      : String(parseInt(numberMatch[2], 10));
    if (!digits || Number(numberMatch[2]) > 999) return null;
    return {
      number: numberPrefix + digits + numberMatch[3],
      total,
      prefix: numberPrefix || totalPrefix || ''
    };
  }

  function collectPasses(input) {
    if (typeof input === 'string') return [{variant: 'einfach', text: input, lines: []}];
    if (!input || typeof input !== 'object') return [];
    if (Array.isArray(input.passes) && input.passes.length) return input.passes;
    return [{variant: 'einfach', text: input.text || '', lines: input.lines || []}];
  }

  function addVote(map, key, value, weight) {
    if (!key) return;
    const current = map.get(key) || {value, votes: 0};
    current.votes += weight;
    if (String(value).length > String(current.value).length) current.value = value;
    map.set(key, current);
  }

  function derivePokemonIdentity(lines, hpVotes) {
    const speciesVotes = new Map();
    (lines || []).forEach(line => {
      const dedicatedHeader = /^kopfzeile-/.test(line.variant);
      if (!dedicatedHeader && line.y > 0.26) return;
      const match = bestKnownPokemonName(line.text, true);
      if (!match) return;
      const weight = dedicatedHeader
        ? match.exact ? 3.4 : 2.5
        : match.exact ? 2.25 : 1.35;
      const current = speciesVotes.get(match.id) || {
        match,
        votes: 0,
        exactVotes: 0,
        headerVotes: 0,
        variants: new Map(),
        source: line.variant
      };
      current.votes += weight * match.confidence;
      if (match.exact) current.exactVotes += weight;
      if (dedicatedHeader) current.headerVotes += weight;
      if (weight * match.confidence > (current.bestWeight || 0)) {
        current.match = match;
        current.bestWeight = weight * match.confidence;
        current.source = line.variant;
      }
      const variant = extractPokemonVariant(line.text);
      if (variant) current.variants.set(variant, (current.variants.get(variant) || 0) + weight);
      speciesVotes.set(match.id, current);
    });

    const ranked = [...speciesVotes.values()].sort((left, right) => right.votes - left.votes);
    if (!ranked.length) return {
      speciesId: 0,
      baseName: '',
      englishName: '',
      germanName: '',
      variant: '',
      hp: '',
      nameConfidence: 0,
      variantConfidence: 0,
      hpConfidence: 0,
      reliable: false,
      source: ''
    };
    const best = ranked[0];
    const secondVotes = ranked[1] ? ranked[1].votes : 0;
    const variantRanked = [...best.variants.entries()].sort((left, right) => right[1] - left[1]);
    const variant = variantRanked[0] ? variantRanked[0][0] : '';
    const variantVotes = variantRanked[0] ? variantRanked[0][1] : 0;
    const hpRanked = [...hpVotes.values()].sort((left, right) => right.votes - left.votes);
    const hp = hpRanked[0] ? hpRanked[0].value : '';
    const hpVoteCount = hpRanked[0] ? hpRanked[0].votes : 0;
    const margin = best.votes - secondVotes;
    const nameConfidence = clamp(
      (best.match.exact ? 0.84 : 0.72)
        + Math.min(0.13, best.votes * 0.018)
        + Math.min(0.05, Math.max(0, margin) * 0.012),
      0,
      0.99
    );
    const reliable = nameConfidence >= 0.88
      && (best.headerVotes >= 2.4 || best.exactVotes >= 2.2)
      && margin >= 0.8;
    return {
      speciesId: best.match.id,
      baseName: best.match.display,
      englishName: best.match.entry.en,
      germanName: best.match.entry.de,
      variant,
      hp,
      nameConfidence,
      variantConfidence: variant ? clamp(0.72 + variantVotes * 0.06, 0, 0.99) : 0,
      hpConfidence: hp ? clamp(0.62 + hpVoteCount * 0.07, 0, 0.99) : 0,
      reliable,
      source: best.source
    };
  }

  function extractHints(input) {
    const passes = collectPasses(input);
    const textPasses = [];
    const lineEntries = [];
    const collectorVotes = new Map();
    const setCodeVotes = new Map();
    const onePieceVotes = new Map();
    const hpVotes = new Map();

    passes.forEach((pass, passIndex) => {
      const text = String(pass.text || '').replace(/\r/g, '');
      if (text.trim()) textPasses.push(text);
      const lines = Array.isArray(pass.lines) && pass.lines.length
        ? pass.lines
        : text.split('\n').map((line, index, all) => ({
          text: line,
          y: index / Math.max(1, all.length)
        }));
      const seenLines = new Set();
      const normalizedLines = [];
      lines.forEach(rawLine => {
        const value = String(rawLine.text || '').replace(/\s+/g, ' ').trim();
        const key = norm(value);
        if (!value || seenLines.has(key)) return;
        seenLines.add(key);
        const rawY = Number.isFinite(Number(rawLine.y)) ? Number(rawLine.y) : 0.5;
        const variant = String(pass.variant || 'einfach');
        const entry = {
          text: value,
          y: /^kopfzeile-/.test(variant)
            ? rawY * 0.24
            : /^unterkante-/.test(variant)
              ? 0.80 + rawY * 0.20
              : rawY,
          pass: passIndex,
          variant
        };
        lineEntries.push(entry);
        normalizedLines.push(entry);
      });

      const seenCollectors = new Set();
      normalizedLines.forEach(line => {
        const collectorPattern = /\b([A-Z]{0,4}\s*-?\s*[0-9OIL|]{1,3}[A-Z]?)\s*[\/／]\s*([A-Z]{0,4}\s*-?\s*[0-9OIL|]{1,3})\b/gi;
        let collectorMatch;
        while ((collectorMatch = collectorPattern.exec(line.text)) !== null) {
          const collector = parsePokemonCollector(collectorMatch[1], collectorMatch[2], {
            text: line.text,
            y: line.y,
            simpleInput: line.variant === 'einfach'
          });
          if (!collector) continue;
          const key = numberKey(collector.number) + '/' + numberKey(collector.total);
          if (!seenCollectors.has(key)) {
            seenCollectors.add(key);
            const positionWeight = /^unterkante-/.test(line.variant)
              ? 1.95
              : line.variant === 'einfach'
                ? 1
                : line.y >= 0.78 ? 1.55 : 1.1;
            addVote(collectorVotes, key, collector, positionWeight);
          }
        }

        // Black-Star-Promos und ältere Serien tragen häufig nur eine präfixierte
        // Nummer ohne Nenner. Sie wird ausschließlich im unteren Kartenbereich
        // akzeptiert, damit Setcodes und Pokédex-Nummern nicht hineinrutschen.
        if (line.y >= 0.68 && !/pok[eé]dex|national|nr\.?\s*0*\d/i.test(line.text)) {
          const promoPattern = /\b((?:SWSH|SVP|HGSS|SM|XY|BW|DP|PR)\s*-?\s*[0-9OIL|]{1,3})\b/gi;
          let promoMatch;
          while ((promoMatch = promoPattern.exec(line.text)) !== null) {
            const promo = cleanOcrDigits(promoMatch[1]).replace(/[^A-Z0-9]/g, '');
            const parsed = promo.match(/^([A-Z]{1,4})(\d{1,3})$/);
            if (!parsed || !pokemonCollectorPrefixes.has(parsed[1])) continue;
            const item = {number: parsed[1] + parsed[2], total: '', prefix: parsed[1]};
            const key = numberKey(item.number) + '/';
            if (!seenCollectors.has(key)) {
              seenCollectors.add(key);
              addVote(collectorVotes, key, item, /^unterkante-/.test(line.variant) ? 1.8 : 1.2);
            }
          }
        }
      });

      normalizedLines.forEach(line => {
        const hpPattern = /\b(?:KP|HP)\s*([0-9OIL|]{2,3})\b/gi;
        let hpMatch;
        while ((hpMatch = hpPattern.exec(line.text)) !== null) {
          const hp = cleanOcrDigits(hpMatch[1]).replace(/\D/g, '');
          if (!hp || Number(hp) < 10 || Number(hp) > 500) continue;
          const weight = /^kopfzeile-/.test(line.variant)
            ? 2.4
            : line.y <= 0.26 ? 1.5 : 0.45;
          addVote(hpVotes, hp, hp, weight);
        }
      });

      const upper = text.toUpperCase();
      const setPattern = /\b((?:SV|SWSH|SM|XY|BW|HGSS|DP|PL|EX)[A-Z0-9-]{1,8})\b/g;
      let setMatch;
      while ((setMatch = setPattern.exec(upper)) !== null) {
        addVote(setCodeVotes, setMatch[1], setMatch[1], 1);
      }
      const onePiecePattern = /\b((?:(?:OP|ST|EB|PRB|EX|DON)\s*-?\s*\d{1,2}\s*-\s*\d{3})|(?:P\s*-\s*\d{3}))\b/g;
      let onePieceMatch;
      while ((onePieceMatch = onePiecePattern.exec(upper)) !== null) {
        let value = onePieceMatch[1].replace(/\s+/g, '');
        value = value.replace(/^((?:OP|ST|EB|PRB|EX|DON))(\d)-/, (_, prefix, number) => prefix + '0' + number + '-');
        addVote(onePieceVotes, value, value, 1);
      }
    });

    const lineVotes = new Map();
    lineEntries.forEach(line => {
      const containedHp = /\b(?:KP|HP)\s*[0-9OIL|]{2,3}\b/i.test(line.text);
      let value = line.text
        .replace(/\b(?:KP|HP)\s*[0-9OIL|]{2,3}\b/ig, '')
        .replace(/^(?:BASIS|BASIC|PHASE|STAGE)\s*\d*\s*/i, '')
        .trim();
      const normalized = norm(value);
      const letters = (value.match(/[\p{L}]/gu) || []).length;
      const digits = (value.match(/\d/g) || []).length;
      if (value.length < 2 || value.length > 48 || letters < 2 || digits > letters) return;
      if (bannedNameTerms.some(term => normalized.includes(norm(term)))) return;
      if (/^[A-Z0-9-]{5,}$/.test(value) || /\d+\s*[\/／]\s*\d+/.test(value)) return;
      if (/\b(?:pok[eé]dex|nr\.?|no\.?)\s*[:#-]?\s*0*\d{1,4}\b/i.test(value)) return;
      const positionBonus = line.y <= 0.23 ? 2.25 : line.y <= 0.33 ? 1.05 : line.y <= 0.44 ? 0.15 : -0.72;
      const headerBonus = /^kopfzeile-/.test(line.variant) ? 0.9 : 0;
      const hpBonus = containedHp && line.y <= 0.34 ? 0.65 : 0;
      const weight = 1 + positionBonus + headerBonus + hpBonus;
      if (weight > 0.2) addVote(lineVotes, normalized, value, weight);
    });

    const genericNameHints = [...lineVotes.values()]
      .sort((a, b) => b.votes - a.votes || a.value.length - b.value.length)
      .slice(0, 6)
      .map(entry => ({value: entry.value, votes: entry.votes}));
    const collectorNumbers = [...collectorVotes.values()]
      .sort((a, b) => b.votes - a.votes)
      .map(entry => ({...entry.value, votes: entry.votes}));
    const setCodes = [...setCodeVotes.values()]
      .sort((a, b) => b.votes - a.votes)
      .map(entry => ({value: entry.value, votes: entry.votes}));

    const completeText = textPasses.join('\n');
    const lower = completeText.toLocaleLowerCase();
    const rarityTerms = [
      'illustration rare', 'special illustration rare', 'hyper rare', 'ultra rare',
      'double rare', 'rare', 'uncommon', 'common', 'holo', 'promo',
      'selten', 'häufig', 'reverse holo'
    ].filter(term => lower.includes(term));
    const stageTerms = ['basic', 'basis', 'stage 1', 'stage 2', 'phase 1', 'phase 2']
      .filter(term => lower.includes(term));
    const artistMatch = completeText.match(/(?:illus(?:trator)?\.?|illustration)\s*[:.]?\s*([\p{L} .'-]{3,38})/iu);
    const pokemonIdentity = derivePokemonIdentity(lineEntries, hpVotes);
    const identityName = [pokemonIdentity.baseName, pokemonIdentity.variant].filter(Boolean).join(' ');
    const validatedNameHints = identityName ? [{
      value: identityName,
      baseName: pokemonIdentity.baseName,
      variant: pokemonIdentity.variant,
      speciesId: pokemonIdentity.speciesId,
      confidence: pokemonIdentity.nameConfidence,
      votes: pokemonIdentity.nameConfidence * 10,
      validated: true
    }] : [];
    const nameHints = validatedNameHints.concat(genericNameHints.filter(entry => {
      return !identityName || norm(entry.value) !== norm(identityName);
    })).slice(0, 6);

    return {
      rawText: completeText,
      lines: lineEntries,
      nameHint: nameHints[0] ? nameHints[0].value : '',
      nameHints,
      validatedNameHints,
      pokemonIdentity,
      collectorNumbers,
      pokemonNumber: collectorNumbers[0] ? collectorNumbers[0].number : '',
      pokemonTotal: collectorNumbers[0] ? collectorNumbers[0].total : '',
      pokemonSetCodes: setCodes,
      yugiohSetCode: findYuGiOhSetCode(completeText),
      onepieceId: onePieceVotes.size ? [...onePieceVotes.values()].sort((a, b) => b.votes - a.votes)[0].value : '',
      hp: pokemonIdentity.hp || (hpVotes.size ? [...hpVotes.values()].sort((a, b) => b.votes - a.votes)[0].value : ''),
      hpConfidence: pokemonIdentity.hpConfidence,
      rarityHints: rarityTerms,
      stageHints: stageTerms,
      artistHint: artistMatch ? artistMatch[1].trim() : ''
    };
  }

  function findYuGiOhSetCode(text) {
    const match = String(text || '').toUpperCase().match(
      /\b([A-Z0-9]{2,8}-(?:(?:DE|EN|FR|EU|IT|PT|SP|GE|AE)[A-Z]?)?\d{2,4})\b/
    );
    return match ? match[1] : '';
  }

  function classifyTcg(hints, selected) {
    if (selected && selected !== 'auto') return selected;
    const text = String(hints.rawText || '').toLocaleLowerCase();
    const scores = {pokemon: 0, yugioh: 0, onepiece: 0};
    if (hints.onepieceId) scores.onepiece += 9;
    if (/don!!|counter|leader|character|one piece/.test(text)) scores.onepiece += 3;
    if (hints.yugiohSetCode) scores.yugioh += 8;
    if (/\batk\b|\bdef\b|konami|spell card|trap card|zauberkarte|fallenkarte/.test(text)) scores.yugioh += 4;
    if (hints.collectorNumbers && hints.collectorNumbers.length) scores.pokemon += 4;
    if (/\b(?:kp|hp)\s*[0-9oil|]{2,3}\b|pokémon|pokemon|basis|basic|trainer|energie|energy/.test(text)) {
      scores.pokemon += 5;
    }
    return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0] || 'pokemon';
  }

  function bestNameSimilarity(hints, candidateName, manual) {
    const candidateIdentity = candidatePokemonIdentity(candidateName);
    const detectedIdentity = hints && hints.pokemonIdentity;
    const reliableDetectedName = detectedIdentity && detectedIdentity.speciesId
      && (detectedIdentity.reliable || Number(detectedIdentity.nameConfidence) >= 0.88);
    if (!manual && reliableDetectedName && candidateIdentity) {
      return detectedIdentity.speciesId === candidateIdentity.speciesId ? 1 : 0;
    }
    const manualMatch = manual ? bestKnownPokemonName(manual, true) : null;
    if (manualMatch && candidateIdentity) {
      return manualMatch.id === candidateIdentity.speciesId ? 1 : 0;
    }
    const values = manual
      ? [{value: manual, votes: 4}]
      : (hints.nameHints || []).length
        ? hints.nameHints
        : [{value: hints.nameHint || '', votes: 1}];
    return values.reduce((best, entry) => {
      const score = similarity(entry.value, candidateName) + Math.min(0.05, Math.max(0, entry.votes - 1) * 0.012);
      return Math.max(best, score);
    }, 0);
  }

  function scorePokemonCandidate(candidate, hints, manual) {
    const evidence = [];
    const candidateNumber = numberKey(candidate.number);
    const collectors = hints.collectorNumbers || [];
    const matchingCollector = candidateNumber
      ? collectors.find(item => numberKey(item.number) === candidateNumber)
      : null;
    const collectorStatus = matchingCollector
      ? 'match'
      : collectors.length && candidateNumber ? 'mismatch' : 'unknown';
    const nameScore = clamp(bestNameSimilarity(hints, candidate.name, manual), 0, 1);
    let score = nameScore * 0.46;
    if (nameScore >= 0.78) evidence.push('Name');
    const detectedVariant = normalizePokemonVariant(hints && hints.pokemonIdentity && hints.pokemonIdentity.variant);
    const candidateVariant = normalizePokemonVariant(extractPokemonVariant(candidate.name));
    const variantStatus = detectedVariant
      ? candidateVariant === detectedVariant ? 'match' : 'mismatch'
      : 'unknown';
    if (variantStatus === 'match') {
      score += 0.08;
      evidence.push('Variante');
    } else if (variantStatus === 'mismatch') {
      score -= 0.18;
      evidence.push('Variante abweichend');
    }

    const candidateTotals = [candidate.printedTotal, candidate.total, candidate.setTotal]
      .filter(Boolean)
      .map(numberKey);
    const setNumberMatches = Boolean(
      matchingCollector
      && matchingCollector.total
      && candidateTotals.includes(numberKey(matchingCollector.total))
    );
    if (collectorStatus === 'match') {
      score = 0.52 + nameScore * 0.16;
      evidence.push('Kartennummer');
      if (setNumberMatches) {
        score += 0.12;
        evidence.push('Setnummer');
      }
    } else if (collectorStatus === 'mismatch') {
      score -= 0.30;
      evidence.push('Kartennummer abweichend');
    }

    const setValues = [candidate.set, candidate.setId, candidate.series].filter(Boolean);
    const setScore = (hints.pokemonSetCodes || []).reduce((best, entry) => {
      return Math.max(best, ...setValues.map(value => similarity(entry.value, value)));
    }, 0);
    const setDetected = Boolean(
      ((hints.pokemonSetCodes || []).length && setValues.length)
      || (matchingCollector && matchingCollector.total && candidateTotals.length)
    );
    const setStatus = setNumberMatches || setScore >= 0.72
      ? 'match'
      : setDetected && setValues.length ? 'mismatch' : 'unknown';
    if (setScore >= 0.72) {
      score += 0.08 * setScore;
      evidence.push('Setcode');
    } else if (setStatus === 'mismatch') {
      score -= 0.08;
      evidence.push('Set abweichend');
    }

    const hpStatus = hints.hp && candidate.hp
      ? numberKey(hints.hp) === numberKey(candidate.hp) ? 'match' : 'mismatch'
      : 'unknown';
    if (hpStatus === 'match') {
      score += 0.09;
      evidence.push('KP/HP');
    } else if (hpStatus === 'mismatch') {
      score -= 0.12;
      evidence.push('KP/HP abweichend');
    }

    const rarityDetected = Boolean((hints.rarityHints || []).length);
    const rarityMatches = rarityDetected && candidate.rarity
      && hints.rarityHints.some(value => similarity(value, candidate.rarity) >= 0.72);
    const rarityStatus = rarityMatches ? 'match' : rarityDetected && candidate.rarity ? 'mismatch' : 'unknown';
    if (rarityMatches) {
      score += 0.025;
      evidence.push('Seltenheit');
    } else if (rarityStatus === 'mismatch') {
      score -= 0.025;
    }
    if (hints.stageHints && hints.stageHints.some(stage => {
      return (candidate.subtypes || []).some(subtype => similarity(stage, subtype) >= 0.68);
    })) {
      score += 0.02;
      evidence.push('Entwicklungsstufe');
    }
    if (hints.artistHint && candidate.artist && similarity(hints.artistHint, candidate.artist) >= 0.76) {
      score += 0.025;
      evidence.push('Illustrator');
    }

    // Kalibrierung vor dem Bildvergleich: Name allein ist nur eine Artbestimmung,
    // keine Identifikation der gedruckten Variante.
    if (collectorStatus === 'mismatch') {
      score = Math.min(score, 0.42);
    } else if (collectorStatus !== 'match') {
      score = Math.min(score, hpStatus === 'match' ? 0.63 : 0.54);
    } else {
      score = Math.min(score, 0.91);
    }
    if (variantStatus === 'mismatch') score = Math.min(score, 0.48);
    const confidence = clamp(score, 0, 0.99);
    return {
      ...candidate,
      confidence,
      textConfidence: confidence,
      evidence: Array.from(new Set(evidence)),
      matchDetails: {
        name: nameScore,
        variant: variantStatus,
        collector: collectorStatus,
        collectorDetected: collectors.map(item => item.number).filter(Boolean),
        set: setStatus,
        setScore,
        hp: hpStatus,
        rarity: rarityStatus,
        artwork: null,
        wholeImage: null,
        headerImage: null,
        footerImage: null,
        visualReliable: null
      }
    };
  }

  function combineVisualSimilarity(candidate, visualSimilarity) {
    const visualInput = visualSimilarity && typeof visualSimilarity === 'object'
      ? visualSimilarity
      : {similarity: visualSimilarity};
    const visual = Number(visualInput.similarity);
    if (!Number.isFinite(visual)) return {...candidate};
    const normalizedVisual = clamp(visual, 0, 1);
    const artwork = clamp(Number.isFinite(Number(visualInput.artwork))
      ? Number(visualInput.artwork) : normalizedVisual, 0, 1);
    const whole = clamp(Number.isFinite(Number(visualInput.whole))
      ? Number(visualInput.whole) : normalizedVisual, 0, 1);
    const header = clamp(Number.isFinite(Number(visualInput.header))
      ? Number(visualInput.header) : normalizedVisual, 0, 1);
    const footer = clamp(Number.isFinite(Number(visualInput.footer))
      ? Number(visualInput.footer) : normalizedVisual, 0, 1);
    const visualReliable = visualInput.reliable !== false;
    const textConfidence = clamp(
      Number.isFinite(Number(candidate.textConfidence))
        ? Number(candidate.textConfidence)
        : Number(candidate.confidence) || 0,
      0,
      0.99
    );
    const details = {...(candidate.matchDetails || {})};
    const collectorStatus = details.collector || 'unknown';
    const hpStatus = details.hp || 'unknown';
    const nameScore = Number(details.name) || 0;
    const setStatus = details.set || 'unknown';
    const reliabilityWeight = visualReliable ? 1 : 0.52;
    const strongVisual = artwork >= (visualReliable ? 0.82 : 0.89)
      && normalizedVisual >= (visualReliable ? 0.78 : 0.85);
    const severeArtworkMismatch = visualReliable && (artwork < 0.56 || normalizedVisual < 0.52);

    let score = textConfidence;
    score += ((normalizedVisual - 0.5) * 0.18 + (artwork - 0.5) * 0.28) * reliabilityWeight;
    if (strongVisual && nameScore >= 0.82) score += visualReliable ? 0.18 : 0.08;
    if (severeArtworkMismatch) score -= 0.18;
    if (setStatus === 'mismatch') score -= 0.12;
    if (hpStatus === 'mismatch') score -= 0.08;
    if (details.rarity === 'mismatch') score -= 0.03;

    if (collectorStatus === 'mismatch') {
      score -= 0.24;
      score = Math.min(score, strongVisual ? 0.59 : 0.47);
    } else if (collectorStatus !== 'match') {
      if (severeArtworkMismatch) {
        score = Math.min(score, 0.49);
      } else if (!strongVisual) {
        score = Math.min(score, hpStatus === 'match' ? 0.64 : 0.55);
      } else {
        score = Math.min(score, visualReliable ? 0.89 : 0.74);
      }
    } else if (severeArtworkMismatch) {
      score = Math.min(score, 0.74);
    }
    if (setStatus === 'mismatch') score = Math.min(score, 0.84);
    if (hpStatus === 'mismatch') score = Math.min(score, 0.86);

    // 80+ braucht exakte Nummer oder einen sehr starken, zuverlässigen
    // Bildtreffer plus passenden Namen. 90+/95+ erfordern mehrere unabhängige
    // Merkmale und bleiben damit praktisch eindeutigen Varianten vorbehalten.
    if (score >= 0.80 && !(collectorStatus === 'match' || (strongVisual && nameScore >= 0.82))) {
      score = 0.79;
    }
    if (score >= 0.90) {
      const strongSignals = (collectorStatus === 'match' ? 1 : 0)
        + (setStatus === 'match' ? 1 : 0)
        + (nameScore >= 0.88 ? 1 : 0)
        + (artwork >= 0.86 && visualReliable ? 1 : 0)
        + (hpStatus === 'match' ? 0.5 : 0);
      if (collectorStatus !== 'match' || strongSignals < 3) score = 0.89;
    }
    if (score >= 0.95 && !(
      collectorStatus === 'match'
      && setStatus === 'match'
      && nameScore >= 0.90
      && artwork >= 0.90
      && visualReliable
    )) {
      score = 0.94;
    }

    const confidence = clamp(score, 0, 0.99);
    const evidence = Array.from(new Set(candidate.evidence || []));
    if (artwork >= 0.76 && !evidence.includes('Artwork ähnlich')) {
      evidence.push('Artwork ähnlich');
    }
    if (severeArtworkMismatch && !evidence.includes('Artwork abweichend')) {
      evidence.push('Artwork abweichend');
    }
    return {
      ...candidate,
      confidence,
      textConfidence,
      visualSimilarity: normalizedVisual,
      visualResult: {
        similarity: normalizedVisual,
        artwork,
        whole,
        header,
        footer,
        reliable: visualReliable,
        method: String(visualInput.method || '')
      },
      evidence,
      matchDetails: {
        ...details,
        artwork,
        wholeImage: whole,
        headerImage: header,
        footerImage: footer,
        visualReliable
      }
    };
  }

  function rankPokemonCandidates(candidates, hints, manual, limit) {
    const ranked = candidates
      .map(candidate => scorePokemonCandidate(candidate, hints, manual || ''))
      .sort((a, b) => b.confidence - a.confidence);
    const maximum = Number.isFinite(Number(limit)) ? Math.max(1, Number(limit)) : 7;
    return ranked.slice(0, maximum);
  }

  /**
   * Stage A has already established identity. Stage B may only pass plausible
   * cards of that species/variant to the comparatively expensive image matcher.
   */
  function prefilterPokemonCandidates(candidates, hints, manual) {
    const input = Array.isArray(candidates) ? candidates : [];
    const detected = hints && hints.pokemonIdentity || {};
    const manualMatch = manual ? bestKnownPokemonName(manual, true) : null;
    const identity = manualMatch ? {
      speciesId: manualMatch.id,
      variant: extractPokemonVariant(manual),
      hp: hints && hints.hp || '',
      nameConfidence: manualMatch.confidence,
      variantConfidence: extractPokemonVariant(manual) ? 0.99 : 0,
      hpConfidence: hints && hints.hpConfidence || 0,
      reliable: manualMatch.confidence >= 0.86
    } : detected;
    let filtered = input.slice();
    const reliableName = Boolean(identity.speciesId)
      && (identity.reliable || Number(identity.nameConfidence) >= 0.88);

    if (reliableName) {
      filtered = filtered.filter(candidate => {
        const candidateIdentity = candidatePokemonIdentity(candidate.name);
        return candidateIdentity && candidateIdentity.speciesId === Number(identity.speciesId);
      });
      if (!filtered.length) return [];

      const detectedVariant = normalizePokemonVariant(identity.variant);
      if (detectedVariant && Number(identity.variantConfidence) >= 0.82) {
        const exactVariant = filtered.filter(candidate => {
          return normalizePokemonVariant(extractPokemonVariant(candidate.name)) === detectedVariant;
        });
        // A reliable V/VMAX/VSTAR/ex/GX marker is part of the card identity.
        if (!exactVariant.length) return [];
        filtered = exactVariant;
      }

      const detectedHp = numberKey(identity.hp || hints && hints.hp || '');
      if (detectedHp && Number(identity.hpConfidence || hints && hints.hpConfidence) >= 0.8) {
        const exactHp = filtered.filter(candidate => candidate.hp && numberKey(candidate.hp) === detectedHp);
        const unknownHp = filtered.filter(candidate => !candidate.hp);
        if (exactHp.length) filtered = exactHp.concat(unknownHp);
        else if (filtered.every(candidate => candidate.hp)) return [];
        else filtered = unknownHp;
      }
    }

    const collectors = hints && hints.collectorNumbers || [];
    const strongCollector = collectors.find(item => Number(item.votes) >= 1.5) || collectors[0];
    if (strongCollector) {
      const key = numberKey(strongCollector.number);
      const exactNumber = filtered.filter(candidate => numberKey(candidate.number) === key);
      if (exactNumber.length) filtered = exactNumber;
    }
    return filtered;
  }

  function isConfident(candidates) {
    if (!candidates || !candidates.length) return false;
    const best = candidates[0].confidence || 0;
    const second = candidates[1] ? candidates[1].confidence || 0 : 0;
    const details = candidates[0].matchDetails || {};
    const noVisualContradiction = details.artwork == null || details.visualReliable === false || details.artwork >= 0.62;
    return best >= 0.86 && noVisualContradiction && (!candidates[1] || best - second >= 0.12);
  }

  function hasPlausibleCandidate(candidates) {
    if (!candidates || !candidates.length) return false;
    const best = candidates[0];
    const details = best.matchDetails || {};
    return (best.confidence || 0) >= 0.58
      || details.collector === 'match'
      || (details.name >= 0.82 && details.artwork >= 0.78 && details.visualReliable !== false);
  }

  return {
    clamp,
    norm,
    similarity,
    bestKnownPokemonName,
    extractPokemonVariant,
    candidatePokemonIdentity,
    numberKey,
    parsePokemonCollector,
    extractHints,
    classifyTcg,
    scorePokemonCandidate,
    rankPokemonCandidates,
    prefilterPokemonCandidates,
    combineVisualSimilarity,
    isConfident,
    hasPlausibleCandidate
  };
});
