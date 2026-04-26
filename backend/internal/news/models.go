package news

import "time"

// Sentiment is a coarse label derived from keyword scoring. We avoid "neutral"
// vs "mixed" — three states is enough for the UI chip and keeps the scorer
// honest about what it actually knows.
type Sentiment string

const (
	SentimentPositive Sentiment = "positive"
	SentimentNeutral  Sentiment = "neutral"
	SentimentNegative Sentiment = "negative"
)

// Article is the UI-facing shape. We deliberately drop NewsAPI fields we
// don't render (source.id, author, content, urlToImage) so the JSON
// payload stays small.
type Article struct {
	Title       string    `json:"title"`
	Description string    `json:"description"`
	URL         string    `json:"url"`
	Source      string    `json:"source"`
	PublishedAt time.Time `json:"publishedAt"`
	Sentiment   Sentiment `json:"sentiment"`
	// Score is the raw +/- keyword count; handy for debugging, harmless for clients.
	Score int `json:"score"`
}
