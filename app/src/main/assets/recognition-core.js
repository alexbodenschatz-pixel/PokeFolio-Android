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
  const OFFICIAL_VALIDATION_POLICY = Object.freeze({
    networkAccess: 'DISABLED',
    htmlScraping: false,
    imageMirroring: false,
    acceptedInput: 'AUTHORIZED_STRUCTURED_RECORD_ONLY'
  });
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

  function isEvolutionSourceText(value) {
    return /\b(?:entwickelt\s+sich\s+aus|entwickelt\s+aus|entwicklung\s+aus|evolves?\s+from|evolution\s+of)\b/i
      .test(String(value || ''));
  }

  /** Evolution-source labels describe the previous stage, never the printed card name. */
  function isEvolutionSourceNameLine(line, lines) {
    if (isEvolutionSourceText(line && line.text)) return true;
    const exactName = bestKnownPokemonName(line && line.text, false);
    if (!exactName) return false;
    return (lines || []).some(marker => {
      if (marker === line || marker.pass !== line.pass || !isEvolutionSourceText(marker.text)) return false;
      const distance = Number(line.y) - Number(marker.y);
      return distance >= -0.012 && distance <= 0.045;
    });
  }

  function detectCardLanguage(value) {
    const raw = String(value || '');
    const japanese = (raw.match(/[\u3040-\u30ff\u31f0-\u31ff]/g) || []).length;
    const korean = (raw.match(/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/g) || []).length;
    const han = (raw.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) || []).length;
    if (japanese >= 2) {
      return {value: 'ja', region: 'JP', script: 'Japanese', source: 'SCRIPT',
        confidence: clamp(0.78 + japanese * 0.015, 0, 0.98)};
    }
    if (korean >= 2) {
      return {value: 'ko', region: 'KR', script: 'Hangul', source: 'SCRIPT',
        confidence: clamp(0.78 + korean * 0.015, 0, 0.98)};
    }
    if (han >= 2) {
      const traditional = (raw.match(/[寶龍夢鬥學體來萬與為這個點畫無號裏國臺灣訓練師能量]/g) || []).length;
      const simplified = (raw.match(/[宝龙梦斗学体来万与为这个点画无号里国台湾训练师能量]/g) || []).length;
      const traditionalCardText = traditional > simplified;
      return {
        value: traditionalCardText ? 'zh-TW' : 'zh-CN',
        region: traditionalCardText ? 'TW/HK' : 'CN',
        script: 'Chinese',
        source: 'SCRIPT',
        confidence: clamp((traditional || simplified ? 0.80 : 0.66) + han * 0.008, 0, 0.96)
      };
    }
    const text = norm(value);
    const german = [
      'entwickelt sich', 'schaden', 'schwache', 'ruckzug', 'wirf eine munze',
      'deine pokemon', 'deinem gegner', 'deines gegners', 'diese karte', 'basis pokemon',
      'unterstutzerkarte', 'wahrend deines zuges', 'tausche 1 pokemon', 'basis energie'
    ].reduce((score, phrase) => score + (text.includes(phrase) ? 1 : 0), 0);
    const english = [
      'evolves from', 'damage', 'weakness', 'retreat', 'flip a coin',
      'your pokemon', 'your opponent', 'this card', 'basic pokemon'
    ].reduce((score, phrase) => score + (text.includes(phrase) ? 1 : 0), 0);
    if (!german && !english) return {value: '', region: '', script: 'Latin', source: 'UNRESOLVED', confidence: 0};
    if (german === english) return {value: '', region: '', script: 'Latin', source: 'UNRESOLVED', confidence: 0};
    const best = Math.max(german, english);
    return {
      value: german > english ? 'de' : 'en',
      region: german > english ? 'DE' : 'INTL',
      script: 'Latin',
      source: 'OCR_LANGUAGE_FEATURES',
      confidence: clamp(0.58 + best * 0.12 + Math.abs(german - english) * 0.05, 0, 0.96)
    };
  }

  function ocrRegion(pass, variant) {
    const explicit = String(pass && pass.region || '').toUpperCase();
    if (/^(?:WHOLE_CARD|TOP_HEADER|TOP_SECONDARY|ARTWORK|MIDDLE_TEXT|LOWER_TEXT|BOTTOM_METADATA)$/.test(explicit)) {
      return explicit;
    }
    if (/^kopfzeile-/.test(variant)) return 'TOP_HEADER';
    if (/^sekundaer-/.test(variant)) return 'TOP_SECONDARY';
    if (/^mitteltext-/.test(variant)) return 'MIDDLE_TEXT';
    if (/^untertext-/.test(variant)) return 'LOWER_TEXT';
    if (/^unterkante-/.test(variant)) return 'BOTTOM_METADATA';
    return 'WHOLE_CARD';
  }

  function mapRegionY(region, rawY) {
    if (region === 'TOP_HEADER') return rawY * 0.23;
    if (region === 'TOP_SECONDARY') return 0.11 + rawY * 0.20;
    if (region === 'MIDDLE_TEXT') return 0.34 + rawY * 0.44;
    if (region === 'LOWER_TEXT') return 0.67 + rawY * 0.21;
    if (region === 'BOTTOM_METADATA') return 0.80 + rawY * 0.20;
    return rawY;
  }

  function positionRegion(y) {
    if (y <= 0.23) return 'TOP_HEADER';
    if (y <= 0.34) return 'TOP_SECONDARY';
    if (y <= 0.58) return 'ARTWORK';
    if (y <= 0.76) return 'MIDDLE_TEXT';
    if (y <= 0.88) return 'LOWER_TEXT';
    return 'BOTTOM_METADATA';
  }

  function variantRotation(variant) {
    const match = String(variant || '').match(/-(0|90|180|270)$/);
    return match ? Number(match[1]) : 0;
  }

  function deriveDominantRotation(lines) {
    const scores = new Map([[0, 0], [90, 0], [180, 0], [270, 0]]);
    (lines || []).forEach(line => {
      const letters = (String(line.text || '').match(/[\p{L}]/gu) || []).length;
      if (!letters) return;
      let score = Math.min(letters, 42) * (line.region === 'WHOLE_CARD' ? 0.14 : 0.055);
      if (line.region === 'TOP_HEADER' && /\b(?:KP|HP)\s*[0-9OIL|]{2,3}\b/i.test(line.text)) score += 4;
      if (line.region === 'BOTTOM_METADATA' && /[0-9OIL|SB]{1,3}\s*[\/／]\s*[0-9OIL|SB]{1,3}/i.test(line.text)) score += 4;
      if (line.region === 'TOP_HEADER' && isPokemonCardHeaderLabel(line.text)) score += 2;
      scores.set(line.rotation, (scores.get(line.rotation) || 0) + score);
    });
    return [...scores.entries()].sort((left, right) => right[1] - left[1])[0][0];
  }

  function extractAttackFeatures(lines) {
    const attackVotes = new Map();
    const damageVotes = new Map();
    (lines || []).forEach(line => {
      if (line.y < 0.24 || line.y > 0.78 || isEvolutionSourceText(line.text)) return;
      if (/\b(?:KP|HP|pok[eé]dex|schw[aä]che|weakness|resistenz|resistance|r[uü]ckzug|retreat|illus)\b/i.test(line.text)) {
        return;
      }
      if (/[0-9OIL|]{1,3}\s*[\/／]\s*[0-9OIL|]{1,3}/i.test(line.text)) return;
      const damageMatch = String(line.text).match(/(?:^|\s)([0-9OIL|]{1,3})([+x×-]?)(?=\s*$)/i);
      let attackName = damageMatch
        ? String(line.text).slice(0, damageMatch.index).trim()
        : String(line.text).trim();
      attackName = attackName
        .replace(/^[^\p{L}]+/gu, '')
        .replace(/[^\p{L}'’ -]+$/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
      const letters = (attackName.match(/[\p{L}]/gu) || []).length;
      const words = attackName.split(/\s+/).filter(Boolean);
      const looksLikeShortLabel = letters >= 3 && attackName.length <= 34 && words.length <= 5
        && !/[.!?:;]/.test(attackName)
        && !bannedNameTerms.some(term => norm(attackName).includes(norm(term)));
      const passWeight = /^karte-kontrast-|^vollbild-/.test(line.variant) ? 1 : 0.72;
      if (looksLikeShortLabel && (damageMatch || words.length <= 3)) {
        addVote(attackVotes, norm(attackName), attackName, (damageMatch ? 1.55 : 0.62) * passWeight);
      }
      if (damageMatch) {
        const digits = cleanOcrDigits(damageMatch[1]).replace(/\D/g, '');
        if (digits && Number(digits) >= 10 && Number(digits) <= 500) {
          const damage = String(Number(digits)) + String(damageMatch[2] || '').toUpperCase().replace('×', 'X');
          addVote(damageVotes, damage, damage, 1.2 * passWeight);
        }
      }
    });
    return {
      attacks: [...attackVotes.values()]
        .sort((left, right) => right.votes - left.votes)
        .slice(0, 6),
      damages: [...damageVotes.values()]
        .sort((left, right) => right.votes - left.votes)
        .slice(0, 6)
    };
  }

  function cleanOcrDigits(value) {
    const compact = String(value || '').toUpperCase().replace(/[\s_]/g, '');
    if (!/\d/.test(compact)) return '';
    return compact.replace(/O/g, '0').replace(/[IL|]/g, '1');
  }

  function normalizeCollectorOcrToken(value) {
    const compact = String(value || '').toUpperCase().replace(/[^A-Z0-9|]/g, '');
    if (!compact) return '';
    const knownPrefix = [...pokemonCollectorPrefixes]
      .sort((left, right) => right.length - left.length)
      .find(prefix => compact.startsWith(prefix) && compact.length > prefix.length);
    const prefix = knownPrefix || '';
    const numeric = compact.slice(prefix.length);
    if (!/[0-9OIL|SB]/.test(numeric)) return '';
    return prefix + numeric
      .replace(/O/g, '0')
      .replace(/[IL|]/g, '1')
      .replace(/S/g, '5')
      .replace(/B/g, '8');
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
    const number = normalizeCollectorOcrToken(numberValue);
    const totalRaw = normalizeCollectorOcrToken(totalValue);
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

  function derivePokemonIdentity(lines, hpVotes, dominantRotation) {
    const speciesVotes = new Map();
    (lines || []).forEach(line => {
      if (Number.isFinite(Number(dominantRotation)) && line.rotation !== dominantRotation) return;
      const dedicatedHeader = line.region === 'TOP_HEADER';
      if (!dedicatedHeader && line.y > 0.26) return;
      if (isEvolutionSourceNameLine(line, lines)) return;
      const match = bestKnownPokemonName(line.text, true);
      if (!match) return;
      const containsHp = /\b(?:KP|HP)\s*[0-9OIL|]{2,3}\b/i.test(line.text);
      const titlePosition = line.y <= 0.11 ? 1.2 : line.y <= 0.16 ? 0.35 : -0.45;
      const weight = (dedicatedHeader
        ? match.exact ? 3.4 : 2.5
        : match.exact ? 2.25 : 1.35) + titlePosition + (containsHp ? 0.7 : 0);
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

  function normalizedPokemonCardType(value) {
    const text = norm(value);
    if (!text) return 'unknown';
    if (/trainer|unterstutzer|supporter|item|stadion|stadium|ausrustung|tool/.test(text)) return 'trainer';
    if (/energie|energy/.test(text)) return 'energy';
    if (/pokemon|pok mon/.test(text)) return 'pokemon';
    return 'unknown';
  }

  /** Determines the printed Pokemon TCG card class before interpreting header text. */
  function derivePokemonCardType(lines, completeText, pokemonIdentity, hpVotes, dominantRotation) {
    let trainer = 0;
    let energy = 0;
    let pokemon = 0;
    (lines || []).forEach(line => {
      if (Number.isFinite(Number(dominantRotation)) && line.rotation !== dominantRotation) return;
      const value = norm(line.text);
      const header = line.y <= 0.27 || line.region === 'TOP_HEADER';
      if (/\btrainer\b/.test(value)) trainer += header ? 5 : 2;
      if (/unterstutzer(?:karte)?|supporter|itemkarte|stadion|stadium|pokemon ausrustung|tool card/.test(value)) {
        trainer += header ? 4 : 2.5;
      }
      if (/basis energie|basic energy|spezial energie|special energy|energiekarte|energy card/.test(value)) {
        energy += header ? 6 : 3;
      } else if (/\b(?:energie|energy)\b/.test(value)) {
        energy += header ? 3.5 : 0.45;
      }
      if (/\b(?:kp|hp)\s*[0-9oil|]{2,3}\b/.test(value)) pokemon += header ? 5 : 2;
      if (/\b(?:basis|basic|phase [12]|stage [12])\b/.test(value)) pokemon += header ? 2.5 : 0.5;
    });
    if (pokemonIdentity && pokemonIdentity.speciesId) pokemon += pokemonIdentity.reliable ? 6 : 3;
    if (hpVotes && hpVotes.size) pokemon += 3;
    const complete = norm(completeText);
    if (/du kannst wahrend deines zuges nur 1 unterstutzerkarte spielen/.test(complete)) trainer += 5;
    if (/lege diese karte an 1 deiner pokemon an|itemkarte|stadion im spiel/.test(complete)) trainer += 2;
    if (/basis energie|basic energy|spezial energie|special energy/.test(complete)) energy += 4;
    const ranked = [
      {value: 'trainer', score: trainer},
      {value: 'energy', score: energy},
      {value: 'pokemon', score: pokemon}
    ].sort((left, right) => right.score - left.score);
    const best = ranked[0];
    const second = ranked[1];
    if (!best || best.score < 2.5 || best.score - second.score < 0.75) {
      return {value: 'unknown', confidence: best ? clamp(best.score / 10, 0, 0.64) : 0};
    }
    return {
      value: best.value,
      confidence: clamp(0.66 + best.score * 0.035 + (best.score - second.score) * 0.025, 0, 0.99)
    };
  }

  function isPokemonCardHeaderLabel(value) {
    const text = norm(value);
    return /^(?:trainer|unterstutzer(?:karte)?|supporter|item(?:karte)?|stadion|stadium|pokemon ausrustung|tool(?: card)?|energie|energy|basis energie|basic energy|spezial energie|special energy)$/.test(text);
  }

  function splitTrainerTitleAndAdditionalName(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return {title: '', additional: ''};
    // Some OCR engines merge the left-aligned title and the right-aligned
    // character subtitle into one line. Preserve the printed card title.
    const knownStructuredTitle = text.match(/^(Befehl\s+vom\s+Boss)(?:\s*[-–—:]\s*|\s+)(.+)$/i);
    if (knownStructuredTitle) {
      return {title: knownStructuredTitle[1], additional: knownStructuredTitle[2].trim()};
    }
    const englishStructuredTitle = text.match(/^(Boss['’]s\s+Orders)(?:\s*[-–—:]\s*|\s+)(.+)$/i);
    if (englishStructuredTitle) {
      return {title: englishStructuredTitle[1], additional: englishStructuredTitle[2].trim()};
    }
    return {title: text, additional: ''};
  }

  function isLikelyTrainerAdditionalName(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    const normalized = norm(text);
    const words = normalized.split(' ').filter(Boolean);
    if (!normalized || text.length > 30 || words.length > 3) return false;
    if ((text.match(/[\p{L}]/gu) || []).length < 2) return false;
    if (normalized.replace(/\s/g, '').length >= 6
      && new Set(normalized.replace(/\s/g, '')).size <= 2) return false;
    for (let size = 2; size <= Math.floor(normalized.length / 2); size++) {
      if (normalized.length % size === 0
        && normalized.slice(0, size).repeat(normalized.length / size) === normalized) return false;
    }
    if (/(?:illus|illustr|l{2,3}ustr|spielen|karte|pokemon|energie|energy|copyright|nintendo|creatures|game freak|wahrend|zuges|schaden|damage)/.test(normalized)) {
      return false;
    }
    return !['trainer', 'unterstutzer', 'supporter', 'item', 'stadion']
      .some(label => similarity(words[0], label) >= 0.72);
  }

  /** Sentences from the rule box must never become a Trainer/Energy card title. */
  function isRuleTextLikeTitle(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    const normalized = norm(text);
    const words = normalized.split(' ').filter(Boolean);
    if (!normalized) return true;
    if (words.length > 6 || text.length > 46 || /[.!?;:]$/.test(text)) return true;
    if (/^(?:du|dein(?:e|er|em|en|es)?|diese|dieser|wenn|falls|solange|wahrend|lege|ziehe|wirf|durchsuche|tausche|wahle|you|your|this|during|when|if|choose|draw|search|put|attach|discard)\b/.test(normalized)) {
      return true;
    }
    return /\b(?:wahrend deines zuges|nur [0-9a-z]+ mal|deines gegners|dein deck|diese karte|diesen effekt|you may|during your turn|your opponent|this card|search your deck)\b/.test(normalized);
  }

  function deriveNonPokemonTitle(lines, cardType, dominantRotation) {
    if (cardType !== 'trainer' && cardType !== 'energy') {
      return {title: '', confidence: 0, source: '', ignoredAdditionalNames: []};
    }
    const votes = new Map();
    const additional = new Map();
    const structuredAdditionalKeys = new Set();
    (lines || []).forEach(line => {
      if (Number.isFinite(Number(dominantRotation)) && line.rotation !== dominantRotation) return;
      const directHeader = line.region === 'TOP_HEADER';
      if (!directHeader && (line.region !== 'WHOLE_CARD' || line.y > 0.20)) return;
      let value = String(line.text || '')
        .replace(/\b(?:KP|HP)\s*[0-9OIL|]{2,3}\b/ig, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!value || isPokemonCardHeaderLabel(value)) return;
      if (/\d{1,3}\s*[\/／]\s*\d{1,3}/.test(value)) return;
      if ((value.match(/[\p{L}]/gu) || []).length < 2 || value.length > 54) return;
      const split = cardType === 'trainer'
        ? splitTrainerTitleAndAdditionalName(value)
        : {title: value, additional: ''};
      value = split.title;
      if (isRuleTextLikeTitle(value)) return;
      if (split.additional) {
        const key = norm(split.additional);
        structuredAdditionalKeys.add(key);
        addVote(additional, key, split.additional, 3);
      }
      const normalized = norm(value);
      if (!normalized || bannedNameTerms.some(term => normalized === norm(term))) return;
      const x = Number(line.x) || 0;
      const width = Number(line.w) || 0;
      const words = normalized.split(' ').filter(Boolean).length;
      const dedicated = directHeader;
      const position = line.y <= 0.13 ? 2.2 : line.y <= 0.19 ? 1.05 : 0.25;
      const leftAligned = x <= 0.34 ? 1.15 : x >= 0.62 ? -2.2 : 0;
      const coverage = width >= 0.24 ? 0.8 : width > 0 ? -0.1 : 0;
      const phrase = words >= 2 ? 1.1 : 0;
      const energyMarker = cardType === 'energy' && /energie|energy/i.test(value) ? 2.2 : 0;
      const weight = 1 + position + leftAligned + coverage + phrase + energyMarker + (dedicated ? 1.15 : 0);
      if (weight > 0.35) {
        addVote(votes, normalized, {text: value, source: line.variant, x, width}, weight);
        const vote = votes.get(normalized);
        if (!vote.families) vote.families = new Set();
        vote.families.add(dedicated ? 'TOP_HEADER' : 'WHOLE_CARD');
        vote.headerConfirmed = Boolean(vote.headerConfirmed || dedicated);
      }
      if (cardType === 'trainer' && x >= 0.62 && words <= 3 && value.length <= 28) {
        addVote(additional, normalized, value, Math.max(1, weight + 2.2));
      }
    });
    const ranked = [...votes.values()].sort((left, right) => right.votes - left.votes);
    if (!ranked.length) return {title: '', confidence: 0, source: '', ignoredAdditionalNames: []};
    const best = ranked[0];
    const bestText = best.value && best.value.text || '';
    const bestKey = norm(bestText);
    const secondVotes = ranked[1] ? ranked[1].votes : 0;
    const consensus = best.families && best.families.size >= 2;
    ranked.slice(1).forEach(entry => {
      const item = entry.value || {};
      const itemText = item.text || '';
      if (!itemText || norm(itemText) === bestKey) return;
      if (cardType === 'trainer' && (Number(item.x) >= 0.58 || norm(itemText).split(' ').length <= 2)) {
        addVote(additional, norm(itemText), itemText, entry.votes);
      }
    });
    additional.delete(bestKey);
    const titleRows = (lines || []).filter(line => {
      const split = cardType === 'trainer'
        ? splitTrainerTitleAndAdditionalName(line.text)
        : {title: line.text};
      return norm(split.title) === bestKey;
    });
    const contextualAdditionalKeys = new Set(structuredAdditionalKeys);
    (lines || []).forEach(line => {
      const key = norm(line.text);
      if (!key || key === bestKey || Number(line.x) < 0.58 || !isLikelyTrainerAdditionalName(line.text)) return;
      const alongsideTitle = titleRows.some(titleLine => {
        return titleLine.pass === line.pass && Math.abs(Number(titleLine.y) - Number(line.y)) <= 0.065;
      });
      if (alongsideTitle) contextualAdditionalKeys.add(key);
    });
    return {
      title: bestText,
      confidence: clamp(0.68 + best.votes * 0.035
        + Math.max(0, best.votes - secondVotes) * 0.018
        + (consensus ? 0.08 : 0), 0, 0.99),
      source: consensus ? 'OCR_CONSENSUS' : 'TOP_HEADER',
      sourceVariant: best.value && best.value.source || '',
      consensusPasses: best.families ? best.families.size : 1,
      ignoredAdditionalNames: [...additional.values()]
        .sort((left, right) => right.votes - left.votes)
        .map(entry => entry.value)
        .filter(value => norm(value) !== bestKey
          && contextualAdditionalKeys.has(norm(value))
          && isLikelyTrainerAdditionalName(value))
        .slice(0, 5)
    };
  }

  function extractRuleTextHints(lines, cardType) {
    if (cardType !== 'trainer' && cardType !== 'energy') return [];
    const votes = new Map();
    (lines || []).forEach(line => {
      if (line.y < 0.25 || line.y > 0.84 || isPokemonCardHeaderLabel(line.text)) return;
      const value = String(line.text || '').replace(/\s+/g, ' ').trim();
      const letters = (value.match(/[\p{L}]/gu) || []).length;
      if (letters < 8 || value.length < 12 || value.length > 180) return;
      if (/illus|copyright|\d{1,3}\s*[\/／]\s*\d{1,3}/i.test(value)) return;
      addVote(votes, norm(value), value, /^karte-|^vollbild-/.test(line.variant) ? 1.2 : 0.8);
    });
    return [...votes.values()]
      .sort((left, right) => right.votes - left.votes)
      .slice(0, 6)
      .map(entry => ({value: entry.value, votes: entry.votes}));
  }

  function extractEvolutionSource(lines, dominantRotation) {
    const candidates = [];
    (lines || []).forEach(line => {
      if (Number.isFinite(Number(dominantRotation)) && line.rotation !== dominantRotation) return;
      const match = String(line.text || '').match(
        /(?:entwickelt\s+sich\s+aus|entwickelt\s+aus|entwicklung\s+aus|evolves?\s+from|evolution\s+of)\s+([\p{L}.'’♀♂ -]{2,34})/iu
      );
      if (!match) return;
      const known = bestKnownPokemonName(match[1], true);
      if (known) candidates.push({value: known.display, speciesId: known.id, confidence: known.confidence});
    });
    return candidates.sort((left, right) => right.confidence - left.confidence)[0] || null;
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
        const region = ocrRegion(pass, variant);
        const mappedY = mapRegionY(region, rawY);
        const entry = {
          text: value,
          y: mappedY,
          rawY,
          pass: passIndex,
          variant,
          region,
          positionRegion: region === 'WHOLE_CARD' ? positionRegion(mappedY) : region,
          rotation: variantRotation(variant),
          x: Number.isFinite(Number(rawLine.x)) ? Number(rawLine.x) : 0,
          w: Number.isFinite(Number(rawLine.w)) ? Number(rawLine.w) : 0
        };
        lineEntries.push(entry);
        normalizedLines.push(entry);
      });

      const seenCollectors = new Set();
      normalizedLines.forEach(line => {
        const collectorPattern = /\b([A-Z]{0,4}\s*-?\s*[0-9OIL|SB]{1,3}[A-Z]?)\s*[\/／]\s*([A-Z]{0,4}\s*-?\s*[0-9OIL|SB]{1,3})\b/gi;
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
            const positionWeight = line.region === 'BOTTOM_METADATA'
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
          const promoPattern = /\b((?:SWSH|SVP|HGSS|SM|XY|BW|DP|PR)\s*-?\s*[0-9OIL|SB]{1,3})\b/gi;
          let promoMatch;
          while ((promoMatch = promoPattern.exec(line.text)) !== null) {
            const promo = normalizeCollectorOcrToken(promoMatch[1]);
            const parsed = promo.match(/^([A-Z]{1,4})(\d{1,3})$/);
            if (!parsed || !pokemonCollectorPrefixes.has(parsed[1])) continue;
            const item = {number: parsed[1] + parsed[2], total: '', prefix: parsed[1]};
            const key = numberKey(item.number) + '/';
            if (!seenCollectors.has(key)) {
              seenCollectors.add(key);
              addVote(collectorVotes, key, item, line.region === 'BOTTOM_METADATA' ? 1.8 : 1.2);
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
          const weight = line.region === 'TOP_HEADER'
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

    const dominantRotation = deriveDominantRotation(lineEntries);
    const activeLines = lineEntries.filter(line => line.rotation === dominantRotation);
    const lineVotes = new Map();
    lineEntries.forEach(line => {
      if (line.rotation !== dominantRotation) return;
      if (isEvolutionSourceNameLine(line, lineEntries) || isRuleTextLikeTitle(line.text)) return;
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
      const headerBonus = line.region === 'TOP_HEADER' ? 0.9 : 0;
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
    const orientedText = activeLines.map(line => line.text).join('\n') || completeText;
    const lower = completeText.toLocaleLowerCase();
    const rarityTerms = [
      'illustration rare', 'special illustration rare', 'hyper rare', 'ultra rare',
      'double rare', 'rare', 'uncommon', 'common', 'holo', 'promo',
      'selten', 'häufig', 'reverse holo'
    ].filter(term => lower.includes(term));
    const stageTerms = ['basic', 'basis', 'stage 1', 'stage 2', 'phase 1', 'phase 2']
      .filter(term => lower.includes(term));
    const artistMatch = completeText.match(/(?:illus(?:trator)?\.?|illustration)\s*[:.]?\s*([\p{L} .'-]{3,38})/iu);
    const pokemonIdentity = derivePokemonIdentity(lineEntries, hpVotes, dominantRotation);
    const cardTypeResult = derivePokemonCardType(
      lineEntries, orientedText, pokemonIdentity, hpVotes, dominantRotation
    );
    const nonPokemonTitle = deriveNonPokemonTitle(lineEntries, cardTypeResult.value, dominantRotation);
    const evolvesFrom = extractEvolutionSource(lineEntries, dominantRotation);
    const attackFeatures = extractAttackFeatures(activeLines);
    const ruleTextHints = extractRuleTextHints(activeLines, cardTypeResult.value);
    const detectedLanguage = detectCardLanguage(orientedText);
    const requestedLanguage = String(input && input.language || '');
    if (!detectedLanguage.value && /^(?:ja|ko|zh-CN|zh-TW)$/i.test(requestedLanguage)) {
      detectedLanguage.value = /^zh-tw$/i.test(requestedLanguage)
        ? 'zh-TW'
        : /^zh-cn$/i.test(requestedLanguage) ? 'zh-CN' : requestedLanguage.toLowerCase();
      detectedLanguage.confidence = 0.58;
      detectedLanguage.script = detectedLanguage.value === 'ja' ? 'Japanese'
        : detectedLanguage.value === 'ko' ? 'Hangul' : 'Chinese';
      detectedLanguage.region = detectedLanguage.value === 'ja' ? 'JP'
        : detectedLanguage.value === 'ko' ? 'KR'
          : detectedLanguage.value === 'zh-TW' ? 'TW/HK' : 'CN';
      detectedLanguage.source = 'USER_LANGUAGE_HINT';
    } else if (!detectedLanguage.value && /^(?:de|en)$/i.test(requestedLanguage)) {
      detectedLanguage.value = requestedLanguage.toLowerCase();
      detectedLanguage.region = detectedLanguage.value === 'de' ? 'DE' : 'INTL';
      detectedLanguage.script = 'Latin';
      detectedLanguage.source = 'USER_LANGUAGE_HINT';
      detectedLanguage.confidence = 0.46;
    }
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
    const primaryTitleHints = nonPokemonTitle.title ? [{
      value: nonPokemonTitle.title,
      votes: nonPokemonTitle.confidence * 10,
      confidence: nonPokemonTitle.confidence,
      validated: true,
      cardType: cardTypeResult.value
    }] : [];
    const primaryHints = cardTypeResult.value === 'pokemon' ? validatedNameHints : primaryTitleHints;
    const primaryName = primaryHints[0] && primaryHints[0].value || identityName;
    const ignoredAdditionalKeys = new Set(nonPokemonTitle.ignoredAdditionalNames.map(norm));
    const nameHints = primaryHints.concat(genericNameHints.filter(entry => {
      const key = norm(entry.value);
      return (!primaryName || key !== norm(primaryName)) && !ignoredAdditionalKeys.has(key);
    })).slice(0, 6);

    return {
      rawText: completeText,
      lines: lineEntries,
      cardType: cardTypeResult.value,
      cardTypeConfidence: cardTypeResult.confidence,
      mainTitle: nonPokemonTitle.title || identityName,
      titleConfidence: nonPokemonTitle.title ? nonPokemonTitle.confidence : pokemonIdentity.nameConfidence,
      titleSource: nonPokemonTitle.title ? nonPokemonTitle.source
        : /^kopfzeile-/.test(pokemonIdentity.source) ? 'TOP_HEADER' : pokemonIdentity.source,
      titleSourceVariant: nonPokemonTitle.title ? nonPokemonTitle.sourceVariant : pokemonIdentity.source,
      titleConsensusPasses: nonPokemonTitle.title ? nonPokemonTitle.consensusPasses || 1 : 1,
      ignoredAdditionalNames: nonPokemonTitle.ignoredAdditionalNames,
      evolvesFrom: evolvesFrom && evolvesFrom.value || '',
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
      attackHints: attackFeatures.attacks,
      damageValues: attackFeatures.damages,
      ruleTextHints,
      language: detectedLanguage.value,
      languageConfidence: detectedLanguage.confidence,
      languageSource: detectedLanguage.source || '',
      script: detectedLanguage.script || 'Unknown',
      region: detectedLanguage.region || '',
      dominantRotation,
      ocrByRegion: {
        whole: lineEntries.filter(line => line.rotation === dominantRotation && line.region === 'WHOLE_CARD')
          .map(line => line.text).join('\n'),
        top: lineEntries.filter(line => line.rotation === dominantRotation && line.region === 'TOP_HEADER')
          .map(line => line.text).join('\n'),
        bottom: lineEntries.filter(line => line.rotation === dominantRotation && line.region === 'BOTTOM_METADATA')
          .map(line => line.text).join('\n'),
        middle: lineEntries.filter(line => line.rotation === dominantRotation && line.region === 'MIDDLE_TEXT')
          .map(line => line.text).join('\n')
      },
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

  function damageKey(value) {
    const cleaned = cleanOcrDigits(value).toUpperCase().replace(/×/g, 'X');
    const match = cleaned.match(/([0-9]{1,3})\s*([+X-]?)/);
    return match ? String(Number(match[1])) + (match[2] || '') : '';
  }

  function candidateAttackData(candidate) {
    const attacks = Array.isArray(candidate && candidate.attacks) ? candidate.attacks : [];
    return {
      names: attacks.map(attack => typeof attack === 'string' ? attack : attack && attack.name)
        .map(value => String(value || '').trim()).filter(Boolean),
      damages: attacks.map(attack => typeof attack === 'object' && attack ? attack.damage : '')
        .map(damageKey).filter(Boolean)
    };
  }

  function scoreAttackFeatures(candidate, hints) {
    const detectedAttacks = hints && hints.attackHints || [];
    const detectedDamages = hints && hints.damageValues || [];
    const candidateData = candidateAttackData(candidate);
    let attackScore = 0;
    let attackMatches = 0;
    detectedAttacks.slice(0, 5).forEach(detected => {
      const best = candidateData.names.reduce(
        (current, candidateName) => Math.max(current, similarity(detected.value, candidateName)),
        0
      );
      attackScore = Math.max(attackScore, best);
      if (best >= 0.78) attackMatches++;
    });
    const attackReliable = detectedAttacks.some(item => Number(item.votes) >= 1.15);
    const attackStatus = attackScore >= 0.78
      ? 'match'
      : attackReliable && candidateData.names.length && attackScore < 0.48 ? 'mismatch' : 'unknown';

    const detectedDamageKeys = detectedDamages.map(item => damageKey(item.value)).filter(Boolean);
    const damageMatches = detectedDamageKeys.filter(value => candidateData.damages.includes(value)).length;
    const damageReliable = detectedDamages.some(item => Number(item.votes) >= 1.1);
    const damageStatus = damageMatches
      ? 'match'
      : damageReliable && candidateData.damages.length ? 'mismatch' : 'unknown';
    return {attackScore, attackMatches, attackStatus, damageMatches, damageStatus};
  }

  function scoreFromSignals(signals) {
    let observedWeight = 0;
    let matchedWeight = 0;
    let mismatchPenalty = 0;
    signals.forEach(signal => {
      if (!signal || signal.status === 'unknown') return;
      const weight = Number(signal.weight) || 0;
      observedWeight += weight;
      if (signal.status === 'match') {
        matchedWeight += weight * clamp(
          Number.isFinite(Number(signal.value)) ? Number(signal.value) : 1,
          0,
          1
        );
      } else if (signal.status === 'mismatch') {
        mismatchPenalty += Number(signal.penalty == null ? weight : signal.penalty);
      }
    });
    if (!observedWeight) return 0;
    return clamp(matchedWeight / observedWeight - mismatchPenalty, 0, 0.99);
  }

  function dataCoverage(signals) {
    const total = signals.reduce((sum, signal) => sum + (Number(signal && signal.weight) || 0), 0);
    if (!total) return 0;
    const observed = signals.reduce((sum, signal) => {
      if (!signal || signal.status === 'unknown') return sum;
      const reliability = clamp(
        Number.isFinite(Number(signal.reliability)) ? Number(signal.reliability) : 1,
        0.15,
        1
      );
      return sum + (Number(signal.weight) || 0) * reliability;
    }, 0);
    return clamp(observed / total, 0, 1);
  }

  function initialFinalConfidence(identificationScore, dataConfidence) {
    return clamp(identificationScore * 0.94 + dataConfidence * 0.06, 0, 0.99);
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
    if (nameScore >= 0.78) evidence.push('Name');
    const detectedVariant = normalizePokemonVariant(hints && hints.pokemonIdentity && hints.pokemonIdentity.variant);
    const candidateVariant = normalizePokemonVariant(extractPokemonVariant(candidate.name));
    const variantStatus = detectedVariant
      ? candidateVariant === detectedVariant ? 'match' : 'mismatch'
      : 'unknown';
    if (variantStatus === 'match') {
      evidence.push('Variante');
    } else if (variantStatus === 'mismatch') {
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
    const setNumberStatus = matchingCollector && matchingCollector.total && candidateTotals.length
      ? setNumberMatches ? 'match' : 'mismatch'
      : 'unknown';
    if (collectorStatus === 'match') {
      evidence.push('Kartennummer');
      if (setNumberMatches) {
        evidence.push('Setnummer');
      } else if (setNumberStatus === 'mismatch') {
        evidence.push('Setnummer abweichend');
      }
    } else if (collectorStatus === 'mismatch') {
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
    const setStatus = setNumberStatus === 'match' || setScore >= 0.72
      ? 'match'
      : setNumberStatus === 'mismatch' || setDetected && setValues.length ? 'mismatch' : 'unknown';
    if (setScore >= 0.72) {
      evidence.push('Setcode');
    } else if (setStatus === 'mismatch') {
      evidence.push('Set abweichend');
    }

    const hpStatus = hints.hp && candidate.hp
      ? numberKey(hints.hp) === numberKey(candidate.hp) ? 'match' : 'mismatch'
      : 'unknown';
    if (hpStatus === 'match') {
      evidence.push('KP/HP');
    } else if (hpStatus === 'mismatch') {
      evidence.push('KP/HP abweichend');
    }

    const rarityDetected = Boolean((hints.rarityHints || []).length);
    const rarityMatches = rarityDetected && candidate.rarity
      && hints.rarityHints.some(value => similarity(value, candidate.rarity) >= 0.72);
    const rarityStatus = rarityMatches ? 'match' : rarityDetected && candidate.rarity ? 'mismatch' : 'unknown';
    if (rarityMatches) {
      evidence.push('Seltenheit');
    }
    const stageMatches = hints.stageHints && hints.stageHints.some(stage => {
      return (candidate.subtypes || []).some(subtype => similarity(stage, subtype) >= 0.68);
    });
    if (stageMatches) {
      evidence.push('Entwicklungsstufe');
    }
    const artistMatches = Boolean(
      hints.artistHint && candidate.artist && similarity(hints.artistHint, candidate.artist) >= 0.76
    );
    if (artistMatches) {
      evidence.push('Illustrator');
    }

    const attack = scoreAttackFeatures(candidate, hints);
    if (attack.attackStatus === 'match') {
      evidence.push('Attacke');
    } else if (attack.attackStatus === 'mismatch') {
      evidence.push('Attacke abweichend');
    }
    if (attack.damageStatus === 'match') {
      evidence.push('Schadenswert');
    } else if (attack.damageStatus === 'mismatch') {
      evidence.push('Schadenswert abweichend');
    }

    const detectedLanguage = String(hints.language || '');
    const candidateLanguages = candidateLanguageValues(candidate);
    const languageReliable = detectedLanguage && Number(hints.languageConfidence) >= 0.7;
    const languageStatus = languageReliable && candidateLanguages.length
      ? candidateLanguages.includes(normalizeCardLanguage(detectedLanguage))
        ? 'match' : candidate.referenceLanguageFallback ? 'fallback' : 'mismatch'
      : 'unknown';
    if (languageStatus === 'match') {
      evidence.push('Sprache');
    } else if (languageStatus === 'mismatch') {
      evidence.push('Sprache abweichend');
    } else if (languageStatus === 'fallback') {
      evidence.push('Referenzbild andere Sprache');
    }

    const titleReliable = Boolean(manual)
      || Boolean(hints && hints.pokemonIdentity && hints.pokemonIdentity.reliable)
      || Number(hints && hints.pokemonIdentity && hints.pokemonIdentity.nameConfidence) >= 0.82;
    const nameStatus = nameScore >= 0.88
      ? 'match'
      : titleReliable && nameScore < 0.62 ? 'mismatch' : 'unknown';
    const signals = [
      {key: 'collector', status: collectorStatus, weight: 0.30, penalty: 0.42},
      {key: 'set', status: setStatus, weight: 0.20, value: Math.max(setScore, setNumberMatches ? 1 : 0), penalty: 0.26},
      {key: 'name', status: nameStatus, weight: 0.20, value: nameScore, penalty: 0.38,
        reliability: Number(hints && hints.pokemonIdentity && hints.pokemonIdentity.nameConfidence) || (manual ? 1 : 0.7)},
      {key: 'hp', status: hpStatus, weight: 0.09, penalty: 0.13},
      {key: 'variant', status: variantStatus, weight: 0.045, penalty: 0.12},
      {key: 'attack', status: attack.attackStatus, weight: 0.075, value: attack.attackScore, penalty: 0.09},
      {key: 'damage', status: attack.damageStatus, weight: 0.04, penalty: 0.06},
      {key: 'language', status: languageStatus === 'fallback' ? 'unknown' : languageStatus, weight: 0.025, penalty: 0.04},
      {key: 'rarity', status: rarityStatus, weight: 0.01, penalty: 0.015}
    ];
    let identificationScore = scoreFromSignals(signals);
    const exactName = nameStatus === 'match' && nameScore >= 0.94;
    const exactPrintedIdentity = collectorStatus === 'match' && setStatus === 'match';
    const corroboratedText = hpStatus === 'match'
      && (attack.attackStatus === 'match' || attack.damageStatus === 'match');

    // Positive floors model independent evidence. A bad photo must not erase an exact
    // printed identity; at the same time a species name alone remains deliberately weak.
    if (exactName && exactPrintedIdentity) identificationScore = Math.max(identificationScore, 0.965);
    else if (exactName && collectorStatus === 'match') identificationScore = Math.max(identificationScore, 0.91);
    else if (exactName && setStatus === 'match' && corroboratedText) identificationScore = Math.max(identificationScore, 0.88);
    else if (exactName && corroboratedText) identificationScore = Math.max(identificationScore, 0.76);

    if (collectorStatus === 'mismatch') identificationScore = Math.min(identificationScore, 0.36);
    if (setNumberStatus === 'mismatch') identificationScore = Math.min(identificationScore, 0.49);
    if (nameStatus === 'mismatch') identificationScore = Math.min(identificationScore, 0.32);
    if (variantStatus === 'mismatch' && collectorStatus !== 'match') identificationScore = Math.min(identificationScore, 0.58);
    if (collectorStatus !== 'match' && setStatus !== 'match' && !corroboratedText) {
      identificationScore = Math.min(identificationScore, hpStatus === 'match' ? 0.64 : 0.55);
    }
    if (collectorStatus !== 'match' && exactName && hpStatus === 'match' && !corroboratedText) {
      identificationScore = Math.min(identificationScore, 0.66);
    }
    const dataConfidence = dataCoverage(signals);
    const confidence = initialFinalConfidence(identificationScore, dataConfidence);
    return {
      ...candidate,
      confidence,
      textConfidence: confidence,
      identificationScore,
      visualVariantScore: null,
      dataConfidence,
      finalConfidence: confidence,
      scoreModelVersion: 2,
      evidence: Array.from(new Set(evidence)),
      matchDetails: {
        name: nameScore,
        variant: variantStatus,
        collector: collectorStatus,
        collectorDetected: collectors.map(item => item.number).filter(Boolean),
        set: setStatus,
        setNumber: setNumberStatus,
        setScore,
        hp: hpStatus,
        attack: attack.attackStatus,
        attackScore: attack.attackScore,
        damage: attack.damageStatus,
        textFeatures: attack.attackStatus === 'match' || attack.damageStatus === 'match' ? 'match'
          : attack.attackStatus === 'mismatch' && attack.damageStatus === 'mismatch' ? 'mismatch' : 'unknown',
        language: languageStatus,
        rarity: rarityStatus,
        artwork: null,
        wholeImage: null,
        headerImage: null,
        footerImage: null,
        textImage: null,
        visualReliable: null
      }
    };
  }

  function candidateCardType(candidate) {
    return normalizedPokemonCardType(
      candidate && (candidate.cardType || candidate.supertype || candidate.category || '')
    );
  }

  function normalizeCardLanguage(value) {
    const language = String(value || '').trim().replace('_', '-').toLowerCase();
    if (language === 'zh-tw' || language === 'zh-hant' || language === 'tw') return 'zh-TW';
    if (language === 'zh-cn' || language === 'zh-hans' || language === 'cn') return 'zh-CN';
    return /^(?:de|en|ja|ko)$/.test(language) ? language : '';
  }

  function candidateLanguageValues(candidate) {
    return [...new Set((Array.isArray(candidate && candidate.languages)
      ? candidate.languages
      : candidate && candidate.language ? [candidate.language] : [])
      .map(normalizeCardLanguage).filter(Boolean))];
  }

  function hardContradictions(candidate, hints) {
    const reasons = [];
    if (candidate && candidate.tcg && norm(candidate.tcg) !== 'pokemon') reasons.push('WRONG_TCG');
    const detectedType = normalizedPokemonCardType(hints && hints.cardType);
    const actualType = candidateCardType(candidate);
    if (detectedType !== 'unknown' && actualType !== 'unknown'
      && detectedType !== actualType && Number(hints && hints.cardTypeConfidence) >= 0.72) {
      reasons.push('WRONG_CARD_TYPE');
    }
    const strongCollector = (hints && hints.collectorNumbers || [])
      .find(item => Number(item.votes) >= 1.45) || null;
    if (strongCollector && candidate && candidate.number
      && numberKey(strongCollector.number) !== numberKey(candidate.number)) {
      reasons.push('WRONG_CARD_NUMBER');
    }
    if (strongCollector && strongCollector.total) {
      const candidateTotals = [candidate && candidate.printedTotal, candidate && candidate.total, candidate && candidate.setTotal]
        .filter(Boolean).map(numberKey);
      if (candidateTotals.length && !candidateTotals.includes(numberKey(strongCollector.total))) {
        reasons.push('WRONG_PRINTED_SET');
      }
    }
    const strongSet = (hints && hints.pokemonSetCodes || []).find(item => Number(item.votes) >= 1.2);
    if (strongSet) {
      const setValues = [candidate && candidate.setId, candidate && candidate.set, candidate && candidate.series]
        .filter(Boolean);
      if (setValues.length && Math.max(...setValues.map(value => similarity(strongSet.value, value))) < 0.35) {
        reasons.push('WRONG_SET');
      }
    }
    const title = String(hints && hints.mainTitle || '');
    const titleCandidateType = candidateCardType(candidate);
    if (title && Number(hints && hints.titleConfidence) >= 0.86
      && candidate && candidate.name && (titleCandidateType === 'trainer' || titleCandidateType === 'energy')
      && similarity(title, candidate.name) < 0.45) {
      reasons.push('WRONG_TITLE');
    }
    const detectedLanguage = normalizeCardLanguage(hints && hints.language);
    const languages = candidateLanguageValues(candidate);
    if (detectedLanguage && Number(hints && hints.languageConfidence) >= 0.78
      && languages.length && !languages.includes(detectedLanguage)
      && !(candidate && candidate.referenceLanguageFallback)) {
      reasons.push('WRONG_LANGUAGE');
    }
    return reasons;
  }

  function validateOfficialCandidate(candidate, officialRecord) {
    if (!officialRecord || officialRecord.authorizedStructured !== true) {
      return {status: 'NOT_AVAILABLE', score: 0, matches: [], conflicts: [], policy: OFFICIAL_VALIDATION_POLICY};
    }
    const matches = [];
    const conflicts = [];
    const compare = (field, left, right, comparator) => {
      if (left == null || left === '' || right == null || right === '') return;
      if ((comparator || ((a, b) => norm(a) === norm(b)))(left, right)) matches.push(field);
      else conflicts.push({field, sourceValue: String(left), officialValue: String(right)});
    };
    compare('cardName', candidate && candidate.name, officialRecord.name,
      (left, right) => similarity(left, right) >= 0.92);
    compare('cardNumber', candidate && candidate.number, officialRecord.number,
      (left, right) => numberKey(left) === numberKey(right));
    compare('set', candidate && (candidate.setId || candidate.set), officialRecord.setId || officialRecord.set,
      (left, right) => similarity(left, right) >= 0.82);
    compare('hp', candidate && candidate.hp, officialRecord.hp,
      (left, right) => numberKey(left) === numberKey(right));
    compare('cardType', candidateCardType(candidate), normalizedPokemonCardType(officialRecord.cardType));
    compare('rarity', candidate && candidate.rarity, officialRecord.rarity);
    compare('artist', candidate && candidate.artist, officialRecord.artist);
    const strongConflict = conflicts.some(item => item.field === 'cardNumber' || item.field === 'set' || item.field === 'cardType');
    const strongConfirmation = matches.includes('cardNumber')
      && (matches.includes('set') || matches.includes('cardName'));
    const status = strongConflict ? 'CONFLICT'
      : strongConfirmation || matches.length >= 3 ? 'CONFIRMED'
        : matches.length ? 'PARTIAL' : 'NOT_AVAILABLE';
    const score = status === 'CONFIRMED' ? clamp(0.78 + matches.length * 0.035, 0, 0.98)
      : status === 'PARTIAL' ? clamp(0.35 + matches.length * 0.08, 0, 0.68)
        : status === 'CONFLICT' ? -0.35 : 0;
    return {
      status,
      score,
      matches,
      conflicts,
      source: String(officialRecord.source || 'POKEMON_OFFICIAL_STRUCTURED'),
      policy: OFFICIAL_VALIDATION_POLICY
    };
  }

  function applyOfficialValidation(candidate, officialRecord) {
    const validation = validateOfficialCandidate(candidate, officialRecord);
    let identification = Number(candidate && candidate.identificationScore) || 0;
    let confidence = Number(candidate && (candidate.finalConfidence != null
      ? candidate.finalConfidence : candidate.confidence)) || 0;
    if (validation.status === 'CONFIRMED') {
      identification = clamp(Math.max(identification, 0.86) + Math.min(0.05, validation.score * 0.05), 0, 0.99);
      confidence = clamp(Math.max(confidence, identification * 0.96) + 0.025, 0, 0.99);
    } else if (validation.status === 'PARTIAL') {
      confidence = clamp(confidence + Math.min(0.018, validation.score * 0.025), 0, 0.99);
    } else if (validation.status === 'CONFLICT') {
      identification = Math.min(identification, 0.56);
      confidence = Math.min(confidence, 0.52);
    }
    return {
      ...candidate,
      identificationScore: identification,
      confidence,
      finalConfidence: confidence,
      officialValidation: validation,
      officialValidationStatus: validation.status,
      fieldProvenance: {
        ...(candidate && candidate.fieldProvenance || {}),
        officialValidation: validation.source || 'NOT_AVAILABLE'
      },
      matchDetails: {
        ...(candidate && candidate.matchDetails || {}),
        officialValidation: validation.status,
        officialValidationScore: validation.score
      }
    };
  }

  function scoreRuleText(candidate, hints) {
    const detected = hints && hints.ruleTextHints || [];
    const candidateRules = [];
    if (candidate && candidate.effect) candidateRules.push(candidate.effect);
    if (Array.isArray(candidate && candidate.rules)) candidateRules.push(...candidate.rules);
    if (!detected.length || !candidateRules.length) return {score: 0, status: 'unknown'};
    let best = 0;
    detected.slice(0, 5).forEach(item => {
      candidateRules.forEach(rule => {
        best = Math.max(best, similarity(item.value, rule));
      });
    });
    const reliable = detected.some(item => Number(item.votes) >= 1.1);
    return {
      score: best,
      status: best >= 0.66 ? 'match' : reliable && best < 0.35 ? 'mismatch' : 'unknown'
    };
  }

  function scoreNonPokemonCardCandidate(candidate, hints, manual) {
    const evidence = [];
    const detectedType = normalizedPokemonCardType(hints && hints.cardType);
    const actualType = candidateCardType(candidate);
    const typeStatus = detectedType !== 'unknown' && actualType !== 'unknown'
      ? detectedType === actualType ? 'match' : 'mismatch'
      : 'unknown';
    const title = manual || hints && hints.mainTitle || hints && hints.nameHint || '';
    const titleScore = similarity(title, candidate && candidate.name);
    const titleReliable = Boolean(title) && (manual || Number(hints && hints.titleConfidence) >= 0.76);
    if (titleScore >= 0.78) evidence.push('Titel');
    if (typeStatus === 'match') {
      evidence.push('Kartentyp');
    } else if (typeStatus === 'mismatch') {
      evidence.push('Kartentyp abweichend');
    }

    const collectors = hints && hints.collectorNumbers || [];
    const candidateNumber = numberKey(candidate && candidate.number);
    const matchingCollector = candidateNumber
      ? collectors.find(item => numberKey(item.number) === candidateNumber)
      : null;
    const collectorStatus = matchingCollector
      ? 'match'
      : collectors.length && candidateNumber ? 'mismatch' : 'unknown';
    if (collectorStatus === 'match') {
      evidence.push('Kartennummer');
    } else if (collectorStatus === 'mismatch') {
      evidence.push('Kartennummer abweichend');
    }

    const candidateTotals = [candidate && candidate.printedTotal, candidate && candidate.total, candidate && candidate.setTotal]
      .filter(Boolean)
      .map(numberKey);
    const setNumberMatches = Boolean(
      matchingCollector && matchingCollector.total
      && candidateTotals.includes(numberKey(matchingCollector.total))
    );
    const setNumberStatus = matchingCollector && matchingCollector.total && candidateTotals.length
      ? setNumberMatches ? 'match' : 'mismatch'
      : 'unknown';
    if (setNumberStatus === 'match') {
      evidence.push('Setnummer');
    } else if (setNumberStatus === 'mismatch') {
      evidence.push('Setnummer abweichend');
    }

    const setValues = [candidate && candidate.set, candidate && candidate.setId, candidate && candidate.series].filter(Boolean);
    const setScore = (hints && hints.pokemonSetCodes || []).reduce((best, entry) => {
      return Math.max(best, ...setValues.map(value => similarity(entry.value, value)));
    }, 0);
    const setStatus = setNumberStatus === 'match' || setScore >= 0.72
      ? 'match'
      : setNumberStatus === 'mismatch' ? 'mismatch' : 'unknown';
    if (setScore >= 0.72) {
      evidence.push('Setcode');
    }

    const detectedLanguage = String(hints && hints.language || '');
    const candidateLanguages = candidateLanguageValues(candidate);
    const languageReliable = detectedLanguage && Number(hints && hints.languageConfidence) >= 0.68;
    const languageStatus = languageReliable && candidateLanguages.length
      ? candidateLanguages.includes(normalizeCardLanguage(detectedLanguage))
        ? 'match' : candidate && candidate.referenceLanguageFallback ? 'fallback' : 'mismatch'
      : 'unknown';
    if (languageStatus === 'match') {
      evidence.push('Sprache');
    } else if (languageStatus === 'mismatch') {
      evidence.push('Sprache abweichend');
    } else if (languageStatus === 'fallback') {
      evidence.push('Referenzbild andere Sprache');
    }

    const rules = scoreRuleText(candidate, hints);
    if (rules.status === 'match') {
      evidence.push('Regeltext');
    } else if (rules.status === 'mismatch') {
      evidence.push('Regeltext abweichend');
    }

    const titleStatus = titleScore >= 0.88
      ? 'match'
      : titleReliable && titleScore < 0.58 ? 'mismatch' : 'unknown';
    const signals = [
      {key: 'collector', status: collectorStatus, weight: 0.31, penalty: 0.43},
      {key: 'set', status: setStatus, weight: 0.23, value: Math.max(setScore, setNumberMatches ? 1 : 0), penalty: 0.31},
      {key: 'title', status: titleStatus, weight: 0.24, value: titleScore, penalty: 0.40,
        reliability: Number(hints && hints.titleConfidence) || (manual ? 1 : 0.72)},
      {key: 'type', status: typeStatus, weight: 0.10, penalty: 0.48},
      {key: 'rules', status: rules.status, weight: 0.08, value: rules.score, penalty: 0.08},
      {key: 'language', status: languageStatus === 'fallback' ? 'unknown' : languageStatus, weight: 0.04, penalty: 0.05}
    ];
    let identificationScore = scoreFromSignals(signals);
    const exactTitle = titleStatus === 'match' && titleScore >= 0.94;
    const exactPrintedIdentity = collectorStatus === 'match' && setStatus === 'match';
    if (exactTitle && exactPrintedIdentity && typeStatus !== 'mismatch') {
      identificationScore = Math.max(identificationScore, 0.97);
    } else if (exactTitle && collectorStatus === 'match' && typeStatus !== 'mismatch') {
      identificationScore = Math.max(identificationScore, 0.91);
    } else if (exactTitle && typeStatus === 'match' && rules.status === 'match') {
      identificationScore = Math.max(identificationScore, 0.82);
    }
    if (typeStatus === 'mismatch') identificationScore = Math.min(identificationScore, 0.16);
    if (collectorStatus === 'mismatch') identificationScore = Math.min(identificationScore, 0.30);
    if (setNumberStatus === 'mismatch') identificationScore = Math.min(identificationScore, 0.43);
    if (titleStatus === 'mismatch') identificationScore = Math.min(identificationScore, 0.34);
    if (collectorStatus !== 'match' && setStatus !== 'match' && rules.status !== 'match') {
      identificationScore = Math.min(identificationScore, titleStatus === 'match' ? 0.58 : 0.48);
    }
    const dataConfidence = dataCoverage(signals);
    const confidence = initialFinalConfidence(identificationScore, dataConfidence);
    return {
      ...candidate,
      confidence,
      textConfidence: confidence,
      identificationScore,
      visualVariantScore: null,
      dataConfidence,
      finalConfidence: confidence,
      scoreModelVersion: 2,
      evidence: Array.from(new Set(evidence)),
      matchDetails: {
        name: titleScore,
        title: titleScore,
        cardType: typeStatus,
        collector: collectorStatus,
        collectorDetected: collectors.map(item => item.number).filter(Boolean),
        set: setStatus,
        setNumber: setNumberStatus,
        setScore,
        hp: 'unknown',
        variant: 'unknown',
        attack: 'unknown',
        attackScore: 0,
        damage: 'unknown',
        language: languageStatus,
        rules: rules.status,
        ruleScore: rules.score,
        textFeatures: rules.status,
        rarity: 'unknown',
        artwork: null,
        wholeImage: null,
        headerImage: null,
        footerImage: null,
        textImage: null,
        visualReliable: null
      }
    };
  }

  function scorePokemonTcgCandidate(candidate, hints, manual) {
    const type = normalizedPokemonCardType(hints && hints.cardType);
    const scored = !manual && (type === 'trainer' || type === 'energy')
      ? scoreNonPokemonCardCandidate(candidate, hints, manual)
      : scorePokemonCandidate(candidate, hints, manual);
    return candidate && candidate.officialRecord
      ? applyOfficialValidation(scored, candidate.officialRecord)
      : {...scored, officialValidationStatus: scored.officialValidationStatus || 'NOT_AVAILABLE'};
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
    const textImage = clamp(Number.isFinite(Number(visualInput.text))
      ? Number(visualInput.text) : (whole + footer) / 2, 0, 1);
    const visualReliable = visualInput.reliable !== false;
    let identificationScore = clamp(Number.isFinite(Number(candidate.identificationScore))
      ? Number(candidate.identificationScore) : Number(candidate.textConfidence) || Number(candidate.confidence) || 0, 0, 0.99);
    const dataConfidence = clamp(Number.isFinite(Number(candidate.dataConfidence))
      ? Number(candidate.dataConfidence) : identificationScore, 0, 1);
    const details = {...(candidate.matchDetails || {})};
    const collectorStatus = details.collector || 'unknown';
    const hpStatus = details.hp || 'unknown';
    const nameScore = Number(details.name) || 0;
    const setStatus = details.set || 'unknown';
    const attackStatus = details.attack || 'unknown';
    const damageStatus = details.damage || 'unknown';
    const reliableFactor = visualReliable ? 1 : 0.62;
    const crossLanguageReference = Boolean(candidate.referenceLanguageFallback);
    // Text pixels legitimately differ between localized prints. In that case artwork and
    // layout remain comparable while header/rule/footer text are deliberately de-emphasized.
    const regionalVisual = crossLanguageReference
      ? artwork * 0.64 + normalizedVisual * 0.11 + whole * 0.13
        + header * 0.04 + textImage * 0.035 + footer * 0.045
      : artwork * 0.42 + normalizedVisual * 0.10 + whole * 0.12
        + header * 0.13 + textImage * 0.12 + footer * 0.11;
    // An uncertain contour blends towards neutral instead of looking like a mismatch.
    const visualVariantScore = clamp(
      visualReliable ? regionalVisual : 0.5 + (regionalVisual - 0.5) * reliableFactor,
      0,
      1
    );
    const strongVisual = artwork >= (visualReliable ? 0.82 : 0.90)
      && visualVariantScore >= (visualReliable ? 0.78 : 0.84);
    const severeArtworkMismatch = visualReliable
      && (artwork < 0.52 || artwork < 0.58 && visualVariantScore < 0.60);
    const exactPrintedIdentity = collectorStatus === 'match' && setStatus === 'match' && nameScore >= 0.88;
    const corroboratedIdentity = nameScore >= 0.88
      && hpStatus === 'match'
      && (attackStatus === 'match' || damageStatus === 'match' || setStatus === 'match');

    // Artwork confirms card identity, not a reflective finish. Holo/Reverse detection is
    // resolved separately by variant-core; therefore it can never drag a proven identity down.
    if (exactPrintedIdentity && strongVisual) identificationScore = Math.max(identificationScore, 0.985);
    else if (exactPrintedIdentity) identificationScore = Math.max(identificationScore, 0.955);
    else if (collectorStatus === 'match' && nameScore >= 0.94 && artwork >= 0.82) {
      identificationScore = Math.max(identificationScore, 0.965);
    } else if (corroboratedIdentity && strongVisual) {
      identificationScore = Math.max(identificationScore, 0.88);
    }
    if (strongVisual && !exactPrintedIdentity) {
      identificationScore = clamp(identificationScore + 0.05, 0, collectorStatus === 'match' ? 0.94 : 0.79);
    }
    if (severeArtworkMismatch && !exactPrintedIdentity) {
      identificationScore = Math.min(identificationScore - 0.20, collectorStatus === 'match' ? 0.70 : 0.42);
      identificationScore = clamp(identificationScore, 0, 0.99);
    }

    let confidence = identificationScore * 0.94 + dataConfidence * 0.06;
    if (exactPrintedIdentity) {
      confidence = Math.max(confidence, strongVisual ? 0.96 : 0.92);
    } else if (collectorStatus === 'match' && nameScore >= 0.90) {
      confidence = Math.max(confidence, strongVisual ? 0.93 : 0.87);
    } else if (corroboratedIdentity && strongVisual) {
      confidence = Math.max(confidence, 0.84);
    }

    if (collectorStatus === 'mismatch') confidence = Math.min(confidence - 0.18, 0.40);
    if (details.setNumber === 'mismatch') confidence = Math.min(confidence - 0.12, 0.48);
    else if (setStatus === 'mismatch') confidence = Math.min(confidence - 0.10, 0.82);
    if (details.name != null && nameScore < 0.62 && dataConfidence >= 0.35) {
      confidence = Math.min(confidence, 0.36);
    }
    if (details.variant === 'mismatch' && collectorStatus !== 'match') confidence = Math.min(confidence, 0.58);
    if (hpStatus === 'mismatch') confidence -= 0.07;
    if (attackStatus === 'mismatch') confidence -= 0.05;
    if (damageStatus === 'mismatch') confidence -= 0.03;
    if (details.language === 'mismatch') confidence -= 0.025;

    // Without printed-card evidence an obvious artwork mismatch is a strong negative.
    // With exact number+set it instead marks the print variant as uncertain.
    if (severeArtworkMismatch && !exactPrintedIdentity) {
      confidence -= 0.18;
      confidence = Math.min(confidence, collectorStatus === 'match' ? 0.74 : 0.42);
    }
    if (collectorStatus !== 'match' && !strongVisual) {
      const supportedByText = corroboratedIdentity || setStatus === 'match' && attackStatus === 'match';
      confidence = Math.min(confidence, supportedByText ? 0.78 : hpStatus === 'match' ? 0.66 : 0.55);
    }
    confidence = clamp(confidence, 0, 0.99);
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
      textConfidence: Number(candidate.textConfidence) || initialFinalConfidence(identificationScore, dataConfidence),
      identificationScore,
      visualVariantScore,
      artworkScore: artwork,
      printVariantScore: Number.isFinite(Number(candidate.printVariantScore))
        ? clamp(Number(candidate.printVariantScore), 0, 1) : null,
      dataConfidence,
      finalConfidence: confidence,
      scoreModelVersion: 2,
      visualSimilarity: normalizedVisual,
      visualResult: {
        similarity: normalizedVisual,
        artwork,
        whole,
        header,
        text: textImage,
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
        textImage,
        footerImage: footer,
        visualReliable,
        crossLanguageReference,
        variantUncertain: Boolean(candidate.variantResolution && !candidate.variantResolution.confirmed)
          || exactPrintedIdentity && visualVariantScore < 0.72
      }
    };
  }

  function rankPokemonCandidates(candidates, hints, manual, limit) {
    const ranked = candidates
      .map(candidate => scorePokemonTcgCandidate(candidate, hints, manual || ''))
      .sort((a, b) => b.confidence - a.confidence);
    const maximum = Number.isFinite(Number(limit)) ? Math.max(1, Number(limit)) : 7;
    return ranked.slice(0, maximum);
  }

  /**
   * Stage A has already established identity. Stage B may only pass plausible
   * cards of that species/variant to the comparatively expensive image matcher.
   */
  function identityPrefilterPokemonCandidates(candidates, hints, manual) {
    const input = Array.isArray(candidates) ? candidates : [];
    const cardType = normalizedPokemonCardType(hints && hints.cardType);
    if (!manual && (cardType === 'trainer' || cardType === 'energy')) {
      let filtered = input.filter(candidate => candidateCardType(candidate) === cardType);
      if (!filtered.length) return [];
      const collectors = hints && hints.collectorNumbers || [];
      const strongCollector = collectors.find(item => Number(item.votes) >= 1.5) || collectors[0];
      if (strongCollector) {
        const number = numberKey(strongCollector.number);
        const exactNumber = filtered.filter(candidate => numberKey(candidate.number) === number);
        if (!exactNumber.length) return [];
        filtered = exactNumber;
        if (strongCollector.total) {
          const total = numberKey(strongCollector.total);
          const exactPrintedSet = filtered.filter(candidate => {
            return [candidate.printedTotal, candidate.setTotal, candidate.total]
              .filter(Boolean).map(numberKey).includes(total);
          });
          if (exactPrintedSet.length) filtered = exactPrintedSet;
        }
      }
      const title = String(hints && hints.mainTitle || '');
      if (title && Number(hints && hints.titleConfidence) >= 0.76) {
        const matchingTitle = filtered.filter(candidate => similarity(title, candidate.name) >= 0.76);
        if (!matchingTitle.length) return [];
        filtered = matchingTitle;
      }
      return filtered;
    }
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

  /** Language and structural contradictions are resolved before artwork downloads. */
  function prefilterPokemonCandidates(candidates, hints, manual) {
    const input = Array.isArray(candidates) ? candidates : [];
    const detectedLanguage = normalizeCardLanguage(hints && hints.language);
    const reliableLanguage = detectedLanguage && Number(hints && hints.languageConfidence) >= 0.70;
    let languagePool = input.slice();
    let usedLanguageFallback = false;
    if (!manual && reliableLanguage) {
      const localized = languagePool.filter(candidate => candidateLanguageValues(candidate).includes(detectedLanguage));
      if (localized.length) {
        const compatibleLanguage = detectedLanguage === 'zh-CN' ? 'zh-TW'
          : detectedLanguage === 'zh-TW' ? 'zh-CN' : '';
        const controlledFallback = languagePool.filter(candidate => {
          const languages = candidateLanguageValues(candidate);
          return !languages.includes(detectedLanguage)
            && (languages.includes('en') || compatibleLanguage && languages.includes(compatibleLanguage));
        }).map(candidate => ({
          ...candidate,
          referenceLanguageFallback: true,
          requestedReferenceLanguage: detectedLanguage
        }));
        languagePool = localized.concat(controlledFallback);
      } else {
        const compatibleLanguage = detectedLanguage === 'zh-CN' ? 'zh-TW'
          : detectedLanguage === 'zh-TW' ? 'zh-CN' : '';
        const compatible = compatibleLanguage
          ? languagePool.filter(candidate => candidateLanguageValues(candidate).includes(compatibleLanguage))
          : [];
        const international = languagePool.filter(candidate => candidateLanguageValues(candidate).includes('en'));
        languagePool = (compatible.length ? compatible : international.length ? international : languagePool).map(candidate => ({
          ...candidate,
          referenceLanguageFallback: true,
          requestedReferenceLanguage: detectedLanguage
        }));
        usedLanguageFallback = languagePool.length > 0;
      }
    }
    const afterLanguage = languagePool.length;
    const contradictionPool = languagePool.filter(candidate => !hardContradictions(candidate, hints).length);
    const result = identityPrefilterPokemonCandidates(contradictionPool, hints, manual);
    Object.defineProperty(result, 'filterDiagnostics', {
      value: {
        before: input.length,
        afterLanguage,
        afterHardContradictions: contradictionPool.length,
        afterIdentity: result.length,
        usedLanguageFallback
      },
      enumerable: false
    });
    return result;
  }

  function printedIdentityKey(candidate) {
    if (!candidate) return '';
    const name = norm(candidate.name);
    const set = norm(candidate.setId || candidate.setCode || candidate.set);
    const number = numberKey(candidate.number);
    if (!name || !set || !number) return '';
    return [
      norm(candidate.tcg || 'pokemon'),
      name,
      set,
      number,
      norm(candidate.language || (candidate.languages || [])[0])
    ].join('|');
  }

  function confidenceLevel(value) {
    const score = clamp(Number(value) || 0, 0, 1);
    if (score >= 0.90) return {key: 'very-high', label: 'Sehr hohe Übereinstimmung'};
    if (score >= 0.80) return {key: 'high', label: 'Hohe Übereinstimmung'};
    if (score >= 0.65) return {key: 'good', label: 'Gute Übereinstimmung'};
    if (score >= 0.45) return {key: 'uncertain', label: 'Unsichere Übereinstimmung'};
    return {key: 'low', label: 'Niedrige Übereinstimmung'};
  }

  function confidenceDecision(candidates) {
    if (!candidates || !candidates.length) {
      return {status: 'none', autoAccept: false, bestScore: 0, secondScore: 0, margin: 0,
        level: confidenceLevel(0), state: 'NO_RELIABLE_MATCH', identityConfirmed: false,
        variantConfirmed: false};
    }
    const bestCandidate = candidates[0];
    const bestIdentityKey = printedIdentityKey(bestCandidate);
    // A second finish of the same card is not a competing card identity. Margins are
    // deliberately calculated against the next distinct set/number/name identity.
    const secondCandidate = candidates.slice(1).find(candidate => {
      const candidateKey = printedIdentityKey(candidate);
      return !bestIdentityKey || !candidateKey || candidateKey !== bestIdentityKey;
    });
    const bestScore = clamp(Number(bestCandidate.identificationScore != null
      ? bestCandidate.identificationScore
      : bestCandidate.finalConfidence != null ? bestCandidate.finalConfidence : bestCandidate.confidence) || 0, 0, 1);
    const secondScore = secondCandidate
      ? clamp(Number(secondCandidate.identificationScore != null
        ? secondCandidate.identificationScore
        : secondCandidate.finalConfidence != null ? secondCandidate.finalConfidence : secondCandidate.confidence) || 0, 0, 1)
      : 0;
    const margin = secondCandidate ? bestScore - secondScore : 1;
    const details = bestCandidate.matchDetails || {};
    const identification = Number(bestCandidate.identificationScore) || bestScore;
    const hardContradiction = details.collector === 'mismatch'
      || details.setNumber === 'mismatch'
      || details.language === 'mismatch'
      || details.name != null && Number(details.name) < 0.58
        && (Number(bestCandidate.dataConfidence) || 0) >= 0.35;
    const sameIdentityVariants = candidates.slice(1).some(candidate => bestIdentityKey
      && printedIdentityKey(candidate) === bestIdentityKey);
    const artwork = Number(details.artwork);
    const exactNameNumberArtwork = Number(details.name) >= 0.92
      && details.collector === 'match' && Number.isFinite(artwork) && artwork >= 0.80;
    const strongStructuredIdentity = details.collector === 'match'
      && (Number(details.name) >= 0.90 || details.set === 'match');
    const identityClear = !hardContradiction && (
      exactNameNumberArtwork
      || identification >= 0.90 && strongStructuredIdentity
      || identification >= 0.82 && margin >= 0.10 && (strongStructuredIdentity || Number(details.artwork) >= 0.82)
      || identification >= 0.72 && margin >= 0.18 && strongStructuredIdentity
    );
    const variantResolution = bestCandidate.variantResolution || null;
    const variantConfirmed = variantResolution
      ? Boolean(variantResolution.confirmed)
      : !details.variantUncertain && !sameIdentityVariants;

    if (identityClear && !variantConfirmed) {
      return {status: 'variant-uncertain', autoAccept: false, bestScore, secondScore, margin,
        level: confidenceLevel(bestScore), identityClear: true, identityConfirmed: true,
        variantConfirmed: false, variantUncertain: true,
        state: 'IDENTITY_CONFIRMED_VARIANT_UNCERTAIN'};
    }

    const autoAccept = identityClear && variantConfirmed;
    if (autoAccept) {
      return {status: 'auto', autoAccept: true, bestScore, secondScore, margin,
        level: confidenceLevel(bestScore), identityClear: true, identityConfirmed: true,
        variantConfirmed: true, variantUncertain: false,
        state: 'IDENTITY_CONFIRMED_VARIANT_CONFIRMED'};
    }
    if (!hardContradiction && bestScore >= 0.45) {
      return {status: 'candidates', autoAccept: false, bestScore, secondScore, margin,
        level: confidenceLevel(bestScore), identityClear: false, identityConfirmed: false,
        variantConfirmed: false, state: 'IDENTITY_UNCERTAIN'};
    }
    return {status: 'low', autoAccept: false, bestScore, secondScore, margin,
      level: confidenceLevel(bestScore), identityClear: false, identityConfirmed: false,
      variantConfirmed: false, state: 'NO_RELIABLE_MATCH'};
  }

  function isConfident(candidates) {
    return confidenceDecision(candidates).autoAccept;
  }

  function hasPlausibleCandidate(candidates) {
    if (!candidates || !candidates.length) return false;
    const best = candidates[0];
    const details = best.matchDetails || {};
    const decision = confidenceDecision(candidates);
    return decision.status === 'auto'
      || decision.status === 'variant-uncertain'
      || decision.status === 'candidates';
  }

  function filterPlausibleCandidates(candidates) {
    return (Array.isArray(candidates) ? candidates : []).filter(candidate => {
      const score = Number(candidate && (candidate.finalConfidence != null
        ? candidate.finalConfidence : candidate.confidence)) || 0;
      const details = candidate && candidate.matchDetails || {};
      if (score < 0.45 || candidate && candidate.hardRejected) return false;
      return details.collector === 'match'
        || Number(details.name != null ? details.name : details.title) >= 0.76
        || Number(details.artwork) >= 0.72
        || details.rules === 'match'
        || candidate && candidate.officialValidationStatus === 'CONFIRMED';
    });
  }

  return {
    clamp,
    norm,
    similarity,
    bestKnownPokemonName,
    normalizedPokemonCardType,
    extractPokemonVariant,
    candidatePokemonIdentity,
    numberKey,
    parsePokemonCollector,
    detectCardLanguage,
    extractHints,
    classifyTcg,
    scorePokemonCandidate,
    scorePokemonTcgCandidate,
    scoreNonPokemonCardCandidate,
    rankPokemonCandidates,
    prefilterPokemonCandidates,
    hardContradictions,
    filterPlausibleCandidates,
    validateOfficialCandidate,
    applyOfficialValidation,
    OFFICIAL_VALIDATION_POLICY,
    combineVisualSimilarity,
    confidenceLevel,
    confidenceDecision,
    isConfident,
    hasPlausibleCandidate
  };
});
