package news

import (
	"strings"
	"unicode"
)

// Small curated lexicon. We intentionally keep it compact so the scorer is
// easy to reason about; a proper model would be better but also far heavier
// and requires training data. Words are stems/bare forms; we'll check for
// inclusion after lowercasing the text and word-splitting.
var positiveWords = map[string]struct{}{
	"beat": {}, "beats": {}, "rally": {}, "rallies": {},
	"surge": {}, "surges": {}, "soar": {}, "soars": {},
	"jump": {}, "jumps": {}, "rise": {}, "rises": {}, "risen": {},
	"climb": {}, "climbs": {}, "gain": {}, "gains": {},
	"up": {}, "upbeat": {}, "upgrade": {}, "upgraded": {},
	"strong": {}, "stronger": {}, "strength": {}, "robust": {},
	"growth": {}, "growing": {}, "expand": {}, "expands": {}, "expansion": {},
	"profit": {}, "profits": {}, "profitable": {},
	"record": {}, "high": {}, "highs": {},
	"buy": {}, "outperform": {}, "positive": {}, "bullish": {},
	"breakthrough": {}, "milestone": {}, "approved": {}, "win": {}, "wins": {},
}

var negativeWords = map[string]struct{}{
	"miss": {}, "misses": {}, "missed": {},
	"drop": {}, "drops": {}, "dropped": {},
	"fall": {}, "falls": {}, "fell": {}, "fallen": {},
	"plunge": {}, "plunges": {},
	"crash": {}, "crashes": {},
	"slide": {}, "slides": {},
	"slump": {}, "slumps": {},
	"decline": {}, "declines": {}, "declining": {},
	"down": {}, "downbeat": {}, "downgrade": {}, "downgraded": {},
	"weak": {}, "weaker": {}, "weakness": {},
	"loss": {}, "losses": {},
	"cut": {}, "cuts": {}, "slash": {}, "slashes": {},
	"probe": {}, "lawsuit": {}, "fraud": {}, "scandal": {},
	"low": {}, "lows": {},
	"sell": {}, "underperform": {}, "negative": {}, "bearish": {},
	"concern": {}, "concerns": {}, "warn": {}, "warns": {}, "warning": {},
}

// score returns (score, tag). Score counts matched positive words minus
// matched negative words. We tokenize by splitting on non-letter runes and
// lowercasing.
func score(text string) (int, Sentiment) {
	if text == "" {
		return 0, SentimentNeutral
	}
	var n int
	fieldFn := func(r rune) bool { return !unicode.IsLetter(r) }
	for _, tok := range strings.FieldsFunc(text, fieldFn) {
		w := strings.ToLower(tok)
		if _, ok := positiveWords[w]; ok {
			n++
		} else if _, ok := negativeWords[w]; ok {
			n--
		}
	}
	switch {
	case n > 0:
		return n, SentimentPositive
	case n < 0:
		return n, SentimentNegative
	default:
		return 0, SentimentNeutral
	}
}
