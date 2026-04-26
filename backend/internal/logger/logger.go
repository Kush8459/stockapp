package logger

import (
	"os"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

// Init configures the global zerolog logger. In development it uses a pretty
// console writer; in any other env it emits structured JSON on stdout.
func Init(env string) {
	zerolog.TimeFieldFormat = time.RFC3339Nano

	if env == "development" {
		log.Logger = log.Output(zerolog.ConsoleWriter{
			Out:        os.Stdout,
			TimeFormat: "15:04:05.000",
		})
		zerolog.SetGlobalLevel(zerolog.DebugLevel)
		return
	}

	log.Logger = zerolog.New(os.Stdout).With().Timestamp().Logger()
	zerolog.SetGlobalLevel(zerolog.InfoLevel)
}
