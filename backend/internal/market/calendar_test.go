package market

import (
	"testing"
	"time"
)

func TestCurrentStatusOpen(t *testing.T) {
	// Mon 2026-04-27, 12:00 IST → market open.
	at := time.Date(2026, time.April, 27, 12, 0, 0, 0, IST)
	s := CurrentStatus(at)
	if s.Status != StatusOpen {
		t.Fatalf("want open, got %q (label=%s)", s.Status, s.Label)
	}
	if s.NextClose == nil || s.NextClose.Hour() != 15 || s.NextClose.Minute() != 30 {
		t.Fatalf("want NextClose=15:30, got %+v", s.NextClose)
	}
}

func TestCurrentStatusPreOpen(t *testing.T) {
	at := time.Date(2026, time.April, 27, 9, 5, 0, 0, IST)
	s := CurrentStatus(at)
	if s.Status != StatusPreOpen {
		t.Fatalf("want preopen, got %q", s.Status)
	}
}

func TestCurrentStatusBeforePreOpen(t *testing.T) {
	at := time.Date(2026, time.April, 27, 7, 0, 0, 0, IST)
	s := CurrentStatus(at)
	if s.Status != StatusClosed {
		t.Fatalf("want closed (pre-9am), got %q", s.Status)
	}
	if s.NextOpen.Hour() != 9 || s.NextOpen.Minute() != 0 {
		t.Fatalf("want NextOpen=09:00, got %v", s.NextOpen)
	}
}

func TestCurrentStatusAfterClose(t *testing.T) {
	// Mon 16:00 IST → closed, next open Tue 09:00.
	at := time.Date(2026, time.April, 27, 16, 0, 0, 0, IST)
	s := CurrentStatus(at)
	if s.Status != StatusClosed {
		t.Fatalf("want closed, got %q", s.Status)
	}
	if s.NextOpen.Day() != 28 {
		t.Fatalf("want NextOpen on 28th, got %v", s.NextOpen)
	}
}

func TestCurrentStatusWeekend(t *testing.T) {
	// Sat 2026-04-25, midday.
	at := time.Date(2026, time.April, 25, 12, 0, 0, 0, IST)
	s := CurrentStatus(at)
	if s.Status != StatusWeekend {
		t.Fatalf("want weekend, got %q", s.Status)
	}
	// Next open is Mon 27 09:00.
	if s.NextOpen.Day() != 27 || s.NextOpen.Weekday() != time.Monday {
		t.Fatalf("want NextOpen on Mon 27, got %v", s.NextOpen)
	}
}

func TestCurrentStatusHoliday(t *testing.T) {
	// 2026-01-26 Republic Day (Mon), midday → closed for holiday.
	at := time.Date(2026, time.January, 26, 12, 0, 0, 0, IST)
	s := CurrentStatus(at)
	if s.Status != StatusHoliday {
		t.Fatalf("want holiday, got %q", s.Status)
	}
	if s.HolidayName != "Republic Day" {
		t.Fatalf("want HolidayName='Republic Day', got %q", s.HolidayName)
	}
}

func TestNextTradingSkipsWeekendAndHoliday(t *testing.T) {
	// Fri 2026-04-3 is Good Friday → next trading day should be Mon 6.
	from := time.Date(2026, time.April, 3, 0, 0, 0, 0, IST)
	got := nextTradingPreOpen(from)
	if got.Day() != 6 || got.Weekday() != time.Monday {
		t.Fatalf("want Mon Apr 6, got %v", got)
	}
}
