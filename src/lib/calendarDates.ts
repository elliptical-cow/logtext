export type CalendarDay = {
  date: Date;
  dateInput: string;
  day: number;
  currentMonth: boolean;
  today: boolean;
};

export function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function calendarDays(month: Date, today = new Date()): CalendarDay[] {
  const firstDay = startOfMonth(month);
  const leadingDays = (firstDay.getDay() + 6) % 7;
  const firstVisibleDay = new Date(firstDay);
  firstVisibleDay.setDate(firstDay.getDate() - leadingDays);
  const todayInput = formatLocalDate(today);

  return Array.from({ length: 42 }, (_value, index) => {
    const date = new Date(firstVisibleDay);
    date.setDate(firstVisibleDay.getDate() + index);
    return {
      date,
      dateInput: formatLocalDate(date),
      day: date.getDate(),
      currentMonth: date.getMonth() === month.getMonth(),
      today: formatLocalDate(date) === todayInput,
    };
  });
}
