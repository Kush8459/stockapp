// Package market exposes Indian-market context — NSE trading hours, the
// official holiday calendar, and a derived "is the market open right now?"
// state for the UI's top bar.
//
// All timing is calculated in IST regardless of the host's local timezone.
package market

import (
	"time"
)

// IST is Asia/Kolkata. Tries the timezone database first, falls back to a
// fixed +05:30 offset on bare images that ship without tzdata. Initialised
// at var-decl time (not init) so package-level holiday dates that depend on
// it can use it during their own var-init pass.
var IST = func() *time.Location {
	if loc, err := time.LoadLocation("Asia/Kolkata"); err == nil {
		return loc
	}
	return time.FixedZone("IST", 5*3600+30*60)
}()

// Trading hours, IST, valid for both NSE and BSE main equity sessions.
const (
	preOpenStartHour = 9
	preOpenStartMin  = 0
	openHour         = 9
	openMin          = 15
	closeHour        = 15
	closeMin         = 30
)

// Holiday is one trading-closed date for NSE/BSE. Date is the calendar day
// (in IST). Name is what the UI shows.
type Holiday struct {
	Date time.Time
	Name string
}

// Holidays2026 is the published NSE/BSE equity-trading holiday list for the
// 2026 calendar year. Date-certain ones (Republic Day, Independence Day,
// Gandhi Jayanti, Christmas, Maharashtra Day) are included verbatim; the
// religious/lunar ones are best-effort and should be cross-checked against
// the official NSE circular each year:
// https://www.nseindia.com/resources/exchange-communication-holidays
//
// Update yearly. Diwali Muhurat (special evening session) is not modelled.
var Holidays2026 = []Holiday{
	{Date: date(2026, time.January, 26), Name: "Republic Day"},
	{Date: date(2026, time.March, 4), Name: "Mahashivratri"},
	{Date: date(2026, time.March, 25), Name: "Holi"},
	{Date: date(2026, time.April, 3), Name: "Good Friday"},
	{Date: date(2026, time.April, 14), Name: "Dr. Ambedkar Jayanti"},
	{Date: date(2026, time.May, 1), Name: "Maharashtra Day"},
	{Date: date(2026, time.August, 15), Name: "Independence Day"},
	{Date: date(2026, time.October, 2), Name: "Mahatma Gandhi Jayanti"},
	{Date: date(2026, time.November, 9), Name: "Diwali — Laxmi Pujan"},
	{Date: date(2026, time.November, 25), Name: "Guru Nanak Jayanti"},
	{Date: date(2026, time.December, 25), Name: "Christmas"},
}

// date is a helper to build a date at midnight IST.
func date(y int, m time.Month, d int) time.Time {
	return time.Date(y, m, d, 0, 0, 0, 0, IST)
}

// Status is what the UI shows in the top bar.
type Status string

const (
	StatusOpen    Status = "open"     // 09:15–15:30 IST on a trading day
	StatusPreOpen Status = "preopen"  // 09:00–09:15 IST on a trading day
	StatusClosed  Status = "closed"   // any other time on a trading day
	StatusHoliday Status = "holiday"  // listed NSE holiday
	StatusWeekend Status = "weekend"  // Sat / Sun
)

// Snapshot is the response shape for /market/status.
type Snapshot struct {
	Status      Status    `json:"status"`
	Label       string    `json:"label"`
	HolidayName string    `json:"holidayName,omitempty"`
	NowIST      time.Time `json:"nowIST"`
	// NextOpen is the next time the market opens (preopen start at 09:00 IST).
	// Always set, even when the market is currently open (it's the *next* open).
	NextOpen time.Time `json:"nextOpen"`
	// NextClose is the upcoming or in-progress close (15:30 IST).
	// Set only when the market is open or pre-open today.
	NextClose *time.Time `json:"nextClose,omitempty"`
}

// CurrentStatus returns the snapshot at time t. Pass time.Now() in normal
// callers; tests inject a fixed time.
func CurrentStatus(t time.Time) Snapshot {
	t = t.In(IST)
	now := t

	day := startOfDay(t)
	holiday, isHol := holidayOn(day)
	weekend := isWeekend(day)

	preOpen := atHM(day, preOpenStartHour, preOpenStartMin)
	open := atHM(day, openHour, openMin)
	close := atHM(day, closeHour, closeMin)

	switch {
	case isHol:
		return Snapshot{
			Status:      StatusHoliday,
			Label:       "Closed for " + holiday.Name,
			HolidayName: holiday.Name,
			NowIST:      now,
			NextOpen:    nextTradingPreOpen(day.AddDate(0, 0, 1)),
		}
	case weekend:
		return Snapshot{
			Status:   StatusWeekend,
			Label:    "Markets closed (weekend)",
			NowIST:   now,
			NextOpen: nextTradingPreOpen(day.AddDate(0, 0, 1)),
		}
	case now.Before(preOpen):
		return Snapshot{
			Status:   StatusClosed,
			Label:    "Pre-open at 9:00 IST",
			NowIST:   now,
			NextOpen: preOpen,
		}
	case now.Before(open):
		closeCopy := close
		return Snapshot{
			Status:    StatusPreOpen,
			Label:     "Pre-open session",
			NowIST:    now,
			NextOpen:  open,
			NextClose: &closeCopy,
		}
	case now.Before(close):
		closeCopy := close
		return Snapshot{
			Status:    StatusOpen,
			Label:     "Markets open",
			NowIST:    now,
			NextOpen:  nextTradingPreOpen(day.AddDate(0, 0, 1)),
			NextClose: &closeCopy,
		}
	default: // after close, same trading day
		return Snapshot{
			Status:   StatusClosed,
			Label:    "Markets closed",
			NowIST:   now,
			NextOpen: nextTradingPreOpen(day.AddDate(0, 0, 1)),
		}
	}
}

// nextTradingPreOpen walks forward from `from` (inclusive) until it finds a
// non-weekend, non-holiday day, then returns 09:00 IST on that day.
func nextTradingPreOpen(from time.Time) time.Time {
	d := startOfDay(from)
	for i := 0; i < 10; i++ { // safety bound
		if !isWeekend(d) {
			if _, isHol := holidayOn(d); !isHol {
				return atHM(d, preOpenStartHour, preOpenStartMin)
			}
		}
		d = d.AddDate(0, 0, 1)
	}
	return atHM(d, preOpenStartHour, preOpenStartMin)
}

func startOfDay(t time.Time) time.Time {
	t = t.In(IST)
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, IST)
}

func atHM(day time.Time, h, m int) time.Time {
	return time.Date(day.Year(), day.Month(), day.Day(), h, m, 0, 0, IST)
}

func isWeekend(t time.Time) bool {
	wd := t.In(IST).Weekday()
	return wd == time.Saturday || wd == time.Sunday
}

func holidayOn(day time.Time) (Holiday, bool) {
	day = startOfDay(day)
	for _, h := range Holidays2026 {
		if h.Date.Equal(day) {
			return h, true
		}
	}
	return Holiday{}, false
}
