<script lang="ts">
  import { onMount, tick } from "svelte";
  import { calendarDays, formatLocalDate, startOfMonth } from "../calendarDates";
  import { calendarDateForKey } from "../keyboardNavigation";

  export let id: string;
  export let label = "Pick date";
  export let initialDate = new Date();
  export let onSelect: (dateInput: string) => void | Promise<void>;
  export let onClose: (restoreFocus: boolean) => void;

  let popover: HTMLDivElement;
  let pickerMonth = startOfMonth(initialDate);
  let focusedDateInput = formatLocalDate(initialDate);

  $: pickerDays = calendarDays(pickerMonth);
  $: pickerMonthLabel = pickerMonth.toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });

  onMount(() => {
    void focusPickerDate();

    const handleOutsidePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !popover.contains(event.target)) {
        onClose(false);
      }
    };
    window.addEventListener("pointerdown", handleOutsidePointerDown);
    return () => window.removeEventListener("pointerdown", handleOutsidePointerDown);
  });

  function movePickerMonth(delta: number) {
    const current = new Date(`${focusedDateInput}T12:00:00`);
    const next = calendarDateForKey(current, delta < 0 ? "PageUp" : "PageDown");
    if (!next) return;
    focusedDateInput = formatLocalDate(next);
    pickerMonth = startOfMonth(next);
    void focusPickerDate();
  }

  async function focusPickerDate() {
    await tick();
    popover
      ?.querySelector<HTMLButtonElement>(`[data-picker-date="${focusedDateInput}"]`)
      ?.focus({ preventScroll: true });
  }

  function handleCalendarKeydown(event: KeyboardEvent) {
    const current = new Date(`${focusedDateInput}T12:00:00`);
    if (event.key === "Escape") {
      event.preventDefault();
      onClose(true);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      void onSelect(focusedDateInput);
      return;
    }

    const next = calendarDateForKey(current, event.key);
    if (!next) return;

    event.preventDefault();
    focusedDateInput = formatLocalDate(next);
    pickerMonth = startOfMonth(next);
    void focusPickerDate();
  }
</script>

<div bind:this={popover} {id} class="date-picker-popover" role="dialog" aria-label={label} tabindex="-1">
  <div class="date-picker-popover-header">
    <button
      type="button"
      title="Previous month"
      tabindex="-1"
      on:click={() => movePickerMonth(-1)}
    >
      &lt;
    </button>
    <span>{pickerMonthLabel}</span>
    <button
      type="button"
      title="Next month"
      tabindex="-1"
      on:click={() => movePickerMonth(1)}
    >
      &gt;
    </button>
  </div>
  <div class="date-picker-weekdays" aria-hidden="true">
    <span>Mo</span>
    <span>Tu</span>
    <span>We</span>
    <span>Th</span>
    <span>Fr</span>
    <span>Sa</span>
    <span>Su</span>
  </div>
  <div class="date-picker-grid" role="grid" aria-label={pickerMonthLabel}>
    {#each pickerDays as day}
      <button
        type="button"
        role="gridcell"
        class:outside-month={!day.currentMonth}
        class:today={day.today}
        title={day.dateInput}
        aria-label={day.date.toLocaleDateString(undefined, { dateStyle: "full" })}
        aria-current={day.today ? "date" : undefined}
        aria-selected={day.dateInput === focusedDateInput}
        data-picker-date={day.dateInput}
        tabindex={day.dateInput === focusedDateInput ? 0 : -1}
        on:focus={() => (focusedDateInput = day.dateInput)}
        on:keydown={handleCalendarKeydown}
        on:click={() => onSelect(day.dateInput)}
      >
        {day.day}
      </button>
    {/each}
  </div>
</div>
