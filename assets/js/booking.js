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
  const termsOpenButton = modal?.querySelector("[data-booking-terms-open]");
  const termsPopup = modal?.querySelector("[data-booking-terms-popup]");
  const termsDialog = termsPopup?.querySelector(
    ".booking-terms-popup__dialog",
  );
  const termsCloseButtons = termsPopup?.querySelectorAll(
    "[data-booking-terms-close]",
  );
  const privacyOpenButton = modal?.querySelector(
    "[data-booking-privacy-open]",
  );
  const privacyPopup = modal?.querySelector("[data-booking-privacy-popup]");
  const privacyDialog = privacyPopup?.querySelector(
    ".booking-terms-popup__dialog",
  );
  const privacyCloseButtons = privacyPopup?.querySelectorAll(
    "[data-booking-privacy-close]",
  );
  const footerTermsOpenButton = document.querySelector(
    "[data-footer-terms-open]",
  );
  const footerPrivacyOpenButton = document.querySelector(
    "[data-footer-privacy-open]",
  );
  const submitActions = form?.querySelector("[data-booking-submit-actions]");
  const submitButtons = Array.from(
    form?.querySelectorAll("[data-booking-submit]") || [],
  );
  const termsCheckbox = form?.querySelector("input[name='terms']");
  const phoneInput = form?.querySelector("input[name='phone']");
  const submitPlaceholder = form?.querySelector(
    "[data-booking-submit-placeholder]",
  );
  const footer = modal?.querySelector(".booking-modal__footer");
  const priceTotal = modal?.querySelector("[data-booking-price-total]");
  const priceDetails = modal?.querySelector("[data-booking-price-details]");

  const SET_PRICE = 600;
  const PHONE_REQUIRED_MESSAGE = "Введите номер телефона.";
  const PHONE_MIN_DIGITS_MESSAGE = "Введите минимум 8 цифр.";
  const BOOKING_UNAVAILABLE_MESSAGE =
    "Сервис бронирования временно недоступен.";
  const FLATPICKR_STYLE_URL =
    "https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css";
  const FLATPICKR_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/flatpickr";
  const FLATPICKR_LOCALE_URL =
    "https://cdn.jsdelivr.net/npm/flatpickr/dist/l10n/ru.js";

  if (!modal || !dialog || !form || !openButtons.length) return;

  let lastFocusedElement = null;
  let lastFocusedInfoElement = null;
  let lastFocusedTermsElement = null;
  let lastFocusedPrivacyElement = null;
  let legalPopupOpenedFromFooter = false;
  let datepicker = null;
  let flatpickrAssetsPromise = null;
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

  const capitalizeFirstLetter = (value) =>
    value ? value.charAt(0).toLocaleUpperCase("ru-RU") + value.slice(1) : value;

  const getMonthName = (date) =>
    capitalizeFirstLetter(
      new Intl.DateTimeFormat("ru-RU", {
        month: "long",
        year: "numeric",
      }).format(date),
    );

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
    collapseTrailingNextMonthRows();
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

  const collapseTrailingNextMonthRows = (instance = datepicker) => {
    const dayElements = Array.from(
      instance?.calendarContainer?.querySelectorAll(".flatpickr-day") || [],
    );

    dayElements.forEach((dayElement) => {
      dayElement.classList.remove(
        "booking-calendar__day--collapsed-trailing-row",
      );
    });

    for (let rowEnd = dayElements.length; rowEnd >= 7; rowEnd -= 7) {
      const row = dayElements.slice(rowEnd - 7, rowEnd);
      const isTrailingNextMonthRow = row.every((dayElement) =>
        dayElement.classList.contains("nextMonthDay"),
      );

      if (!isTrailingNextMonthRow) return;

      row.forEach((dayElement) => {
        dayElement.classList.add(
          "booking-calendar__day--collapsed-trailing-row",
        );
      });
    }
  };

  const readJsonResponse = async (response) => {
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(data?.error?.message || BOOKING_UNAVAILABLE_MESSAGE);
    }

    return data;
  };

  const fetchAvailableDates = async ({ year, month } = {}) => {
    const params = new URLSearchParams();
    if (year !== undefined) params.append("year", String(year));
    if (month !== undefined) params.append("month", String(month));
    const data = await fetch(`/api/booking/dates?${params.toString()}`, {
      cache: "no-store",
    }).then(readJsonResponse);

    return data;
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

  const formatPrice = (amount, unit = "лей") =>
    `${new Intl.NumberFormat("ru-RU").format(amount)} ${unit}`;

  const getPhoneDigits = (value) => value.replace(/\D/g, "");

  const updatePhoneValidity = () => {
    if (!phoneInput) return true;

    const digits = getPhoneDigits(phoneInput.value);

    if (!digits) {
      phoneInput.setCustomValidity(PHONE_REQUIRED_MESSAGE);
      return false;
    }

    if (digits.length < 8) {
      phoneInput.setCustomValidity(PHONE_MIN_DIGITS_MESSAGE);
      return false;
    }

    phoneInput.setCustomValidity("");
    return true;
  };

  const calculateBookingPrice = () => {
    const setCount = bookingState.selectedTimes.length;

    if (!setCount) return 0;

    return setCount * SET_PRICE;
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

  const getPaymentMode = (submitter) => {
    const mode = submitter?.dataset?.bookingPaymentMode || "book";

    return mode === "pay" ? "pay" : "book";
  };

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
    if (!submitButtons.length) return;

    const isMobileLayout = isMobileBookingLayout();
    const hasSelectedDateAndTime =
      Boolean(bookingState.selectedDate) &&
      bookingState.selectedTimes.length > 0;
    const shouldShowMobilePlaceholder =
      isMobileLayout && !hasSelectedDateAndTime;

    footer?.classList.toggle(
      "booking-modal__footer--awaiting-slot",
      shouldShowMobilePlaceholder,
    );
    footer?.classList.toggle(
      "booking-modal__footer--has-slot",
      isMobileLayout && hasSelectedDateAndTime,
    );

    if (submitPlaceholder) {
      submitPlaceholder.hidden = false;
    }

    if (submitActions) {
      submitActions.hidden = shouldShowMobilePlaceholder;
    }

    submitButtons.forEach((submitButton) => {
      const submitLabel = submitButton.querySelector(
        "[data-booking-submit-label]",
      );

      submitButton.toggleAttribute(
        "disabled",
        bookingState.isSubmitting ||
          !hasSelectedDateAndTime ||
          !hasMinimumSelectedTimes(),
      );
      submitButton.classList.toggle("is-loading", bookingState.isSubmitting);
      submitButton.setAttribute("aria-busy", String(bookingState.isSubmitting));

      if (submitLabel) {
        submitLabel.textContent = bookingState.isSubmitting
          ? "Бронируем..."
          : submitButton.dataset.bookingPaymentMode === "pay"
            ? "Оплатить"
            : "Забронировать";
      }
    });
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
    collapseTrailingNextMonthRows();

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

    collapseTrailingNextMonthRows();
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
      const response = await fetchAvailableDates({
        year: datepicker.currentYear,
        month: datepicker.currentMonth + 1,
      });
      availableDates = Array.isArray(response?.dates) ? response.dates : [];
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

    if (!availableDates.length) {
      bookingState.availableTimes = [];
      bookingState.selectedDate = "";
      bookingState.selectedTimes = [];
      bookingState.availabilityError = BOOKING_UNAVAILABLE_MESSAGE;
      renderTimes();
    } else if (
      bookingState.selectedDate &&
      !bookingState.availableDates.has(bookingState.selectedDate)
    ) {
      bookingState.availableTimes = [];
      bookingState.selectedDate = "";
      bookingState.selectedTimes = [];
      renderTimes();
    }

    updateDatesLoader();
    updateMonthControls();
    applyDateAvailability();
  };

  const getAbsoluteAssetUrl = (url) => new URL(url, document.baseURI).href;

  const hasAssetElement = (selector, urlAttribute, url) =>
    Array.from(document.querySelectorAll(selector)).some(
      (element) => element[urlAttribute] === getAbsoluteAssetUrl(url),
    );

  const loadStylesheet = (href) => {
    if (
      hasAssetElement(
        "link[rel='stylesheet'], link[rel='preload']",
        "href",
        href,
      )
    ) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const link = document.createElement("link");

      link.rel = "stylesheet";
      link.href = href;
      link.onload = resolve;
      link.onerror = () => {
        link.remove();
        reject(new Error(BOOKING_UNAVAILABLE_MESSAGE));
      };
      document.head.append(link);
    });
  };

  const loadScript = (src) => {
    if (hasAssetElement("script[src]", "src", src)) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement("script");

      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => {
        script.remove();
        reject(new Error(BOOKING_UNAVAILABLE_MESSAGE));
      };
      document.body.append(script);
    });
  };

  const loadFlatpickrAssets = () => {
    if (window.flatpickr?.l10ns?.ru) return Promise.resolve();

    flatpickrAssetsPromise =
      flatpickrAssetsPromise ||
      (async () => {
        try {
          await Promise.all([
            loadStylesheet(FLATPICKR_STYLE_URL),
            loadScript(FLATPICKR_SCRIPT_URL),
          ]);
          await loadScript(FLATPICKR_LOCALE_URL);
        } catch (error) {
          flatpickrAssetsPromise = null;
          throw error;
        }
      })();

    return flatpickrAssetsPromise;
  };

  const initBookingDatepicker = () => {
    if (datepicker) return true;
    if (!dateInput || !window.flatpickr) return false;

    dateInput.readOnly = true;
    dateInput.inputMode = "none";
    dateInput.autocomplete = "off";
    dateInput.tabIndex = -1;

    const handleVisibleMonthChange = (_selectedDates, _dateString, instance) => {
      collapseTrailingNextMonthRows(instance);
      loadDatesForVisibleMonth();
    };

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
      onReady: (_selectedDates, _dateString, instance) => {
        collapseTrailingNextMonthRows(instance);
      },
      onMonthChange: handleVisibleMonthChange,
      onYearChange: handleVisibleMonthChange,
      onChange: ([date]) => {
        if (date && !isAvailableDate(date)) {
          clearDatepickerSelection();
          return;
        }

        bookingState.selectedDate = date ? toIsoDate(date) : "";
        bookingState.selectedTimes = [];
        dateInput.blur();
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
    bookingState.isLoadingDates = true;
    bookingState.availabilityError = "";
    updateDatesLoader();
    updateMonthControls();

    try {
      await loadFlatpickrAssets();
    } catch (error) {
      bookingState.availableDates = new Set();
      bookingState.availableTimes = [];
      bookingState.selectedDate = "";
      bookingState.selectedTimes = [];
      bookingState.isLoadingDates = false;
      bookingState.availabilityError =
        error.message || BOOKING_UNAVAILABLE_MESSAGE;
      updateDatesLoader();
      updateMonthControls();
      renderTimes();
      return;
    }

    if (!initBookingDatepicker()) return;

    isBookingReady = false;
    try {
      bookingState.availabilityError = "";
      const response = await fetchAvailableDates(); // initial fetch without params gets closest month
      const dates = Array.isArray(response?.dates) ? response.dates : [];
      const year = response?.year;
      const month = response?.month;

      bookingState.availableDates = new Set(dates);

      if (year && month) {
        const targetDate = new Date(year, month - 1, 1);
        datepicker.jumpToDate(targetDate, false);
        if (monthLabel) {
          monthLabel.textContent = getMonthName(targetDate);
        }
      }

      bookingState.isLoadingDates = false;
      updateDatesLoader();
      updateMonthControls();
      applyDateAvailability();
    } catch (error) {
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
    }
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

  const isTermsPopupOpen = () => Boolean(termsPopup && !termsPopup.hidden);

  const openTermsPopup = (event) => {
    event?.preventDefault();

    if (!termsPopup || !termsDialog) return;

    lastFocusedTermsElement = document.activeElement;
    termsPopup.hidden = false;
    termsPopup.setAttribute("aria-hidden", "false");
    termsDialog.scrollTop = 0;
    window.requestAnimationFrame(() => termsDialog.focus());
  };

  const closeTermsPopup = ({ restoreFocus = true } = {}) => {
    if (!termsPopup || termsPopup.hidden) return;

    const shouldCloseModal = legalPopupOpenedFromFooter;

    termsPopup.setAttribute("aria-hidden", "true");
    termsPopup.hidden = true;

    if (restoreFocus && lastFocusedTermsElement instanceof HTMLElement) {
      lastFocusedTermsElement.focus();
    }

    lastFocusedTermsElement = null;
    legalPopupOpenedFromFooter = false;

    if (shouldCloseModal) closeModal();
  };

  const isPrivacyPopupOpen = () =>
    Boolean(privacyPopup && !privacyPopup.hidden);

  const openPrivacyPopup = (event) => {
    event?.preventDefault();

    if (!privacyPopup || !privacyDialog) return;

    lastFocusedPrivacyElement = document.activeElement;
    privacyPopup.hidden = false;
    privacyPopup.setAttribute("aria-hidden", "false");
    privacyDialog.scrollTop = 0;
    window.requestAnimationFrame(() => privacyDialog.focus());
  };

  const closePrivacyPopup = ({ restoreFocus = true } = {}) => {
    if (!privacyPopup || privacyPopup.hidden) return;

    const shouldCloseModal = legalPopupOpenedFromFooter;

    privacyPopup.setAttribute("aria-hidden", "true");
    privacyPopup.hidden = true;

    if (restoreFocus && lastFocusedPrivacyElement instanceof HTMLElement) {
      lastFocusedPrivacyElement.focus();
    }

    lastFocusedPrivacyElement = null;
    legalPopupOpenedFromFooter = false;

    if (shouldCloseModal) closeModal();
  };

  const setupPopupTableOfContents = (popup) => {
    popup
      ?.querySelectorAll(".booking-terms-popup__toc a[href^='#']")
      .forEach((link) => {
        link.addEventListener("click", (event) => {
          event.preventDefault();

          const targetId = link.getAttribute("href")?.slice(1);
          const target = targetId ? document.getElementById(targetId) : null;

          if (target && popup.contains(target)) {
            target.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        });
      });
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

    if (window.location.hash !== "#booking") {
      history.pushState(null, null, "#booking");
    }

    window.requestAnimationFrame(() => dialog.focus());
  };

  const closeModal = () => {
    legalPopupOpenedFromFooter = false;
    closeInfoPopup({ restoreFocus: false });
    closeTermsPopup({ restoreFocus: false });
    closePrivacyPopup({ restoreFocus: false });
    modal.setAttribute("aria-hidden", "true");
    modal.hidden = true;
    document.documentElement.classList.remove("has-booking-modal");
    document.body.classList.remove("has-booking-modal");
    document.body.style.top = "";
    window.scrollTo(0, lockedScrollY);

    if (window.location.hash === "#booking") {
      history.replaceState(null, null, window.location.pathname + window.location.search);
    }

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

  termsOpenButton?.addEventListener("click", openTermsPopup);

  termsCloseButtons?.forEach((button) => {
    button.addEventListener("click", () => closeTermsPopup());
  });

  privacyOpenButton?.addEventListener("click", openPrivacyPopup);

  footerTermsOpenButton?.addEventListener("click", (event) => {
    event.preventDefault();
    legalPopupOpenedFromFooter = true;
    openModal();
    openTermsPopup();
  });

  footerPrivacyOpenButton?.addEventListener("click", (event) => {
    event.preventDefault();
    legalPopupOpenedFromFooter = true;
    openModal();
    openPrivacyPopup();
  });

  privacyCloseButtons?.forEach((button) => {
    button.addEventListener("click", () => closePrivacyPopup());
  });

  setupPopupTableOfContents(termsPopup);
  setupPopupTableOfContents(privacyPopup);

  peopleMinus?.addEventListener("click", () => {
    setPeopleCount(bookingState.peopleCount - 1);
  });

  peoplePlus?.addEventListener("click", () => {
    setPeopleCount(bookingState.peopleCount + 1);
  });

  termsCheckbox?.addEventListener("change", updateSubmitState);
  phoneInput?.addEventListener("input", () => {
    updatePhoneValidity();
  });
  window.addEventListener("resize", () => {
    updatePriceSummary();
    updateSubmitState();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) {
      if (isPrivacyPopupOpen()) {
        event.preventDefault();
        closePrivacyPopup();
        return;
      }

      if (isTermsPopupOpen()) {
        event.preventDefault();
        closeTermsPopup();
        return;
      }

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

    updatePhoneValidity();

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

    const getCookie = (name) => {
      const value = `; ${document.cookie}`;
      const parts = value.split(`; ${name}=`);
      if (parts.length === 2)
        return decodeURIComponent(parts.pop().split(";").shift());
    };

    const payload = {
      name: String(formData.get("name") || "").trim(),
      email: String(formData.get("email") || "").trim(),
      phone: getPhoneDigits(String(formData.get("phone") || "")),
      comment: String(formData.get("comment") || "").trim(),
      peopleCount: bookingState.peopleCount,
      date: bookingState.selectedDate,
      times: bookingState.selectedTimes,
      paymentMode: getPaymentMode(event.submitter),
      acceptedTerms: formData.get("terms") === "on",
      source: getCookie("visitor_source") || "",
    };

    bookingState.isSubmitting = true;
    updateSubmitState();

    try {
      const result = await submitBooking(payload);
      const codes = Array.isArray(result?.bookings)
        ? result.bookings.map((booking) => booking.code).filter(Boolean)
        : [];

      if (result?.paymentUrl) {
        window.location.assign(result.paymentUrl);
        return;
      }

      await window.showAppAlert({
        title: "Бронирование создано",
        message: "Ждем вас минимум за пол часа до вашего старта 🙂",
        // message: codes.length
        // ? `Код: ${codes.join(", ")}`
        // : "Мы получили вашу бронь.",
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

  const checkHashAndOpenModal = () => {
    if (window.location.hash === "#booking") {
      if (modal.hidden) {
        openModal();
      }
    } else {
      if (!modal.hidden) {
        closeModal();
      }
    }
  };

  window.addEventListener("hashchange", checkHashAndOpenModal);
  checkHashAndOpenModal();

  updatePeopleOutput();
  updatePriceSummary();
  updateSubmitState();
  renderTimes();
})();
