(() => {
  const modal = document.querySelector("[data-booking-modal]");
  const dialog = modal?.querySelector(".booking-modal__dialog");
  const form = modal?.querySelector(".booking-form");
  const dateInput = modal?.querySelector("[data-booking-datepicker]");
  const monthLabel = modal?.querySelector("[data-booking-month-label]");
  const monthPrev = modal?.querySelector("[data-booking-month-prev]");
  const monthNext = modal?.querySelector("[data-booking-month-next]");
  const timesElement = modal?.querySelector("[data-booking-times]");
  const datesLoader = modal?.querySelector("[data-booking-dates-loader]");
  const peopleMinus = modal?.querySelector("[data-booking-people-minus]");
  const peoplePlus = modal?.querySelector("[data-booking-people-plus]");
  const peopleOutput = modal?.querySelector("[data-booking-people-output]");
  const openButtons = document.querySelectorAll("[data-booking-open]");
  const closeButtons = modal?.querySelectorAll("[data-booking-close]");
  const infoOpenButton = modal?.querySelector("[data-booking-info-open]");
  const infoPopup = modal?.querySelector("[data-booking-info-popup]");
  const infoDialog = infoPopup?.querySelector(".booking-info-popup__dialog");
  const infoCloseButtons = infoPopup?.querySelectorAll(
    "[data-booking-info-close]",
  );
  const submitButton = form?.querySelector("[type='submit']");
  const termsCheckbox = form?.querySelector("input[name='terms']");
  const phoneInput = form?.querySelector("input[name='phone']");
  const submitLabel = submitButton?.querySelector(
    "[data-booking-submit-label]",
  );
  const submitPlaceholder = form?.querySelector(
    "[data-booking-submit-placeholder]",
  );
  const priceTotal = modal?.querySelector("[data-booking-price-total]");
  const priceDetails = modal?.querySelector("[data-booking-price-details]");

  const FIRST_SET_PRICE = 600;
  const NEXT_SET_PRICE = 400;

  if (!modal || !dialog || !form || !openButtons.length) return;

  let lastFocusedElement = null;
  let lastFocusedInfoElement = null;
  let datepicker = null;
  let activeDatesRequest = 0;
  let activeTimesRequest = 0;
  let isBookingReady = false;
  let lockedScrollY = 0;

  const bookingState = {
    selectedDate: "",
    selectedTimes: [],
    peopleCount: 1,
    availableDates: new Set(),
    availableTimes: [],
    isLoadingDates: false,
    isLoadingTimes: false,
    availabilityError: "",
    isSubmitting: false,
  };

  const toIsoDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  };

  const getMonthName = (date) =>
    new Intl.DateTimeFormat("ru-RU", {
      month: "long",
      year: "numeric",
    }).format(date);

  const getCurrentMonthIndex = () => {
    const today = new Date();

    return today.getFullYear() * 12 + today.getMonth();
  };

  const getVisibleMonthIndex = () => {
    if (!datepicker) return getCurrentMonthIndex();

    return datepicker.currentYear * 12 + datepicker.currentMonth;
  };

  const updateMonthControls = () => {
    monthPrev?.toggleAttribute(
      "disabled",
      bookingState.isLoadingDates ||
        getVisibleMonthIndex() <= getCurrentMonthIndex(),
    );
    monthNext?.toggleAttribute("disabled", bookingState.isLoadingDates);
  };

  const updateDatesLoader = () => {
    if (!datesLoader) return;

    datesLoader.hidden = !bookingState.isLoadingDates;
  };

  const isAvailableDate = (date) =>
    bookingState.availableDates.has(toIsoDate(date));

  const clearDatepickerSelection = () => {
    if (!datepicker) return;

    const visibleDate = new Date(
      datepicker.currentYear,
      datepicker.currentMonth,
      1,
    );

    datepicker.clear(false);
    datepicker.jumpToDate(visibleDate, false);
    updateMonthControls();
  };

  const updateCalendarDayAvailability = (
    _selectedDates,
    _dateString,
    instance,
    dayElement,
  ) => {
    const date = dayElement.dateObj;
    const isVisibleMonth =
      date.getFullYear() === instance.currentYear &&
      date.getMonth() === instance.currentMonth;

    if (isVisibleMonth && !isAvailableDate(date)) {
      dayElement.classList.add("flatpickr-disabled");
      dayElement.setAttribute("aria-disabled", "true");
    }
  };

  const readJsonResponse = async (response) => {
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(
        data?.error?.message || "Сервис бронирования временно недоступен.",
      );
    }

    return data;
  };

  const fetchAvailableDates = async ({ year, month }) => {
    const params = new URLSearchParams({
      year: String(year),
      month: String(month),
    });
    const data = await fetch(`/api/booking/dates?${params.toString()}`, {
      cache: "no-store",
    }).then(readJsonResponse);

    return Array.isArray(data.dates) ? data.dates : [];
  };

  const fetchAvailableTimes = async ({ date }) => {
    const params = new URLSearchParams({
      date,
    });
    const data = await fetch(`/api/booking/times?${params.toString()}`, {
      cache: "no-store",
    }).then(readJsonResponse);

    return Array.isArray(data.times) ? data.times : [];
  };

  const submitBooking = async (payload) => {
    const response = await fetch("/api/booking/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    return readJsonResponse(response);
  };

  const formatPrice = (amount, unit = "леев") =>
    `${new Intl.NumberFormat("ru-RU").format(amount)} ${unit}`;

  const calculateBookingPrice = () => {
    const setCount = bookingState.selectedTimes.length;

    if (!setCount) return 0;

    const firstSetCount = Math.min(bookingState.peopleCount, setCount);
    const nextSetCount = Math.max(setCount - bookingState.peopleCount, 0);

    return firstSetCount * FIRST_SET_PRICE + nextSetCount * NEXT_SET_PRICE;
  };

  const isMobileBookingLayout = () =>
    window.matchMedia("(max-width: 920px)").matches;

  const hasMinimumSelectedTimes = () =>
    bookingState.selectedTimes.length >= bookingState.peopleCount;

  const formatSlotCount = (count) => {
    const lastDigit = count % 10;
    let slotLabel = "слотов";

    if (lastDigit === 1) {
      slotLabel = "слот";
    } else if ([2, 3, 4].includes(lastDigit)) {
      slotLabel = "слота";
    }

    return `${count} ${slotLabel}`;
  };

  const getMinimumTimesMessage = () =>
    `Выберите минимум ${formatSlotCount(bookingState.peopleCount)} для ${bookingState.peopleCount} чел.`;

  const updatePriceSummary = () => {
    const setCount = bookingState.selectedTimes.length;
    const total = calculateBookingPrice();
    const hasSelectedTime = setCount > 0;
    const shouldHidePrice = isMobileBookingLayout() && !hasSelectedTime;

    if (priceTotal) {
      priceTotal.hidden = shouldHidePrice;
      priceTotal.textContent = formatPrice(total);
    }

    if (priceDetails) {
      priceDetails.textContent = setCount
        ? `${bookingState.peopleCount} чел. x ${setCount} сет(ов)`
        : "Выберите дату и время";
    }
  };

  const updateSubmitState = () => {
    if (!submitButton) return;

    const hasEnoughSelectedTimes = hasMinimumSelectedTimes();

    if (submitPlaceholder) {
      submitPlaceholder.hidden = false;
    }

    submitButton.toggleAttribute(
      "disabled",
      bookingState.isSubmitting ||
        !termsCheckbox?.checked ||
        !hasEnoughSelectedTimes,
    );
    submitButton.classList.toggle("is-loading", bookingState.isSubmitting);
    submitButton.setAttribute("aria-busy", String(bookingState.isSubmitting));

    if (submitLabel) {
      submitLabel.textContent = bookingState.isSubmitting
        ? "Бронируем..."
        : "Оплатить";
    }
  };

  const updatePeopleOutput = () => {
    if (peopleOutput) {
      peopleOutput.textContent = String(bookingState.peopleCount);
    }

    peopleMinus?.toggleAttribute("disabled", bookingState.peopleCount <= 1);
    peoplePlus?.toggleAttribute("disabled", bookingState.peopleCount >= 8);
  };

  const renderTimes = () => {
    if (!timesElement) return;

    updatePriceSummary();
    updateSubmitState();
    timesElement.innerHTML = "";

    if (bookingState.isLoadingTimes) {
      const loader = document.createElement("p");
      const spinner = document.createElement("span");
      const label = document.createElement("span");

      loader.className = "booking-times__empty booking-times__loader";
      loader.setAttribute("aria-live", "polite");
      spinner.className = "booking-loader__spinner";
      spinner.setAttribute("aria-hidden", "true");
      label.textContent = "Загружаем доступное время";
      loader.append(spinner, label);
      timesElement.append(loader);
      return;
    }

    if (bookingState.availabilityError) {
      const message = document.createElement("p");
      message.className = "booking-times__empty";
      message.textContent = bookingState.availabilityError;
      timesElement.append(message);
      return;
    }

    if (!bookingState.selectedDate) {
      const message = document.createElement("p");
      message.className = "booking-times__empty";
      message.textContent = "Выберите доступную дату";
      timesElement.append(message);
      return;
    }

    if (!bookingState.availableTimes.length) {
      const message = document.createElement("p");
      message.className = "booking-times__empty";
      message.textContent = "Нет доступного времени";
      timesElement.append(message);
      return;
    }

    bookingState.availableTimes.forEach(({ time, available }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = time;
      button.disabled = !available;
      button.setAttribute(
        "aria-pressed",
        String(bookingState.selectedTimes.includes(time)),
      );
      button.classList.toggle(
        "is-selected",
        bookingState.selectedTimes.includes(time),
      );

      button.addEventListener("click", () => {
        if (bookingState.selectedTimes.includes(time)) {
          bookingState.selectedTimes = bookingState.selectedTimes.filter(
            (selectedTime) => selectedTime !== time,
          );
        } else {
          bookingState.selectedTimes = [...bookingState.selectedTimes, time];
        }
        renderTimes();
      });

      timesElement.append(button);
    });
  };

  const loadTimesForSelectedDate = async () => {
    if (!bookingState.selectedDate) {
      activeTimesRequest += 1;
      bookingState.availableTimes = [];
      bookingState.selectedTimes = [];
      bookingState.isLoadingTimes = false;
      renderTimes();
      return;
    }

    const requestId = ++activeTimesRequest;
    bookingState.isLoadingTimes = true;
    bookingState.availabilityError = "";
    renderTimes();

    let times = [];

    try {
      times = await fetchAvailableTimes({
        date: bookingState.selectedDate,
      });
    } catch (error) {
      if (requestId !== activeTimesRequest) return;

      bookingState.availableTimes = [];
      bookingState.selectedTimes = [];
      bookingState.isLoadingTimes = false;
      bookingState.availabilityError = error.message;
      renderTimes();
      return;
    }

    if (requestId !== activeTimesRequest) return;

    bookingState.availableTimes = times;
    bookingState.isLoadingTimes = false;

    const availableSelectedTimes = new Set(
      times.filter(({ available }) => available).map(({ time }) => time),
    );
    bookingState.selectedTimes = bookingState.selectedTimes.filter((time) =>
      availableSelectedTimes.has(time),
    );

    renderTimes();
  };

  const applyDateAvailability = () => {
    if (!datepicker) return;

    datepicker.redraw();

    const firstAvailableDate = Array.from(bookingState.availableDates)[0];

    if (
      bookingState.selectedDate &&
      !bookingState.availableDates.has(bookingState.selectedDate)
    ) {
      bookingState.selectedDate = "";
      bookingState.selectedTimes = [];
    }

    if (!bookingState.selectedDate && firstAvailableDate) {
      bookingState.selectedDate = firstAvailableDate;
      datepicker.setDate(firstAvailableDate, false);
    }

    if (!bookingState.selectedDate) {
      clearDatepickerSelection();
    }

    loadTimesForSelectedDate();
  };

  const loadDatesForVisibleMonth = async () => {
    if (!datepicker) return;

    const requestId = ++activeDatesRequest;
    const visibleDate = new Date(
      datepicker.currentYear,
      datepicker.currentMonth,
      1,
    );

    if (monthLabel) {
      monthLabel.textContent = getMonthName(visibleDate);
    }
    bookingState.isLoadingDates = true;
    updateDatesLoader();
    updateMonthControls();

    let availableDates = [];

    try {
      bookingState.availabilityError = "";
      availableDates = await fetchAvailableDates({
        year: datepicker.currentYear,
        month: datepicker.currentMonth + 1,
      });
    } catch (error) {
      if (requestId !== activeDatesRequest) return;

      bookingState.availableDates = new Set();
      bookingState.availableTimes = [];
      bookingState.selectedDate = "";
      bookingState.selectedTimes = [];
      bookingState.isLoadingDates = false;
      bookingState.availabilityError = error.message;
      updateDatesLoader();
      updateMonthControls();
      applyDateAvailability();
      renderTimes();
      return;
    }

    if (requestId !== activeDatesRequest) return;

    bookingState.availableDates = new Set(availableDates);
    bookingState.isLoadingDates = false;
    updateDatesLoader();
    updateMonthControls();
    applyDateAvailability();
  };

  const initBookingDatepicker = () => {
    if (datepicker) return true;
    if (!dateInput || !window.flatpickr) return false;

    datepicker = window.flatpickr(dateInput, {
      inline: true,
      static: true,
      dateFormat: "Y-m-d",
      locale: window.flatpickr.l10ns.ru,
      disableMobile: true,
      minDate: "today",
      prevArrow: "",
      nextArrow: "",
      onDayCreate: updateCalendarDayAvailability,
      onMonthChange: loadDatesForVisibleMonth,
      onYearChange: loadDatesForVisibleMonth,
      onChange: ([date]) => {
        if (date && !isAvailableDate(date)) {
          clearDatepickerSelection();
          return;
        }

        bookingState.selectedDate = date ? toIsoDate(date) : "";
        bookingState.selectedTimes = [];
        loadTimesForSelectedDate();
      },
    });

    monthPrev?.addEventListener("click", () => {
      if (getVisibleMonthIndex() <= getCurrentMonthIndex()) {
        updateMonthControls();
        return;
      }

      datepicker.changeMonth(-1);
    });
    monthNext?.addEventListener("click", () => {
      datepicker.changeMonth(1);
    });

    isBookingReady = true;
    return true;
  };

  const refreshBookingAvailability = async () => {
    if (!initBookingDatepicker()) return;

    isBookingReady = false;
    await loadDatesForVisibleMonth();
    isBookingReady = true;
  };

  const refreshAvailabilityForPeople = () => {
    updatePeopleOutput();
    updatePriceSummary();
    updateSubmitState();
  };

  const setPeopleCount = (nextCount) => {
    bookingState.peopleCount = Math.min(Math.max(nextCount, 1), 8);
    refreshAvailabilityForPeople();
  };

  const isInfoPopupOpen = () => Boolean(infoPopup && !infoPopup.hidden);

  const openInfoPopup = (event) => {
    event?.preventDefault();

    if (!infoPopup || !infoDialog) return;

    lastFocusedInfoElement = document.activeElement;
    infoPopup.hidden = false;
    infoPopup.setAttribute("aria-hidden", "false");
    window.requestAnimationFrame(() => infoDialog.focus());
  };

  const closeInfoPopup = ({ restoreFocus = true } = {}) => {
    if (!infoPopup || infoPopup.hidden) return;

    infoPopup.setAttribute("aria-hidden", "true");
    infoPopup.hidden = true;

    if (restoreFocus && lastFocusedInfoElement instanceof HTMLElement) {
      lastFocusedInfoElement.focus();
    }

    lastFocusedInfoElement = null;
  };

  const openModal = () => {
    lastFocusedElement = document.activeElement;
    lockedScrollY = window.scrollY;
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.body.style.top = `-${lockedScrollY}px`;
    document.documentElement.classList.add("has-booking-modal");
    document.body.classList.add("has-booking-modal");
    refreshBookingAvailability();
    window.requestAnimationFrame(() => dialog.focus());
  };

  const closeModal = () => {
    closeInfoPopup({ restoreFocus: false });
    modal.setAttribute("aria-hidden", "true");
    modal.hidden = true;
    document.documentElement.classList.remove("has-booking-modal");
    document.body.classList.remove("has-booking-modal");
    document.body.style.top = "";
    window.scrollTo(0, lockedScrollY);

    if (lastFocusedElement instanceof HTMLElement) {
      lastFocusedElement.focus();
    }
  };

  openButtons.forEach((button) => {
    button.addEventListener("click", openModal);
  });

  closeButtons?.forEach((button) => {
    button.addEventListener("click", closeModal);
  });

  infoOpenButton?.addEventListener("click", openInfoPopup);

  infoCloseButtons?.forEach((button) => {
    button.addEventListener("click", () => closeInfoPopup());
  });

  peopleMinus?.addEventListener("click", () => {
    setPeopleCount(bookingState.peopleCount - 1);
  });

  peoplePlus?.addEventListener("click", () => {
    setPeopleCount(bookingState.peopleCount + 1);
  });

  termsCheckbox?.addEventListener("change", updateSubmitState);
  phoneInput?.addEventListener("input", () => {
    phoneInput.value = phoneInput.value.replace(/\D/g, "").slice(0, 8);
  });
  window.addEventListener("resize", () => {
    updatePriceSummary();
    updateSubmitState();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) {
      if (isInfoPopupOpen()) {
        event.preventDefault();
        closeInfoPopup();
        return;
      }

      closeModal();
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!form.reportValidity()) return;

    if (!bookingState.selectedDate) {
      await window.showAppAlert({
        title: "Проверьте дату",
        message: "Выберите дату катания.",
      });
      return;
    }

    if (!bookingState.selectedTimes.length) {
      await window.showAppAlert({
        title: "Проверьте время",
        message: "Выберите время катания.",
      });
      return;
    }

    if (!hasMinimumSelectedTimes()) {
      await window.showAppAlert({
        title: "Минимум 2 сета",
        message: getMinimumTimesMessage(),
      });
      return;
    }

    if (!isBookingReady) return;

    const formData = new FormData(form);
    const payload = {
      name: String(formData.get("name") || "").trim(),
      email: String(formData.get("email") || "").trim(),
      phone: String(formData.get("phone") || "").trim(),
      peopleCount: bookingState.peopleCount,
      date: bookingState.selectedDate,
      times: bookingState.selectedTimes,
      acceptedTerms: formData.get("terms") === "on",
    };

    bookingState.isSubmitting = true;
    updateSubmitState();

    try {
      const result = await submitBooking(payload);
      const codes = Array.isArray(result?.bookings)
        ? result.bookings.map((booking) => booking.code).filter(Boolean)
        : [];

      await window.showAppAlert({
        title: "Бронирование создано",
        message: codes.length
          ? `Код: ${codes.join(", ")}`
          : "Мы получили вашу бронь.",
      });
      closeModal();
    } catch (error) {
      await window.showAppAlert({
        title: "Не удалось создать бронирование",
        message: error.message,
      });
      await loadTimesForSelectedDate();
    } finally {
      bookingState.isSubmitting = false;
      updateSubmitState();
    }
  });

  updatePeopleOutput();
  updatePriceSummary();
  updateSubmitState();
  renderTimes();
})();
