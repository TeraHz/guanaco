import { parseQuickAdd } from '../quickAddParser';
import { RepeatMode } from '../../types/vikunja';

describe('Quick Add Magic Parser', () => {
  // Local Sunday, Sept 20, 2026 at 10:00 AM (timezone-independent local reference)
  const referenceDate = new Date(2026, 8, 20, 10, 0, 0, 0);

  const expectSameLocalDay = (
    isoStr: string | null | undefined,
    year: number,
    monthIndex: number,
    day: number
  ) => {
    expect(isoStr).toBeTruthy();
    const d = new Date(isoStr!);
    expect(d.getFullYear()).toBe(year);
    expect(d.getMonth()).toBe(monthIndex);
    expect(d.getDate()).toBe(day);
  };

  describe('Skipping parsing with quotes', () => {
    it('treats entire text wrapped in a single pair of quotes as literal title', () => {
      const result = parseQuickAdd('"Buy milk tomorrow *urgent !3"', referenceDate);
      expect(result.title).toBe('Buy milk tomorrow *urgent !3');
      expect(result.labels).toEqual([]);
      expect(result.priority).toBeUndefined();
      expect(result.dueDate).toBeNull();
    });

    it('still parses magic tokens when only part of the title is quoted', () => {
      const result = parseQuickAdd('"Call Mom" *"Family Tasks" !high', referenceDate);
      expect(result.title).toBe('"Call Mom"');
      expect(result.labels).toEqual(['Family Tasks']);
      expect(result.priority).toBe(3);
    });
  });

  describe('Labels parsing (* and #, Unicode/Cyrillic)', () => {
    it('extracts single-word and multi-word labels with both * and #', () => {
      const r1 = parseQuickAdd('Order supplies *logistics #urgent', referenceDate);
      expect(r1.title).toBe('Order supplies');
      expect(r1.labels).toEqual(['logistics', 'urgent']);

      const r2 = parseQuickAdd(
        'Check shipment *"waiting on others" #"front desk"',
        referenceDate
      );
      expect(r2.title).toBe('Check shipment');
      expect(r2.labels).toEqual(['waiting on others', 'front desk']);
    });

    it('extracts Cyrillic and Unicode labels cleanly', () => {
      const r = parseQuickAdd('Купи мляко #пазар *спешно', referenceDate);
      expect(r.title).toBe('Купи мляко');
      expect(r.labels).toEqual(['пазар', 'спешно']);
    });
  });

  describe('Assignees (@) vs Date Shorthands (@today, @tomorrow, @tonight)', () => {
    it('extracts assignees with @', () => {
      const result = parseQuickAdd('Finalize seating chart @david @sarah', referenceDate);
      expect(result.title).toBe('Finalize seating chart');
      expect(result.assignees).toEqual(['david', 'sarah']);
    });

    it('parses @today, @tomorrow, and @tonight as dueDates instead of assignees', () => {
      const rToday = parseQuickAdd('Submit report @today', referenceDate);
      expect(rToday.title).toBe('Submit report');
      expect(rToday.assignees).toEqual([]);
      expectSameLocalDay(rToday.dueDate, 2026, 8, 20);

      const rTom = parseQuickAdd('Call plumber @tomorrow at 9am', referenceDate);
      expect(rTom.title).toBe('Call plumber');
      expect(rTom.assignees).toEqual([]);
      expectSameLocalDay(rTom.dueDate, 2026, 8, 21);
      expect(new Date(rTom.dueDate!).getHours()).toBe(9);

      const rTonight = parseQuickAdd('Watch film @tonight', referenceDate);
      expect(rTonight.title).toBe('Watch film');
      expect(rTonight.assignees).toEqual([]);
      expectSameLocalDay(rTonight.dueDate, 2026, 8, 20);
      expect(new Date(rTonight.dueDate!).getHours()).toBe(20);
    });
  });

  describe('Project parsing (+)', () => {
    it('extracts single-word and multi-word projects with +', () => {
      expect(parseQuickAdd('Pay rent +Personal', referenceDate)).toMatchObject({
        title: 'Pay rent',
        projectName: 'Personal',
      });
      expect(parseQuickAdd('Moving check-in +"Office Move"', referenceDate)).toMatchObject({
        title: 'Moving check-in',
        projectName: 'Office Move',
      });
    });
  });

  describe('Priority parsing (!1-!5 and !low..!critical)', () => {
    it('extracts numeric priorities !1 to !5 and named priorities !low..!critical', () => {
      expect(parseQuickAdd('Fix minor typo !1', referenceDate).priority).toBe(1);
      expect(parseQuickAdd('Production outage !5', referenceDate).priority).toBe(5);
      expect(parseQuickAdd('Clean desk !low', referenceDate)).toMatchObject({
        title: 'Clean desk',
        priority: 1,
      });
      expect(parseQuickAdd('Write docs !medium', referenceDate).priority).toBe(2);
      expect(parseQuickAdd('Ship release !HIGH', referenceDate).priority).toBe(3);
      expect(parseQuickAdd('Customer escalation !urgent', referenceDate).priority).toBe(4);
      expect(parseQuickAdd('DB outage !critical', referenceDate).priority).toBe(5);
    });
  });

  describe('Dates, Times, Short Weekdays & False-Positive Protection', () => {
    it('parses today, tomorrow, tomorrow at 5pm, and in 5 days across all timezones', () => {
      const rToday = parseQuickAdd('Submit report today', referenceDate);
      expect(rToday.title).toBe('Submit report');
      expectSameLocalDay(rToday.dueDate, 2026, 8, 20);

      const rTomorrow = parseQuickAdd('Call plumber tomorrow', referenceDate);
      expect(rTomorrow.title).toBe('Call plumber');
      expectSameLocalDay(rTomorrow.dueDate, 2026, 8, 21);

      const rTomorrow5pm = parseQuickAdd('Order supplies tomorrow at 5pm', referenceDate);
      expect(rTomorrow5pm.title).toBe('Order supplies');
      expectSameLocalDay(rTomorrow5pm.dueDate, 2026, 8, 21);
      expect(new Date(rTomorrow5pm.dueDate!).getHours()).toBe(17);

      const rIn5Days = parseQuickAdd('Renew passport in 5 days', referenceDate);
      expect(rIn5Days.title).toBe('Renew passport');
      expectSameLocalDay(rIn5Days.dueDate, 2026, 8, 25);
    });

    it('does NOT eat bare street or store numbers in "at 7 Eleven" or "at 42 Wallaby"', () => {
      const rStore = parseQuickAdd('Buy snacks at 7 Eleven', referenceDate);
      expect(rStore.title).toBe('Buy snacks at 7 Eleven');
      expect(rStore.dueDate).toBeNull();

      const rAddress = parseQuickAdd('Meet at 42 Wallaby', referenceDate);
      expect(rAddress.title).toBe('Meet at 42 Wallaby');
      expect(rAddress.dueDate).toBeNull();

      // Rejects invalid clock times
      expect(parseQuickAdd('Meet at 13pm', referenceDate).dueDate).toBeNull();
      expect(parseQuickAdd('Meet at 25:00', referenceDate).dueDate).toBeNull();
      expect(parseQuickAdd('Meet at 10:75', referenceDate).dueDate).toBeNull();
    });

    it('never throws RangeError on huge numeric day/repeat counts or invalid reference Date', () => {
      const hugeDays = parseQuickAdd('Archive backup in 999999999 days', referenceDate);
      expect(hugeDays.title).toBe('Archive backup in 999999999 days');
      expect(hugeDays.dueDate).toBeNull();

      const hugeRepeat = parseQuickAdd(
        'Check logs every 999999999999999999999 years',
        referenceDate
      );
      expect(hugeRepeat.title).toBe('Check logs every 999999999999999999999 years');
      expect(hugeRepeat.repeatAfter).toBeUndefined();

      expect(() => parseQuickAdd('Buy milk tomorrow', new Date('invalid'))).not.toThrow();
    });

    it('does NOT let "tonight" overwrite an explicit "at 9pm" time', () => {
      const r1 = parseQuickAdd('Dinner tonight at 9pm', referenceDate);
      expect(r1.title).toBe('Dinner');
      expect(new Date(r1.dueDate!).getHours()).toBe(21);

      const r2 = parseQuickAdd('Movie at 9:30pm tonight', referenceDate);
      expect(r2.title).toBe('Movie');
      expect(new Date(r2.dueDate!).getHours()).toBe(21);
      expect(new Date(r2.dueDate!).getMinutes()).toBe(30);
    });

    it('supports short weekday names (mon..sun), optional "on ", and distinguishes "next monday" when earlier in the week', () => {
      // referenceDate is Sunday Sept 20, 2026:
      // "monday" / "mon" -> Sept 21 (tomorrow)
      // "next monday" / "next mon" -> Sept 28 (following week!)
      const rMon = parseQuickAdd('Team sync on mon', referenceDate);
      expect(rMon.title).toBe('Team sync');
      expectSameLocalDay(rMon.dueDate, 2026, 8, 21);

      const rDentist = parseQuickAdd('Dentist on friday at 2pm', referenceDate);
      expect(rDentist.title).toBe('Dentist');
      expectSameLocalDay(rDentist.dueDate, 2026, 8, 25);
      expect(new Date(rDentist.dueDate!).getHours()).toBe(14);

      const rNextMon = parseQuickAdd('Quarterly planning next monday', referenceDate);
      expect(rNextMon.title).toBe('Quarterly planning');
      expectSameLocalDay(rNextMon.dueDate, 2026, 8, 28);

      // From Monday Sept 21: "fri" -> Sept 25, "next fri" -> Oct 2
      const mondayRef = new Date(2026, 8, 21, 9, 0, 0, 0);
      expectSameLocalDay(parseQuickAdd('Demo fri', mondayRef).dueDate, 2026, 8, 25);
      expectSameLocalDay(parseQuickAdd('Retro on next fri', mondayRef).dueDate, 2026, 9, 2);
    });

    it('advances bare "at <time>" to tomorrow when the time has already passed today', () => {
      const afternoonRef = new Date(2026, 8, 20, 14, 0, 0, 0); // Sept 20, 2:00 PM
      // Bare "at 9am" at 2:00 PM -> tomorrow Sept 21 at 9:00 AM
      const rPast = parseQuickAdd('Standup at 9am', afternoonRef);
      expect(rPast.title).toBe('Standup');
      expectSameLocalDay(rPast.dueDate, 2026, 8, 21);
      expect(new Date(rPast.dueDate!).getHours()).toBe(9);

      // Bare "at 5pm" at 2:00 PM -> today Sept 20 at 5:00 PM
      const rFuture = parseQuickAdd('Call client at 5pm', afternoonRef);
      expect(rFuture.title).toBe('Call client');
      expectSameLocalDay(rFuture.dueDate, 2026, 8, 20);
      expect(new Date(rFuture.dueDate!).getHours()).toBe(17);
    });

    it('handles explicit UTC, UTC-8, and UTC+9 reference Date timestamps consistently', () => {
      for (const iso of [
        '2026-09-20T12:00:00Z',
        '2026-09-20T12:00:00-08:00',
        '2026-09-20T12:00:00+09:00',
      ]) {
        const ref = new Date(iso);
        const parsed = parseQuickAdd('Check deploy tomorrow at 14:30', ref);
        expect(parsed.title).toBe('Check deploy');
        const out = new Date(parsed.dueDate!);
        const expectedDay = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() + 1);
        expect(out.getFullYear()).toBe(expectedDay.getFullYear());
        expect(out.getMonth()).toBe(expectedDay.getMonth());
        expect(out.getDate()).toBe(expectedDay.getDate());
        expect(out.getHours()).toBe(14);
        expect(out.getMinutes()).toBe(30);
      }
    });
  });

  describe('Repeating tasks (every) & repeatMode', () => {
    it('parses daily, weekly, N-days with RepeatMode.FromDueDate and monthly with RepeatMode.Monthly', () => {
      const rDay = parseQuickAdd('Drink water every day', referenceDate);
      expect(rDay.title).toBe('Drink water');
      expect(rDay.repeatAfter).toBe(86400);
      expect(rDay.repeatMode).toBe(RepeatMode.FromDueDate);

      const rWeek = parseQuickAdd('Weekly review every week', referenceDate);
      expect(rWeek.repeatAfter).toBe(604800);
      expect(rWeek.repeatMode).toBe(RepeatMode.FromDueDate);

      const r3Days = parseQuickAdd('Water plants every 3 days', referenceDate);
      expect(r3Days.repeatAfter).toBe(3 * 86400);
      expect(r3Days.repeatMode).toBe(RepeatMode.FromDueDate);

      const rMonth = parseQuickAdd('Pay rent every month', referenceDate);
      expect(rMonth.title).toBe('Pay rent');
      expect(rMonth.repeatAfter).toBe(2592000);
      expect(rMonth.repeatMode).toBe(RepeatMode.Monthly);
    });
  });

  describe('Putting it all together (Full Vikunja Magic)', () => {
    it('parses complex task with #/* labels, +project, !priority, @assignee, and date', () => {
      const result = parseQuickAdd(
        'Finalize seating chart #urgent *logistics +"Office Move" @david !high in 5 days',
        referenceDate
      );

      expect(result.title).toBe('Finalize seating chart');
      expect(result.projectName).toBe('Office Move');
      expect(result.labels).toEqual(['urgent', 'logistics']);
      expect(result.assignees).toEqual(['david']);
      expect(result.priority).toBe(3);
      expectSameLocalDay(result.dueDate, 2026, 8, 25);
    });

    it('parses natural-language Bulgarian quick-add dates, times, priorities, weekdays, and recurrence', () => {
      const r1 = parseQuickAdd(
        'Купи прясно мляко #пазар утре в 18:30 всеки 2 дни !висок',
        referenceDate
      );
      expect(r1.title).toBe('Купи прясно мляко');
      expect(r1.labels).toEqual(['пазар']);
      expect(r1.priority).toBe(3);
      expectSameLocalDay(r1.dueDate, 2026, 8, 21);
      expect(new Date(r1.dueDate!).getHours()).toBe(18);
      expect(new Date(r1.dueDate!).getMinutes()).toBe(30);
      expect(r1.repeatAfter).toBe(2 * 86400);

      const r2 = parseQuickAdd('Плати тока след 3 дни !спешно', referenceDate);
      expect(r2.title).toBe('Плати тока');
      expect(r2.priority).toBe(4);
      expectSameLocalDay(r2.dueDate, 2026, 8, 23);

      const rWeekday = parseQuickAdd('Зъболекар в петък в 14:00', referenceDate);
      expect(rWeekday.title).toBe('Зъболекар');
      expectSameLocalDay(rWeekday.dueDate, 2026, 8, 25);
      expect(new Date(rWeekday.dueDate!).getHours()).toBe(14);

      const rMonthly = parseQuickAdd('Наем всеки месец @днес', referenceDate);
      expect(rMonthly.title).toBe('Наем');
      expect(rMonthly.assignees).toEqual([]);
      expectSameLocalDay(rMonthly.dueDate, 2026, 8, 20);
      expect(rMonthly.repeatAfter).toBe(2592000);
      expect(rMonthly.repeatMode).toBe(RepeatMode.Monthly);
    });

    it('parses natural-language Spanish quick-add dates, times, priorities, weekdays, and recurrence', () => {
      const r1 = parseQuickAdd(
        'Comprar leche fresca #super mañana a las 18:30 cada 2 días !alta',
        referenceDate
      );
      expect(r1.title).toBe('Comprar leche fresca');
      expect(r1.labels).toEqual(['super']);
      expect(r1.priority).toBe(3);
      expectSameLocalDay(r1.dueDate, 2026, 8, 21);
      expect(new Date(r1.dueDate!).getHours()).toBe(18);
      expect(new Date(r1.dueDate!).getMinutes()).toBe(30);
      expect(r1.repeatAfter).toBe(2 * 86400);

      const r2 = parseQuickAdd('Pagar factura en 4 días !urgente', referenceDate);
      expect(r2.title).toBe('Pagar factura');
      expect(r2.priority).toBe(4);
      expectSameLocalDay(r2.dueDate, 2026, 8, 24);

      const rWeekday = parseQuickAdd('Dentista el viernes a las 14:00', referenceDate);
      expect(rWeekday.title).toBe('Dentista');
      expectSameLocalDay(rWeekday.dueDate, 2026, 8, 25);
      expect(new Date(rWeekday.dueDate!).getHours()).toBe(14);

      const rMonthly = parseQuickAdd('Pagar alquiler cada mes @hoy', referenceDate);
      expect(rMonthly.title).toBe('Pagar alquiler');
      expect(rMonthly.assignees).toEqual([]);
      expectSameLocalDay(rMonthly.dueDate, 2026, 8, 20);
      expect(rMonthly.repeatAfter).toBe(2592000);
      expect(rMonthly.repeatMode).toBe(RepeatMode.Monthly);
    });
  });
});
