package insights

import "time"

// HealthLabel is a coarse descriptor attached to the numeric healthScore.
type HealthLabel string

const (
	HealthExcellent HealthLabel = "Excellent"
	HealthGood      HealthLabel = "Good"
	HealthFair      HealthLabel = "Fair"
	HealthNeeds     HealthLabel = "Needs attention"
)

// Severity ranks risk items so the UI can sort and color them.
type Severity string

const (
	SeverityHigh   Severity = "high"
	SeverityMedium Severity = "medium"
	SeverityLow    Severity = "low"
)

// Priority ranks suggestions.
type Priority string

const (
	PriorityHigh   Priority = "high"
	PriorityMedium Priority = "medium"
	PriorityLow    Priority = "low"
)

// HealthScore breaks the overall 0-100 score into four sub-dimensions so the
// UI can show what's dragging the headline up or down.
type HealthScore struct {
	Overall         int         `json:"overall"`
	Label           HealthLabel `json:"label"`
	Diversification int         `json:"diversification"`
	RiskManagement  int         `json:"riskManagement"`
	Performance     int         `json:"performance"`
	Discipline      int         `json:"discipline"`
}

// Highlight is a tickered data-grounded call-out. Note field is the model's
// one-sentence explanation of why this ticker made the list.
type Highlight struct {
	Ticker string `json:"ticker"`
	Value  string `json:"value"` // e.g. "+18.5%", "42.0%"
	Note   string `json:"note"`
}

// KeyHighlights is the four-card strip on the UI.
type KeyHighlights struct {
	TopPerformer    *Highlight `json:"topPerformer,omitempty"`
	TopLaggard      *Highlight `json:"topLaggard,omitempty"`
	BiggestPosition *Highlight `json:"biggestPosition,omitempty"`
	FastestMover    *Highlight `json:"fastestMover,omitempty"`
}

// Analysis is the per-axis commentary shown under the hero.
type Analysis struct {
	Allocation    string `json:"allocation"`
	Concentration string `json:"concentration"`
	Performance   string `json:"performance"`
	Discipline    string `json:"discipline"`
}

// Strength is a positive observation. `detail` is one sentence of grounded commentary.
type Strength struct {
	Title  string `json:"title"`
	Detail string `json:"detail"`
}

// Risk is a negative observation with severity.
type Risk struct {
	Title    string   `json:"title"`
	Detail   string   `json:"detail"`
	Severity Severity `json:"severity"`
}

// Suggestion is a research / action prompt (never "buy X").
type Suggestion struct {
	Title    string   `json:"title"`
	Detail   string   `json:"detail"`
	Priority Priority `json:"priority"`
	Category string   `json:"category"` // e.g. "rebalance", "research", "risk"
}

// Insight is the canonical UI payload.
type Insight struct {
	ExecutiveSummary string         `json:"executiveSummary"`
	HealthScore      HealthScore    `json:"healthScore"`
	KeyHighlights    KeyHighlights  `json:"keyHighlights"`
	Analysis         Analysis       `json:"analysis"`
	Strengths        []Strength     `json:"strengths"`
	Risks            []Risk         `json:"risks"`
	Suggestions      []Suggestion   `json:"suggestions"`
	NextSteps        []string       `json:"nextSteps"`

	GeneratedAt time.Time `json:"generatedAt"`
	Model       string    `json:"model"`
	Cached      bool      `json:"cached"`
	// InputSize lets the UI render "Analyzed N holdings · M transactions" in the header.
	Input InputSummary `json:"input"`
}

type InputSummary struct {
	Holdings     int `json:"holdings"`
	Transactions int `json:"transactions"`
	SIPs         int `json:"sips"`
}
