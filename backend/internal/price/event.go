package price

import "encoding/json"

// event is the envelope emitted on the WebSocket — {"type":"price","data":{...}}.
type event struct {
	Type string `json:"type"`
	Data any    `json:"data"`
}

func encodeEvent(kind string, data any) []byte {
	b, _ := json.Marshal(event{Type: kind, Data: data})
	return b
}
