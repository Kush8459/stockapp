package insights

// systemPrompt is the stable role-setting part of the request.
const systemPrompt = `You are a portfolio-review assistant for a retail Indian investor using an investment-tracking app like Groww or IndMoney. You are given a JSON snapshot of the user's portfolio (holdings with live P&L, recent transactions, XIRR, SIPs, asset allocation).

Your job is to produce a concise, candid, data-grounded portfolio review. You are an analyst, not a salesperson. No preamble, no hedging, no "consult your advisor" — the UI shows a fixed disclaimer below your output.

Scope and voice:
- Stay in scope: portfolio structure, concentration, performance, behavioural patterns.
- Do NOT recommend specific securities to buy or sell. You may suggest the user research diversification into a broad asset class (e.g. "consider researching gold ETFs for inflation hedge").
- Be specific. Reference actual tickers, percentages, and ₹ amounts from the snapshot. Do not invent data.
- Be concise. Every sentence earns its place.
- Every sentence must be grounded: tied to a number or ticker in the snapshot.

Scoring rubric (all 0-100, integers):
- overall = round(0.30*diversification + 0.25*riskManagement + 0.25*performance + 0.20*discipline). Label: >=85 Excellent, >=70 Good, >=50 Fair, else "Needs attention".
- diversification: penalise concentration (single position > 30% → cap at 50), asset-class imbalance (all stocks, no MFs → cap at 60), sector concentration.
- riskManagement: down-weight heavy small-cap exposure, single-sector overweight, losses > 15%.
- performance: up-weight when total P&L% beats 10% annualised, down-weight on red.
- discipline: up-weight active SIPs, regular transactions, consistent cost-basis; down-weight heavy churn.
- If the portfolio is tiny (<3 holdings) or empty, give each axis a low score and say so in the summary.

executiveSummary: 1-2 sentences. Lead with the single most important takeaway.

keyHighlights (all optional — only include if the data supports them):
- topPerformer: the holding with the best pnlPercent. 'value' = pnlPercent (e.g. "+18.5%"). 'note' = one sentence on why it stands out.
- topLaggard: the holding with the worst pnlPercent. Include even if only mildly red.
- biggestPosition: the holding with the highest allocPercent. 'value' = allocPercent (e.g. "42.0%").
- fastestMover: the holding with the largest day-change magnitude (absolute). 'value' = dayChangePercent (e.g. "+3.2%").

analysis: four one-to-two-sentence paragraphs, each grounded in actual numbers. Do not repeat the summary.

strengths: 2-4 items. Each title is 2-4 words; detail is one grounded sentence.
risks: 2-4 items with severity. Each title 2-4 words; detail cites specific data; severity reflects impact × likelihood.
suggestions: 2-4 items with priority and category ('rebalance' | 'research' | 'risk' | 'discipline'). Research-oriented, never "buy X". Priority reflects urgency.
nextSteps: 2-4 short imperative lines the user can actually do this week.

Return only the JSON object that matches the schema. No markdown, no prose outside JSON.`

// responseSchema constrains Gemini's output to exactly our Insight struct.
var responseSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"executiveSummary": map[string]any{
			"type":        "string",
			"description": "1-2 sentence headline.",
		},
		"healthScore": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"overall":         intSchema(),
				"label":           map[string]any{"type": "string", "enum": []string{"Excellent", "Good", "Fair", "Needs attention"}},
				"diversification": intSchema(),
				"riskManagement":  intSchema(),
				"performance":     intSchema(),
				"discipline":      intSchema(),
			},
			"required":         []string{"overall", "label", "diversification", "riskManagement", "performance", "discipline"},
			"propertyOrdering": []string{"overall", "label", "diversification", "riskManagement", "performance", "discipline"},
		},
		"keyHighlights": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"topPerformer":    highlightSchema(),
				"topLaggard":      highlightSchema(),
				"biggestPosition": highlightSchema(),
				"fastestMover":    highlightSchema(),
			},
			"propertyOrdering": []string{"topPerformer", "topLaggard", "biggestPosition", "fastestMover"},
		},
		"analysis": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"allocation":    map[string]any{"type": "string"},
				"concentration": map[string]any{"type": "string"},
				"performance":   map[string]any{"type": "string"},
				"discipline":    map[string]any{"type": "string"},
			},
			"required":         []string{"allocation", "concentration", "performance", "discipline"},
			"propertyOrdering": []string{"allocation", "concentration", "performance", "discipline"},
		},
		"strengths": map[string]any{
			"type": "array",
			"items": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"title":  map[string]any{"type": "string"},
					"detail": map[string]any{"type": "string"},
				},
				"required":         []string{"title", "detail"},
				"propertyOrdering": []string{"title", "detail"},
			},
		},
		"risks": map[string]any{
			"type": "array",
			"items": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"title":    map[string]any{"type": "string"},
					"detail":   map[string]any{"type": "string"},
					"severity": map[string]any{"type": "string", "enum": []string{"high", "medium", "low"}},
				},
				"required":         []string{"title", "detail", "severity"},
				"propertyOrdering": []string{"title", "detail", "severity"},
			},
		},
		"suggestions": map[string]any{
			"type": "array",
			"items": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"title":    map[string]any{"type": "string"},
					"detail":   map[string]any{"type": "string"},
					"priority": map[string]any{"type": "string", "enum": []string{"high", "medium", "low"}},
					"category": map[string]any{"type": "string", "enum": []string{"rebalance", "research", "risk", "discipline"}},
				},
				"required":         []string{"title", "detail", "priority", "category"},
				"propertyOrdering": []string{"title", "detail", "priority", "category"},
			},
		},
		"nextSteps": map[string]any{
			"type":  "array",
			"items": map[string]any{"type": "string"},
		},
	},
	"required": []string{
		"executiveSummary", "healthScore", "analysis",
		"strengths", "risks", "suggestions", "nextSteps",
	},
	"propertyOrdering": []string{
		"executiveSummary", "healthScore", "keyHighlights", "analysis",
		"strengths", "risks", "suggestions", "nextSteps",
	},
}

func intSchema() map[string]any {
	return map[string]any{"type": "integer"}
}

func highlightSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"ticker": map[string]any{"type": "string"},
			"value":  map[string]any{"type": "string"},
			"note":   map[string]any{"type": "string"},
		},
		"required":         []string{"ticker", "value", "note"},
		"propertyOrdering": []string{"ticker", "value", "note"},
	}
}
