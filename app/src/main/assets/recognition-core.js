(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PokeRecognition = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const bannedNameTerms = [
    'basis', 'basic', 'phase 1', 'phase 2', 'stage 1', 'stage 2', 'trainer',
    'energy', 'energie', 'pokemon', 'pokémon', 'sammeln', 'ziehe', 'schaden',
    'damage', 'attack', 'ability', 'fähigkeit', 'illustrator', 'illustration',
    'copyright', 'bandai', 'konami', 'character', 'leader', 'counter', 'don!!',
    'event', 'retreat', 'weakness', 'resistance', 'schwäche', 'resistenz'
  ];

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
      lines.forEach(rawLine => {
        const value = String(rawLine.text || '').replace(/\s+/g, ' ').trim();
        const key = norm(value);
        if (!value || seenLines.has(key)) return;
        seenLines.add(key);
        lineEntries.push({
          text: value,
          y: Number.isFinite(Number(rawLine.y)) ? Number(rawLine.y) : 0.5,
          pass: passIndex
        });
      });

      const collectorPattern = /\b([A-Z]{0,3}\s*-?\s*[0-9OIL|]{1,3}[A-Z]?)\s*[\/／]\s*([A-Z]{0,3}\s*-?\s*[0-9OIL|]{1,3})\b/gi;
      let collectorMatch;
      const seenCollectors = new Set();
      while ((collectorMatch = collectorPattern.exec(text)) !== null) {
        const number = cleanOcrDigits(collectorMatch[1]).replace(/\s/g, '');
        const total = cleanOcrDigits(collectorMatch[2]).replace(/\D/g, '');
        const key = numberKey(number) + '/' + numberKey(total);
        if (number && total && !seenCollectors.has(key)) {
          seenCollectors.add(key);
          addVote(collectorVotes, key, {number, total}, 1);
        }
      }

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
      const hpPattern = /\b(?:KP|HP)\s*([0-9OIL|]{2,3})\b/gi;
      let hpMatch;
      while ((hpMatch = hpPattern.exec(text)) !== null) {
        const hp = cleanOcrDigits(hpMatch[1]).replace(/\D/g, '');
        if (hp) addVote(hpVotes, hp, hp, 1);
      }
    });

    const lineVotes = new Map();
    lineEntries.forEach(line => {
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
      const positionBonus = line.y <= 0.38 ? 1.35 : line.y <= 0.58 ? 0.45 : 0;
      addVote(lineVotes, normalized, value, 1 + positionBonus);
    });

    const nameHints = [...lineVotes.values()]
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

    return {
      rawText: completeText,
      lines: lineEntries,
      nameHint: nameHints[0] ? nameHints[0].value : '',
      nameHints,
      collectorNumbers,
      pokemonNumber: collectorNumbers[0] ? collectorNumbers[0].number : '',
      pokemonTotal: collectorNumbers[0] ? collectorNumbers[0].total : '',
      pokemonSetCodes: setCodes,
      yugiohSetCode: findYuGiOhSetCode(completeText),
      onepieceId: onePieceVotes.size ? [...onePieceVotes.values()].sort((a, b) => b.votes - a.votes)[0].value : '',
      hp: hpVotes.size ? [...hpVotes.values()].sort((a, b) => b.votes - a.votes)[0].value : '',
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
    const matchingCollector = collectors.find(item => numberKey(item.number) === candidateNumber);
    const nameScore = bestNameSimilarity(hints, candidate.name, manual);
    let score = 0;

    if (matchingCollector) {
      score += 0.38 + Math.min(0.05, Math.max(0, matchingCollector.votes - 1) * 0.018);
      evidence.push('Kartennummer');
      const candidateTotals = [candidate.printedTotal, candidate.total, candidate.setTotal]
        .filter(Boolean)
        .map(numberKey);
      if (matchingCollector.total && candidateTotals.includes(numberKey(matchingCollector.total))) {
        score += 0.24;
        evidence.push('Setnummer');
      }
      score += nameScore * 0.24;
    } else if (collectors.length) {
      score = Math.max(score, Math.max(0, nameScore * 0.72 - 0.06));
    } else {
      score += nameScore * (manual ? 0.9 : 0.78);
    }

    if (nameScore >= 0.78) evidence.push('Name');
    const setValues = [candidate.set, candidate.setId, candidate.series].filter(Boolean);
    const setScore = (hints.pokemonSetCodes || []).reduce((best, entry) => {
      return Math.max(best, ...setValues.map(value => similarity(entry.value, value)));
    }, 0);
    if (setScore >= 0.7) {
      score += 0.06 * setScore;
      evidence.push('Setcode');
    }
    if (hints.hp && candidate.hp && numberKey(hints.hp) === numberKey(candidate.hp)) {
      score += 0.05;
      evidence.push('KP/HP');
    }
    if (hints.rarityHints && hints.rarityHints.some(value => similarity(value, candidate.rarity) >= 0.72)) {
      score += 0.025;
      evidence.push('Seltenheit');
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
    return {...candidate, confidence: clamp(score, 0, 0.99), evidence};
  }

  function rankPokemonCandidates(candidates, hints, manual) {
    return candidates
      .map(candidate => scorePokemonCandidate(candidate, hints, manual || ''))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 7);
  }

  function isConfident(candidates) {
    if (!candidates || !candidates.length) return false;
    const best = candidates[0].confidence || 0;
    const second = candidates[1] ? candidates[1].confidence || 0 : 0;
    return best >= 0.82 && (!candidates[1] || best - second >= 0.11);
  }

  return {
    clamp,
    norm,
    similarity,
    numberKey,
    extractHints,
    classifyTcg,
    scorePokemonCandidate,
    rankPokemonCandidates,
    isConfident
  };
});
