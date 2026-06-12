const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  BookingError,
  buildSlotTimes,
  buildSlotTimesFromPattern,
  callSimplyBook,
  getAvailabilityMonthRange,
  getMonthRange,
  normalizePeopleCount,
  normalizeReservedIntervalStartTimes,
  normalizeReservedIntervalTimes,
  normalizeServiceDuration,
  normalizeSlotMatrixDates,
  normalizeSlotMatrixTimes,
  normalizeTime,
  normalizeWorkCalendarTimes,
  resetTokenCache,
  toSimplyBookTime,
} = require("../api/_simplybook");
const datesHandler = require("../api/booking/dates");
const timesHandler = require("../api/booking/times");
const createHandler = require("../api/booking/create");
const {
  resetMaibTokenCache,
  verifyMaibCallbackSignature,
} = require("../api/payments/_maib");
const { createPaymentStore } = require("../api/payments/_store");
const {
  calculateWakeMdBookingPrice,
  createCartSignature,
} = require("../api/payments/direct");
const {
  buildSbpayValidationPayload,
  validateCustomPaymentRequest,
} = require("../api/payments/_sbpay");
const { maibCallbackHandler } = require("../api/payments/maib");
const {
  sbpayDeletePaymentMethodHandler,
  sbpayFormHandler,
  sbpayRebillHandler,
  sbpayRefundHandler,
} = require("../api/payments/sbpay");

const createMockRes = () => ({
  headers: {},
  setHeader(key, value) {
    this.headers[key.toLowerCase()] = value;
  },
  end(body = "") {
    this.body = body;
  },
});

const jsonFetchResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (body === undefined ? "" : JSON.stringify(body)),
});

const setPaymentEnv = (storePath, overrides = {}) => {
  const values = {
    PUBLIC_BASE_URL: "https://local.example",
    SIMPLYBOOK_API_SECRET_KEY: "simplybook-secret",
    SBPAY_API_BASE_URL: "https://app.sbpay.test/api",
    SBPAY_TOKEN: "sb-token",
    SBPAY_SECRET: "sb-secret",
    SBPAY_MERCHANT: "merchant-1",
    MAIB_BASE_URL: "https://maib.test",
    MAIB_CLIENT_ID: "maib-client",
    MAIB_CLIENT_SECRET: "maib-secret",
    MAIB_SIGNATURE_KEY: "maib-signature",
    MAIB_LANGUAGE: "ru",
    PAYMENT_STORE_PATH: storePath,
    ...overrides,
  };
  const previous = {};

  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }

  return () => {
    for (const key of Object.keys(values)) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  };
};

const createPaymentStorePath = () =>
  path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "wakemd-payments-")),
    "store.json",
  );

const signSbpayPayload = (payload, secret = "sb-secret") => {
  const data = {
    ...payload,
    timestamp: payload.timestamp || new Date().toISOString(),
    algo: payload.algo || "sha256",
  };
  const signature = crypto
    .createHmac(data.algo, secret)
    .update(buildSbpayValidationPayload(data))
    .digest("hex");

  return {
    ...data,
    signature,
  };
};

const signMaibPayload = ({
  rawBody,
  timestamp,
  secret = "maib-signature",
  encoding = "hex",
}) =>
  crypto
    .createHmac("sha256", secret)
    .update(Buffer.concat([Buffer.from(rawBody), Buffer.from(`.${timestamp}`)]))
    .digest(encoding);

test("booking submit state requires terms and minimum selected times", () => {
  const bookingScript = fs.readFileSync("assets/js/booking.js", "utf8");
  const updateSubmitState = bookingScript.match(
    /const updateSubmitState = \(\) => \{[\s\S]*?if \(submitLabel\)/,
  )?.[0];
  const updatePriceSummary = bookingScript.match(
    /const updatePriceSummary = \(\) => \{[\s\S]*?\n    \};/,
  )?.[0];
  const refreshAvailabilityForPeople = bookingScript.match(
    /const refreshAvailabilityForPeople = \(\) => \{[\s\S]*?\};/,
  )?.[0];

  assert.ok(updateSubmitState);
  assert.match(
    updateSubmitState,
    /const hasEnoughSelectedTimes = hasMinimumSelectedTimes\(\);/,
  );
  assert.match(updateSubmitState, /!termsCheckbox\?\.checked/);
  assert.match(updateSubmitState, /!hasEnoughSelectedTimes/);
  assert.match(
    updateSubmitState,
    /submitButton\.hidden = shouldShowMobilePlaceholder/,
  );
  assert.doesNotMatch(updateSubmitState, /innerHTML/);
  assert.doesNotMatch(
    updateSubmitState,
    /isMobileBookingLayout\(\) && !hasEnoughSelectedTimes/,
  );
  assert.match(updateSubmitState, /submitPlaceholder\.hidden = false/);
  assert.ok(updatePriceSummary);
  assert.match(updatePriceSummary, /priceDetails\.textContent = setCount/);
  assert.match(updatePriceSummary, /Выберите дату и время/);
  assert.doesNotMatch(bookingScript, /getMinimumTimesPlaceholder/);
  assert.ok(refreshAvailabilityForPeople);
  assert.match(refreshAvailabilityForPeople, /updateSubmitState\(\);/);
});

test("booking contact fields are marked as required", () => {
  const html = fs.readFileSync("index.html", "utf8");

  for (const field of ["name", "phone", "email"]) {
    const input = html.match(
      new RegExp(`<input[\\s\\S]*?name="${field}"[\\s\\S]*?>`),
    )?.[0];

    assert.ok(input, field);
    assert.match(input, /\srequired\b/, field);
    assert.match(input, /aria-required="true"/, field);
  }
});

test("booking submit builds form data before payload", () => {
  const bookingScript = fs.readFileSync("assets/js/booking.js", "utf8");

  assert.match(
    bookingScript,
    /const formData = new FormData\(form\);\s+const getCookie = \(name\) =>/,
  );
  assert.match(bookingScript, /name: String\(formData\.get\("name"\)/);
  assert.match(
    bookingScript,
    /acceptedTerms: formData\.get\("terms"\) === "on"/,
  );
});

test("booking phone field accepts exactly 8 digits", () => {
  const html = fs.readFileSync("index.html", "utf8");
  const bookingScript = fs.readFileSync("assets/js/booking.js", "utf8");
  const input = html.match(/<input[\s\S]*?name="phone"[\s\S]*?>/)?.[0];

  assert.ok(input);
  assert.match(input, /type="tel"/);
  assert.match(input, /inputmode="numeric"/);
  assert.match(input, /pattern="\[0-9\]\{8\}"/);
  assert.match(input, /minlength="8"/);
  assert.match(input, /maxlength="8"/);
  assert.match(
    bookingScript,
    /phoneInput\.value = phoneInput\.value\.replace\(\/\\D\/g, ""\)\.slice\(0, 8\);/,
  );
});

test("booking calendar avoids mobile browser focus zoom traps", () => {
  const html = fs.readFileSync("index.html", "utf8");
  const css = fs.readFileSync("styles.css", "utf8");
  const bookingScript = fs.readFileSync("assets/js/booking.js", "utf8");
  const input = html.match(
    /<input[\s\S]*?data-booking-datepicker[\s\S]*?>/,
  )?.[0];

  assert.ok(input);
  assert.match(input, /type="text"/);
  assert.match(input, /inputmode="none"/);
  assert.match(input, /autocomplete="off"/);
  assert.match(input, /tabindex="-1"/);
  assert.match(input, /\sreadonly\b/);
  assert.match(css, /\.booking-date-input \{[\s\S]*?font-size: 16px;/);
  assert.match(css, /touch-action: pan-y pinch-zoom;/);
  assert.match(bookingScript, /dateInput\.readOnly = true;/);
  assert.match(bookingScript, /dateInput\.inputMode = "none";/);
  assert.match(bookingScript, /dateInput\.tabIndex = -1;/);
  assert.match(bookingScript, /dateInput\.blur\(\);/);
});

test("booking price counts first sets per selected slot before repeat sets", () => {
  const bookingScript = fs.readFileSync("assets/js/booking.js", "utf8");
  const calculateBookingPrice = bookingScript.match(
    /const calculateBookingPrice = \(\) => \{[\s\S]*?\n    \};/,
  )?.[0];

  assert.ok(calculateBookingPrice);
  assert.match(
    calculateBookingPrice,
    /const firstSetCount = Math\.min\(\s*bookingState\.peopleCount,\s*setCount,\s*\);/,
  );
  assert.match(
    calculateBookingPrice,
    /const nextSetCount = Math\.max\(\s*setCount - bookingState\.peopleCount,\s*0,\s*\);/,
  );
  assert.match(
    calculateBookingPrice,
    /firstSetCount \* FIRST_SET_PRICE \+\s*nextSetCount \* NEXT_SET_PRICE/,
  );
});

test("backend booking price matches Wake.md first and repeat set formula", () => {
  const cases = [
    { peopleCount: 1, setCount: 1, amount: 600 },
    { peopleCount: 1, setCount: 2, amount: 1000 },
    { peopleCount: 2, setCount: 2, amount: 1200 },
    { peopleCount: 2, setCount: 3, amount: 1600 },
    { peopleCount: 3, setCount: 5, amount: 2600 },
  ];

  for (const testCase of cases) {
    assert.equal(
      calculateWakeMdBookingPrice(testCase).amount,
      testCase.amount,
    );
  }
});

test("booking modal refreshes availability every time it opens", () => {
  const bookingScript = fs.readFileSync("assets/js/booking.js", "utf8");
  const initBookingDatepicker = bookingScript.match(
    /const initBookingDatepicker = \(\) => \{[\s\S]*?\n\s+\};\n\n\s+const refreshBookingAvailability/,
  )?.[0];
  const refreshBookingAvailability = bookingScript.match(
    /const refreshBookingAvailability = async \(\) => \{[\s\S]*?\n\s+\};/,
  )?.[0];
  const openModal = bookingScript.match(
    /const openModal = \(\) => \{[\s\S]*?\n\s+\};/,
  )?.[0];

  assert.ok(initBookingDatepicker);
  assert.ok(refreshBookingAvailability);
  assert.ok(openModal);
  assert.match(initBookingDatepicker, /if \(datepicker\) return true;/);
  assert.doesNotMatch(initBookingDatepicker, /onReady:\s*loadDatesForVisibleMonth/);
  assert.match(
    refreshBookingAvailability,
    /if \(!initBookingDatepicker\(\)\) return;/,
  );
  assert.match(
    refreshBookingAvailability,
    /await loadDatesForVisibleMonth\(\);/,
  );
  assert.match(openModal, /refreshBookingAvailability\(\);/);
  assert.doesNotMatch(openModal, /initBookingDatepicker\(\);/);
});

test("booking date fetches are not memoized in the browser", () => {
  const bookingScript = fs.readFileSync("assets/js/booking.js", "utf8");
  const fetchAvailableDates = bookingScript.match(
    /const fetchAvailableDates = async \(\{ year, month \}\) => \{[\s\S]*?return Array\.isArray\(data\.dates\) \? data\.dates : \[\];\n\s+\};/,
  )?.[0];

  assert.ok(fetchAvailableDates);
  assert.doesNotMatch(bookingScript, /availableDatesRequests/);
  assert.match(
    fetchAvailableDates,
    /const data = await fetch\(\s*`\/api\/booking\/dates\?\$\{params\.toString\(\)\}`,\s*\{\s*cache: "no-store",\s*\},?\s*\)\.then\(readJsonResponse\);/,
  );
  assert.doesNotMatch(fetchAvailableDates, /\.has\(/);
  assert.doesNotMatch(fetchAvailableDates, /\.set\(/);
  assert.doesNotMatch(fetchAvailableDates, /\.get\(/);
});

test("normalizes SimplyBook time values for the UI", () => {
  assert.equal(normalizeTime("09:00:00"), "09:00");
  assert.equal(normalizeTime("17:30"), "17:30");
  assert.equal(normalizeTime("bad"), "");
  assert.equal(toSimplyBookTime("10:15"), "10:15:00");
});

test("normalizes slot matrix dates and times", () => {
  const matrix = {
    "2026-05-01": ["09:00:00"],
    "2026-05-02": [],
    "2026-05-03": ["10:00:00", "10:15:00"],
  };

  assert.deepEqual(normalizeSlotMatrixDates(matrix), [
    "2026-05-01",
    "2026-05-03",
  ]);
  assert.deepEqual(normalizeSlotMatrixTimes(matrix, "2026-05-03"), [
    { time: "10:00", available: true },
    { time: "10:15", available: true },
  ]);
  assert.deepEqual(
    normalizeSlotMatrixTimes(matrix, "2026-05-03", {
      workCalendar: {
        "2026-05-03": {
          from: "10:00:00",
          to: "10:45:00",
          is_day_off: "0",
        },
      },
      reservedIntervals: {
        "2026-05-03": [
          {
            from: "2026-05-03 10:30:00",
            to: "2026-05-03 10:45:00",
          },
        ],
      },
      timeframe: 15,
    }),
    [
      { time: "10:00", available: true },
      { time: "10:15", available: true },
      { time: "10:30", available: false },
    ],
  );
  assert.deepEqual(
    normalizeSlotMatrixTimes(
      {
        "2026-05-03": ["10:00:00", "10:20:00"],
      },
      "2026-05-03",
      {
        workCalendar: {
          "2026-05-03": {
            from: "10:00:00",
            to: "11:00:00",
            is_day_off: "0",
          },
        },
        serviceDuration: 60,
        timeframe: 15,
      },
    ),
    [
      { time: "10:00", available: true },
      { time: "10:20", available: true },
      { time: "10:40", available: false },
    ],
  );
  assert.deepEqual(
    normalizeSlotMatrixTimes({}, "2026-05-03", {
      workCalendar: {
        "2026-05-03": {
          from: "10:00:00",
          to: "10:30:00",
          is_day_off: "0",
        },
      },
      timeframe: 15,
    }),
    [
      { time: "10:00", available: false },
      { time: "10:15", available: false },
    ],
  );
  assert.deepEqual(
    normalizeSlotMatrixTimes(
      {
        "2026-05-03": ["10:00:00", "11:00:00"],
      },
      "2026-05-03",
      {
        workCalendar: {
          "2026-05-03": {
            from: "10:00:00",
            to: "11:20:00",
            is_day_off: "0",
          },
        },
        reservedIntervals: {
          "2026-05-03": [
            {
              start_datetime: "2026-05-03 10:20:00",
              end_datetime: "2026-05-03 10:40:00",
            },
            {
              start_datetime: "2026-05-03 10:40:00",
              end_datetime: "2026-05-03 11:00:00",
            },
          ],
        },
        serviceDuration: 60,
      },
    ),
    [
      { time: "10:00", available: true },
      { time: "10:20", available: false },
      { time: "10:40", available: false },
      { time: "11:00", available: true },
    ],
  );
});

test("builds configured booking slot times", () => {
  assert.deepEqual(
    buildSlotTimes({
      startTime: "09:00",
      endTime: "10:00",
      intervalMinutes: 30,
    }),
    ["09:00", "09:30"],
  );
  assert.deepEqual(
    normalizeWorkCalendarTimes(
      {
        "2026-06-10": {
          from: "09:00:00",
          to: "10:00:00",
          is_day_off: "0",
        },
      },
      "2026-06-10",
      30,
    ),
    ["09:00", "09:30"],
  );
  assert.deepEqual(
    normalizeReservedIntervalTimes(
      {
        "2026-06-10": [
          {
            start_datetime: "2026-06-10 10:00:00",
            end_datetime: "2026-06-10 10:30:00",
          },
        ],
      },
      "2026-06-10",
      10,
    ),
    ["10:00", "10:10", "10:20"],
  );
  assert.deepEqual(
    normalizeReservedIntervalStartTimes(
      {
        "2026-06-10": [
          {
            start_datetime: "2026-06-10 09:20:00",
            end_datetime: "2026-06-10 09:40:00",
          },
        ],
      },
      "2026-06-10",
    ),
    ["09:20"],
  );
  assert.deepEqual(
    buildSlotTimesFromPattern({
      patternTimes: ["09:20", "09:40"],
      startTime: "09:00:00",
      endTime: "10:00:00",
      fallbackIntervalMinutes: 60,
    }),
    ["09:00", "09:20", "09:40"],
  );
  assert.equal(
    normalizeServiceDuration(
      {
        1: { id: 1, duration: "10" },
        2: { id: 2, duration: "20" },
      },
      2,
    ),
    20,
  );
});

test("validates people count and month query values", () => {
  assert.equal(normalizePeopleCount("2"), 2);
  assert.deepEqual(getMonthRange({ year: "2026", month: "2" }), {
    firstDay: "2026-02-01",
    lastDay: "2026-02-28",
  });
  assert.throws(() => normalizePeopleCount("9"), BookingError);
  assert.throws(
    () => getMonthRange({ year: "2026", month: "13" }),
    BookingError,
  );
});

test("builds availability month ranges for visible calendar months", () => {
  assert.deepEqual(
    getAvailabilityMonthRange({
      year: "2026",
      month: "5",
      timezone: "UTC",
      now: new Date("2026-05-17T12:00:00Z"),
    }),
    {
      firstDay: "2026-05-17",
      lastDay: "2026-05-31",
    },
  );
  assert.deepEqual(
    getAvailabilityMonthRange({
      year: "2026",
      month: "6",
      timezone: "UTC",
      now: new Date("2026-05-17T12:00:00Z"),
    }),
    {
      firstDay: "2026-06-01",
      lastDay: "2026-06-30",
    },
  );
  assert.deepEqual(
    getAvailabilityMonthRange({
      year: "2026",
      month: "7",
      timezone: "UTC",
      now: new Date("2026-07-15T12:00:00Z"),
    }),
    {
      firstDay: "2026-07-15",
      lastDay: "2026-07-31",
    },
  );
  assert.deepEqual(
    getAvailabilityMonthRange({
      year: "2026",
      month: "10",
      timezone: "UTC",
      now: new Date("2026-11-01T12:00:00Z"),
    }),
    null,
  );
});

test("caches token and retries once after token failures", async () => {
  resetTokenCache();

  const calls = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);

    calls.push({ url, body, headers: options.headers });

    if (body.method === "getToken") {
      return {
        ok: true,
        json: async () => ({
          result:
            calls.filter((call) => call.body.method === "getToken").length === 1
              ? "token-1"
              : "token-2",
        }),
      };
    }

    if (
      calls.filter((call) => call.body.method === "getStartTimeMatrix")
        .length === 1
    ) {
      return {
        ok: true,
        json: async () => ({
          error: { code: 401, message: "Invalid token" },
        }),
      };
    }

    return {
      ok: true,
      json: async () => ({ result: { "2026-05-13": ["10:00:00"] } }),
    };
  };

  const result = await callSimplyBook({
    method: "getStartTimeMatrix",
    params: ["2026-05-13", "2026-05-13", 1, 2, 1],
    config: {
      companyLogin: "wake",
      apiKey: "key",
      serviceId: 1,
      providerId: 2,
      timezone: "Europe/Chisinau",
    },
    fetchImpl,
  });

  assert.deepEqual(result, { "2026-05-13": ["10:00:00"] });
  assert.equal(
    calls.filter((call) => call.body.method === "getToken").length,
    2,
  );
  assert.equal(calls.at(-1).headers["X-Token"], "token-2");
});

test("refreshes token after SimplyBook access denied response", async () => {
  resetTokenCache();

  const calls = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);

    calls.push({ url, body, headers: options.headers });

    if (body.method === "getToken") {
      return {
        ok: true,
        json: async () => ({
          result:
            calls.filter((call) => call.body.method === "getToken").length === 1
              ? "token-1"
              : "token-2",
        }),
      };
    }

    if (
      calls.filter((call) => call.body.method === "getStartTimeMatrix")
        .length === 1
    ) {
      return {
        ok: true,
        json: async () => ({
          error: { code: -32600, message: "Access denied" },
        }),
      };
    }

    return {
      ok: true,
      json: async () => ({ result: { "2026-05-13": ["10:00:00"] } }),
    };
  };

  const result = await callSimplyBook({
    method: "getStartTimeMatrix",
    params: ["2026-05-13", "2026-05-13", 1, 2, 1],
    config: {
      companyLogin: "wake",
      apiKey: "key",
      serviceId: 1,
      providerId: 2,
      timezone: "Europe/Chisinau",
    },
    fetchImpl,
  });

  assert.deepEqual(result, { "2026-05-13": ["10:00:00"] });
  assert.equal(
    calls.filter((call) => call.body.method === "getToken").length,
    2,
  );
  assert.equal(calls.at(-1).headers["X-Token"], "token-2");
});

test("dates endpoint returns available dates for a requested month", async () => {
  resetTokenCache();

  const previousFetch = global.fetch;
  const previousEnv = {
    SIMPLYBOOK_COMPANY_LOGIN: process.env.SIMPLYBOOK_COMPANY_LOGIN,
    SIMPLYBOOK_API_KEY: process.env.SIMPLYBOOK_API_KEY,
    SIMPLYBOOK_PAYMENT_PROCESSOR_NAME:
      process.env.SIMPLYBOOK_PAYMENT_PROCESSOR_NAME,
    SIMPLYBOOK_SERVICE_ID: process.env.SIMPLYBOOK_SERVICE_ID,
    SIMPLYBOOK_PROVIDER_ID: process.env.SIMPLYBOOK_PROVIDER_ID,
    BOOKING_TIMEZONE: process.env.BOOKING_TIMEZONE,
  };
  const calls = [];

  process.env.SIMPLYBOOK_COMPANY_LOGIN = "wake";
  process.env.SIMPLYBOOK_API_KEY = "key";
  process.env.SIMPLYBOOK_PAYMENT_PROCESSOR_NAME = "Custom Payment";
  process.env.SIMPLYBOOK_SERVICE_ID = "1";
  process.env.SIMPLYBOOK_PROVIDER_ID = "2";
  process.env.BOOKING_TIMEZONE = "UTC";

  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body });

    if (body.method === "getToken") {
      return {
        ok: true,
        json: async () => ({ result: "token" }),
      };
    }

    return {
      ok: true,
      json: async () => ({
        result: {
          [body.params[0]]: ["09:00:00"],
          [body.params[1]]: [],
        },
      }),
    };
  };

  const req = {
    method: "GET",
    query: {
      year: "2099",
      month: "6",
    },
  };
  const res = {
    headers: {},
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(body) {
      this.body = body;
    },
  };

  try {
    await datesHandler(req, res);
  } finally {
    global.fetch = previousFetch;

    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }

  const availabilityCall = calls.find(
    (call) => call.body.method === "getStartTimeMatrix",
  );
  const availabilityCalls = calls.filter(
    (call) => call.body.method === "getStartTimeMatrix",
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body).dates, [
    availabilityCall.body.params[0],
  ]);
  assert.equal(availabilityCalls.length, 1);
  assert.equal(availabilityCall.body.params[0].slice(5), "06-01");
  assert.equal(availabilityCall.body.params[1].slice(5), "06-30");
  assert.deepEqual(availabilityCall.body.params, [
    availabilityCall.body.params[0],
    availabilityCall.body.params[1],
    1,
    2,
    1,
  ]);
});

test("times endpoint requests slots without people count filtering", async () => {
  resetTokenCache();

  const previousFetch = global.fetch;
  const previousEnv = {
    SIMPLYBOOK_COMPANY_LOGIN: process.env.SIMPLYBOOK_COMPANY_LOGIN,
    SIMPLYBOOK_API_KEY: process.env.SIMPLYBOOK_API_KEY,
    SIMPLYBOOK_PAYMENT_PROCESSOR_NAME:
      process.env.SIMPLYBOOK_PAYMENT_PROCESSOR_NAME,
    SIMPLYBOOK_SERVICE_ID: process.env.SIMPLYBOOK_SERVICE_ID,
    SIMPLYBOOK_PROVIDER_ID: process.env.SIMPLYBOOK_PROVIDER_ID,
    BOOKING_TIMEZONE: process.env.BOOKING_TIMEZONE,
  };
  const calls = [];

  process.env.SIMPLYBOOK_COMPANY_LOGIN = "wake";
  process.env.SIMPLYBOOK_API_KEY = "key";
  process.env.SIMPLYBOOK_PAYMENT_PROCESSOR_NAME = "Custom Payment";
  process.env.SIMPLYBOOK_SERVICE_ID = "1";
  process.env.SIMPLYBOOK_PROVIDER_ID = "2";
  process.env.BOOKING_TIMEZONE = "UTC";

  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body });

    if (body.method === "getToken") {
      return {
        ok: true,
        json: async () => ({ result: "token" }),
      };
    }

    if (body.method === "getWorkCalendar") {
      return {
        ok: true,
        json: async () => ({
          result: {
            "2026-06-10": {
              from: "09:00:00",
              to: "11:00:00",
              is_day_off: "0",
            },
          },
        }),
      };
    }

    if (body.method === "getReservedTimeIntervals") {
      return {
        ok: true,
        json: async () => ({
          result: {
            "2026-06-10": [
              {
                from: "2026-06-10 10:00:00",
                to: "2026-06-10 10:30:00",
              },
            ],
          },
        }),
      };
    }

    if (body.method === "getTimeframe") {
      return {
        ok: true,
        json: async () => ({ result: 15 }),
      };
    }

    if (body.method === "getEventList") {
      return {
        ok: true,
        json: async () => ({
          result: {
            1: {
              id: 1,
              duration: 60,
            },
          },
        }),
      };
    }

    return {
      ok: true,
      json: async () => ({
        result: {
          "2026-06-10": ["09:00:00", "09:20:00", "10:20:00"],
        },
      }),
    };
  };

  const req = {
    method: "GET",
    query: {
      date: "2026-06-10",
      peopleCount: "8",
    },
  };
  const res = {
    headers: {},
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(body) {
      this.body = body;
    },
  };

  try {
    await timesHandler(req, res);
  } finally {
    global.fetch = previousFetch;

    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }

  const availabilityCall = calls.find(
    (call) => call.body.method === "getStartTimeMatrix",
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body).times, [
    { time: "09:00", available: true },
    { time: "09:20", available: true },
    { time: "09:40", available: false },
    { time: "10:00", available: false },
    { time: "10:20", available: true },
    { time: "10:40", available: false },
  ]);
  assert.deepEqual(availabilityCall.body.params, [
    "2026-06-10",
    "2026-06-10",
    1,
    2,
  ]);
  assert.deepEqual(
    calls
      .filter((call) => call.body.method !== "getToken")
      .map((call) => call.body.method),
    [
      "getStartTimeMatrix",
      "getWorkCalendar",
      "getReservedTimeIntervals",
      "getEventList",
      "getTimeframe",
    ],
  );
});

test("create endpoint books each selected time", async () => {
  resetTokenCache();

  const previousFetch = global.fetch;
  const previousEnv = {
    SIMPLYBOOK_COMPANY_LOGIN: process.env.SIMPLYBOOK_COMPANY_LOGIN,
    SIMPLYBOOK_API_KEY: process.env.SIMPLYBOOK_API_KEY,
    SIMPLYBOOK_SERVICE_ID: process.env.SIMPLYBOOK_SERVICE_ID,
    SIMPLYBOOK_PROVIDER_ID: process.env.SIMPLYBOOK_PROVIDER_ID,
    SIMPLYBOOK_PEOPLE_FIELD_NAME: process.env.SIMPLYBOOK_PEOPLE_FIELD_NAME,
    BOOKING_TIMEZONE: process.env.BOOKING_TIMEZONE,
  };
  const calls = [];

  process.env.SIMPLYBOOK_COMPANY_LOGIN = "wake";
  process.env.SIMPLYBOOK_API_KEY = "key";
  process.env.SIMPLYBOOK_SERVICE_ID = "1";
  process.env.SIMPLYBOOK_PROVIDER_ID = "2";
  process.env.SIMPLYBOOK_PEOPLE_FIELD_NAME = "people_field_hash";
  process.env.BOOKING_TIMEZONE = "UTC";

  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body });

    if (body.method === "getToken") {
      return {
        ok: true,
        json: async () => ({ result: "token" }),
      };
    }

    if (body.method === "isPaymentRequired") {
      return {
        ok: true,
        json: async () => ({ result: false }),
      };
    }

    return {
      ok: true,
      json: async () => ({
        result: {
          bookings: [
            {
              id: body.params[3],
              code: `code-${body.params[3]}`,
              start_datetime: `${body.params[2]} ${body.params[3]}`,
              is_confirmed: true,
            },
          ],
        },
      }),
    };
  };

  const req = {
    method: "POST",
    body: {
      name: "Wake Guest",
      email: "guest@example.com",
      phone: "12345678",
      peopleCount: 2,
      date: "2026-06-10",
      times: ["09:00", "10:30"],
      acceptedTerms: true,
    },
  };
  const res = {
    headers: {},
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(body) {
      this.body = body;
    },
  };

  try {
    await createHandler(req, res);
  } finally {
    global.fetch = previousFetch;

    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }

  const bookCalls = calls.filter((call) => call.body.method === "book");

  assert.equal(res.statusCode, 200);
  assert.deepEqual(
    bookCalls.map((call) => call.body.params),
    [
      [
        1,
        2,
        "2026-06-10",
        "09:00:00",
        {
          name: "Wake Guest",
          email: "guest@example.com",
          phone: "12345678",
        },
        { people_field_hash: 2 },
        1,
      ],
      [
        1,
        2,
        "2026-06-10",
        "10:30:00",
        {
          name: "Wake Guest",
          email: "guest@example.com",
          phone: "12345678",
        },
        { people_field_hash: 2 },
        1,
      ],
    ],
  );
  assert.deepEqual(
    JSON.parse(res.body).bookings.map((booking) => booking.code),
    ["code-09:00:00", "code-10:30:00"],
  );
});

test("create endpoint books one selected time for one person", async () => {
  resetTokenCache();

  const previousFetch = global.fetch;
  const previousEnv = {
    SIMPLYBOOK_COMPANY_LOGIN: process.env.SIMPLYBOOK_COMPANY_LOGIN,
    SIMPLYBOOK_API_KEY: process.env.SIMPLYBOOK_API_KEY,
    SIMPLYBOOK_SERVICE_ID: process.env.SIMPLYBOOK_SERVICE_ID,
    SIMPLYBOOK_PROVIDER_ID: process.env.SIMPLYBOOK_PROVIDER_ID,
    SIMPLYBOOK_PEOPLE_FIELD_NAME: process.env.SIMPLYBOOK_PEOPLE_FIELD_NAME,
    BOOKING_TIMEZONE: process.env.BOOKING_TIMEZONE,
  };
  const calls = [];

  process.env.SIMPLYBOOK_COMPANY_LOGIN = "wake";
  process.env.SIMPLYBOOK_API_KEY = "key";
  process.env.SIMPLYBOOK_SERVICE_ID = "1";
  process.env.SIMPLYBOOK_PROVIDER_ID = "2";
  process.env.SIMPLYBOOK_PEOPLE_FIELD_NAME = "people_field_hash";
  process.env.BOOKING_TIMEZONE = "UTC";

  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body });

    if (body.method === "getToken") {
      return {
        ok: true,
        json: async () => ({ result: "token" }),
      };
    }

    if (body.method === "isPaymentRequired") {
      return {
        ok: true,
        json: async () => ({ result: false }),
      };
    }

    return {
      ok: true,
      json: async () => ({
        result: {
          bookings: [
            {
              id: body.params[3],
              code: `code-${body.params[3]}`,
              start_datetime: `${body.params[2]} ${body.params[3]}`,
              is_confirmed: true,
            },
          ],
        },
      }),
    };
  };

  const req = {
    method: "POST",
    body: {
      name: "Wake Guest",
      email: "guest@example.com",
      phone: "12345678",
      peopleCount: 1,
      date: "2026-06-10",
      times: ["09:00"],
      acceptedTerms: true,
    },
  };
  const res = {
    headers: {},
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(body) {
      this.body = body;
    },
  };

  try {
    await createHandler(req, res);
  } finally {
    global.fetch = previousFetch;

    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }

  const bookCalls = calls.filter((call) => call.body.method === "book");

  assert.equal(res.statusCode, 200);
  assert.equal(bookCalls.length, 1);
  assert.deepEqual(bookCalls[0].body.params, [
    1,
    2,
    "2026-06-10",
    "09:00:00",
    {
      name: "Wake Guest",
      email: "guest@example.com",
      phone: "12345678",
    },
    { people_field_hash: 1 },
    1,
  ]);
  assert.deepEqual(
    JSON.parse(res.body).bookings.map((booking) => booking.code),
    ["code-09:00:00"],
  );
});

test("create endpoint returns maib checkout URL when payment is required", async () => {
  resetTokenCache();
  resetMaibTokenCache();

  const previousFetch = global.fetch;
  const previousEnv = {
    SIMPLYBOOK_COMPANY_LOGIN: process.env.SIMPLYBOOK_COMPANY_LOGIN,
    SIMPLYBOOK_API_KEY: process.env.SIMPLYBOOK_API_KEY,
    SIMPLYBOOK_SERVICE_ID: process.env.SIMPLYBOOK_SERVICE_ID,
    SIMPLYBOOK_PROVIDER_ID: process.env.SIMPLYBOOK_PROVIDER_ID,
    SIMPLYBOOK_PEOPLE_FIELD_NAME: process.env.SIMPLYBOOK_PEOPLE_FIELD_NAME,
    BOOKING_TIMEZONE: process.env.BOOKING_TIMEZONE,
  };
  const storePath = createPaymentStorePath();
  const restorePaymentEnv = setPaymentEnv(storePath);
  const calls = [];

  process.env.SIMPLYBOOK_COMPANY_LOGIN = "wake";
  process.env.SIMPLYBOOK_API_KEY = "key";
  process.env.SIMPLYBOOK_SERVICE_ID = "1";
  process.env.SIMPLYBOOK_PROVIDER_ID = "2";
  process.env.SIMPLYBOOK_PEOPLE_FIELD_NAME = "people_field_hash";
  process.env.BOOKING_TIMEZONE = "UTC";

  global.fetch = async (url, options) => {
    calls.push({
      url,
      options,
      body: options.body ? JSON.parse(options.body) : null,
    });

    if (url.endsWith("/v2/auth/token")) {
      return jsonFetchResponse({
        ok: true,
        result: {
          accessToken: "maib-token",
          expiresIn: 300,
          tokenType: "Bearer",
        },
      });
    }

    if (url.endsWith("/v2/checkouts")) {
      return jsonFetchResponse({
        ok: true,
        result: {
          checkoutId: "checkout-cart-3",
          checkoutUrl: "https://checkout.maib.test/checkout-cart-3",
        },
      });
    }

    if (options.body) {
      const body = JSON.parse(options.body);

      if (body.method === "getToken") {
        return {
          ok: true,
          json: async () => ({ result: "token" }),
        };
      }

      if (body.method === "isPaymentRequired") {
        return {
          ok: true,
          json: async () => ({ result: true }),
        };
      }

      if (body.method === "getBookingCart") {
        return {
          ok: true,
          json: async () => ({
            result: {
              cart_id: 3,
              cart_hash: "cart-hash-3",
              amount: 1200,
              currency: "MDL",
              cart: [
                {
                  id: "booking-09:00:00",
                  name: "Wakeboarding 09:00",
                  price: 600,
                  qty: 1,
                },
                {
                  id: "booking-10:00:00",
                  name: "Wakeboarding 10:00",
                  price: 600,
                  qty: 1,
                },
              ],
            },
          }),
        };
      }

      return {
        ok: true,
        json: async () => ({
          result: {
            bookings: [
              {
                id: `booking-${body.params[3]}`,
                code: `code-${body.params[3]}`,
                start_datetime: `${body.params[2]} ${body.params[3]}`,
                is_confirmed: false,
              },
            ],
            require_confirm: true,
          },
        }),
      };
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  const req = {
    method: "POST",
    body: {
      name: "Wake Guest",
      email: "guest@example.com",
      phone: "12345678",
      peopleCount: 1,
      date: "2026-06-10",
      times: ["09:00", "10:00"],
      acceptedTerms: true,
    },
  };
  const res = {
    headers: {},
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(body) {
      this.body = body;
    },
  };

  try {
    await createHandler(req, res);
  } finally {
    global.fetch = previousFetch;
    restorePaymentEnv();
    resetMaibTokenCache();

    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }

  const body = JSON.parse(res.body);
  const checkoutBody = calls.find((call) =>
    call.url.endsWith("/v2/checkouts"),
  ).body;
  const storedOrder = createPaymentStore(storePath).get("simplybook-cart-3");

  assert.equal(res.statusCode, 200);
  assert.equal(body.paymentRequired, true);
  assert.equal(body.paymentUrl, "https://checkout.maib.test/checkout-cart-3");
  assert.deepEqual(
    calls.find((call) => call.body?.method === "isPaymentRequired").body.params,
    [1],
  );
  assert.deepEqual(
    calls.find((call) => call.body?.method === "getBookingCart").body.params,
    [["booking-09:00:00", "booking-10:00:00"]],
  );
  assert.equal(
    calls.some((call) => call.body?.method === "getBookingCartPaymentPageUrl"),
    false,
  );
  assert.equal(checkoutBody.amount, 1000);
  assert.equal(checkoutBody.orderInfo.id, "simplybook-cart-3");
  assert.equal(checkoutBody.orderInfo.orderAmount, 1000);
  assert.deepEqual(checkoutBody.orderInfo.items, [
    {
      externalId: "first-sets",
      title: "Wake.md first sets",
      amount: 600,
      currency: "MDL",
      quantity: 1,
    },
    {
      externalId: "repeat-sets",
      title: "Wake.md repeat sets",
      amount: 400,
      currency: "MDL",
      quantity: 1,
    },
  ]);
  assert.equal(storedOrder.cartHash, "cart-hash-3");
  assert.equal(storedOrder.amount, 1000);
  assert.equal(storedOrder.simplybookAmount, 1200);
  assert.equal(storedOrder.pricingSource, "wakemd_formula");
  assert.equal(storedOrder.peopleCount, 1);
  assert.equal(storedOrder.setCount, 2);
  assert.equal(storedOrder.firstSetCount, 1);
  assert.equal(storedOrder.nextSetCount, 1);
});

test("create endpoint requires phone to be exactly 8 digits", async () => {
  resetTokenCache();

  const previousFetch = global.fetch;
  const cases = [
    { label: "too short", phone: "1234567" },
    { label: "too long", phone: "123456789" },
    { label: "non-digits", phone: "1234-678" },
  ];

  global.fetch = async () => {
    throw new Error("Booking validation should stop before SimplyBook.");
  };

  try {
    for (const testCase of cases) {
      const req = {
        method: "POST",
        body: {
          name: "Wake Guest",
          email: "guest@example.com",
          phone: testCase.phone,
          peopleCount: 1,
          date: "2026-06-10",
          times: ["09:00"],
          acceptedTerms: true,
        },
      };
      const res = {
        headers: {},
        setHeader(key, value) {
          this.headers[key] = value;
        },
        end(body) {
          this.body = body;
        },
      };

      await createHandler(req, res);

      const body = JSON.parse(res.body);
      assert.equal(res.statusCode, 400, testCase.label);
      assert.equal(body.error.code, "INVALID_PHONE", testCase.label);
      assert.equal(
        body.error.message,
        "Введите номер телефона из 8 цифр.",
        testCase.label,
      );
    }
  } finally {
    global.fetch = previousFetch;
  }
});

test("create endpoint requires name, email, and phone", async () => {
  resetTokenCache();

  const previousFetch = global.fetch;
  const cases = [
    {
      label: "missing name",
      patch: { name: "" },
      code: "INVALID_NAME",
      message: "Введите имя.",
    },
    {
      label: "missing email",
      patch: { email: "" },
      code: "INVALID_EMAIL",
      message: "Введите email.",
    },
    {
      label: "missing phone",
      patch: { phone: "" },
      code: "INVALID_PHONE",
      message: "Введите номер телефона.",
    },
  ];

  global.fetch = async () => {
    throw new Error("Booking validation should stop before SimplyBook.");
  };

  try {
    for (const testCase of cases) {
      const req = {
        method: "POST",
        body: {
          name: "Wake Guest",
          email: "guest@example.com",
          phone: "12345678",
          peopleCount: 1,
          date: "2026-06-10",
          times: ["09:00"],
          acceptedTerms: true,
          ...testCase.patch,
        },
      };
      const res = {
        headers: {},
        setHeader(key, value) {
          this.headers[key] = value;
        },
        end(body) {
          this.body = body;
        },
      };

      await createHandler(req, res);

      const body = JSON.parse(res.body);
      assert.equal(res.statusCode, 400, testCase.label);
      assert.equal(body.error.code, testCase.code, testCase.label);
      assert.equal(body.error.message, testCase.message, testCase.label);
    }
  } finally {
    global.fetch = previousFetch;
  }
});

test("create endpoint requires one unique selected time per person", async () => {
  resetTokenCache();

  const previousFetch = global.fetch;
  const calls = [];
  const cases = [
    { times: ["09:00"], label: "single time" },
    { times: ["09:00", "09:00"], label: "duplicate times" },
  ];

  global.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    throw new Error("Booking validation should stop before SimplyBook.");
  };

  try {
    for (const testCase of cases) {
      const req = {
        method: "POST",
        body: {
          name: "Wake Guest",
          email: "guest@example.com",
          phone: "12345678",
          peopleCount: 2,
          date: "2026-06-10",
          times: testCase.times,
          acceptedTerms: true,
        },
      };
      const res = {
        headers: {},
        setHeader(key, value) {
          this.headers[key] = value;
        },
        end(body) {
          this.body = body;
        },
      };

      await createHandler(req, res);

      const body = JSON.parse(res.body);
      assert.equal(res.statusCode, 400, testCase.label);
      assert.equal(body.error.code, "INSUFFICIENT_TIME_SLOTS", testCase.label);
      assert.equal(
        body.error.message,
        "Выберите минимум 2 слота для 2 чел.",
        testCase.label,
      );
    }
  } finally {
    global.fetch = previousFetch;
  }

  assert.equal(calls.length, 0);
});

test("maps SimplyBook slot conflicts to user-visible conflict errors", async () => {
  resetTokenCache();

  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);

    if (body.method === "getToken") {
      return {
        ok: true,
        json: async () => ({ result: "token" }),
      };
    }

    return {
      ok: true,
      json: async () => ({
        error: {
          code: -32000,
          message: "Selected time is not available",
        },
      }),
    };
  };

  await assert.rejects(
    () =>
      callSimplyBook({
        method: "book",
        params: [],
        config: {
          companyLogin: "wake",
          apiKey: "key",
          serviceId: 1,
          providerId: 2,
          timezone: "Europe/Chisinau",
        },
        fetchImpl,
      }),
    (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.message, "Selected time is not available");
      return true;
    },
  );
});

test("validates SBPay custom payment signatures", () => {
  const now = Date.UTC(2026, 4, 21, 12, 0, 0);
  const timestamp = new Date(now).toISOString();
  const payload = signSbpayPayload({
    order_id: "order-1",
    amount: "600",
    currency: "MDL",
    timestamp,
  });

  assert.deepEqual(
    validateCustomPaymentRequest({
      data: payload,
      secret: "sb-secret",
      now,
    }),
    {
      orderId: "order-1",
      algo: "sha256",
      timestamp,
    },
  );

  assert.throws(
    () =>
      validateCustomPaymentRequest({
        data: { ...payload, signature: "" },
        secret: "sb-secret",
        now,
      }),
    /Signature is not set/,
  );
  assert.throws(
    () =>
      validateCustomPaymentRequest({
        data: {
          ...payload,
          timestamp: new Date(now - 10 * 60 * 1000).toISOString(),
        },
        secret: "sb-secret",
        now,
      }),
    /Timestamp is not valid/,
  );
  assert.throws(
    () =>
      validateCustomPaymentRequest({
        data: { ...payload, amount: "700" },
        secret: "sb-secret",
        now,
      }),
    /Signature is not valid/,
  );
  assert.throws(
    () =>
      validateCustomPaymentRequest({
        data: { ...payload, algo: "md5" },
        secret: "sb-secret",
        now,
      }),
    /Algo is not valid/,
  );
});

test("validates maib callback signatures", () => {
  const now = Date.UTC(2026, 4, 21, 12, 0, 0);
  const timestamp = String(now);
  const rawBody = JSON.stringify({
    checkoutId: "checkout-1",
    orderId: "order-1",
  });
  const hexSignature = signMaibPayload({ rawBody, timestamp });
  const base64Signature = signMaibPayload({
    rawBody,
    timestamp,
    encoding: "base64",
  });

  assert.doesNotThrow(() =>
    verifyMaibCallbackSignature({
      rawBody: Buffer.from(rawBody),
      signature: `sha256=${hexSignature}`,
      timestamp,
      secret: "maib-signature",
      now,
    }),
  );
  assert.doesNotThrow(() =>
    verifyMaibCallbackSignature({
      rawBody: Buffer.from(rawBody),
      signature: base64Signature,
      timestamp,
      secret: "maib-signature",
      now,
    }),
  );
  assert.throws(
    () =>
      verifyMaibCallbackSignature({
        rawBody: Buffer.from(rawBody),
        signature: hexSignature,
        timestamp: String(now - 10 * 60 * 1000),
        secret: "maib-signature",
        now,
      }),
    /timestamp is not valid/,
  );
  assert.throws(
    () =>
      verifyMaibCallbackSignature({
        rawBody: Buffer.from(rawBody.replace("order-1", "order-2")),
        signature: hexSignature,
        timestamp,
        secret: "maib-signature",
        now,
      }),
    /signature is not valid/,
  );
});

test("SBPay payment form creates maib checkout and redirects", async () => {
  resetMaibTokenCache();

  const previousFetch = global.fetch;
  const storePath = createPaymentStorePath();
  const restoreEnv = setPaymentEnv(storePath);
  const calls = [];

  global.fetch = async (url, options) => {
    calls.push({
      url,
      method: options.method,
      headers: options.headers,
      body: options.body ? JSON.parse(options.body) : null,
    });

    if (url.endsWith("/v2/auth/token")) {
      return jsonFetchResponse({
        ok: true,
        result: {
          accessToken: "maib-token",
          expiresIn: 300,
          tokenType: "Bearer",
        },
      });
    }

    return jsonFetchResponse({
      ok: true,
      result: {
        checkoutId: "checkout-1",
        checkoutUrl: "https://checkout.maib.test/checkout-1",
      },
    });
  };

  try {
    const req = {
      method: "POST",
      headers: {
        "user-agent": "node-test",
      },
      socket: {
        remoteAddress: "127.0.0.1",
      },
      body: signSbpayPayload({
        order_id: "order-1",
        amount: "600",
        currency: "MDL",
        description: "Wakeboarding",
        return_url: "https://app.sbpay.test/return",
        cancel_url: "https://app.sbpay.test/cancel",
        customer_name: "Wake Guest",
        customer_email: "guest@example.com",
        customer_phone: "+37312345678",
      }),
    };
    const res = createMockRes();

    await sbpayFormHandler(req, res);

    assert.equal(res.statusCode, 303);
    assert.equal(res.headers.location, "https://checkout.maib.test/checkout-1");
    assert.equal(calls[0].url, "https://maib.test/v2/auth/token");
    assert.equal(calls[1].url, "https://maib.test/v2/checkouts");
    assert.equal(calls[1].headers.Authorization, "Bearer maib-token");
    assert.equal(calls[1].body.amount, 600);
    assert.equal(calls[1].body.currency, "MDL");
    assert.equal(calls[1].body.orderInfo.id, "order-1");
    assert.equal(calls[1].body.payerInfo.name, "Wake Guest");
    assert.equal(
      calls[1].body.callbackUrl,
      "https://local.example/api/payments/maib/callback",
    );

    const storedOrder = createPaymentStore(storePath).get("order-1");

    assert.equal(storedOrder.checkoutId, "checkout-1");
    assert.equal(storedOrder.amount, 600);
    assert.equal(storedOrder.status, "checkout_created");
  } finally {
    restoreEnv();
    global.fetch = previousFetch;
    resetMaibTokenCache();
  }
});

test("maib callback approves SBPay order after executed checkout", async () => {
  resetMaibTokenCache();

  const previousFetch = global.fetch;
  const storePath = createPaymentStorePath();
  const restoreEnv = setPaymentEnv(storePath);
  const store = createPaymentStore(storePath);
  const calls = [];

  store.save({
    orderId: "order-1",
    checkoutId: "checkout-1",
    amount: 600,
    currency: "MDL",
    returnUrl: "https://app.sbpay.test/return",
    cancelUrl: "https://app.sbpay.test/cancel",
    status: "checkout_created",
  });

  global.fetch = async (url, options) => {
    calls.push({
      url,
      method: options.method,
      headers: options.headers,
      body: options.body ? JSON.parse(options.body) : null,
    });

    if (url.endsWith("/v2/auth/token")) {
      return jsonFetchResponse({
        ok: true,
        result: {
          accessToken: "maib-token",
          expiresIn: 300,
          tokenType: "Bearer",
        },
      });
    }

    if (url.endsWith("/v2/checkouts/checkout-1")) {
      return jsonFetchResponse({
        ok: true,
        result: {
          id: "checkout-1",
          status: "Completed",
          order: {
            id: "order-1",
          },
          payment: {
            PaymentId: "pay-1",
            status: "Executed",
          },
        },
      });
    }

    return jsonFetchResponse(undefined);
  };

  try {
    const rawBody = JSON.stringify({
      checkoutId: "checkout-1",
      orderId: "order-1",
    });
    const timestamp = String(Date.now());
    const req = {
      method: "POST",
      headers: {
        "x-signature": `sha256=${signMaibPayload({
          rawBody,
          timestamp,
        })}`,
        "x-signature-timestamp": timestamp,
      },
      rawBody: Buffer.from(rawBody),
    };
    const res = createMockRes();

    await maibCallbackHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), { ok: true, approved: true });
    assert.equal(
      calls[2].url,
      "https://app.sbpay.test/api/order/order-1/approve",
    );
    assert.equal(calls[2].body.paymentMethod, "Maib");
    assert.equal(calls[2].body.transactionId, "pay-1");
    assert.equal(calls[2].body.algo, "sha256");
    assert.ok(calls[2].headers["X-Signature"]);

    const storedOrder = store.get("order-1");

    assert.equal(storedOrder.status, "approved");
    assert.equal(storedOrder.payId, "pay-1");
  } finally {
    restoreEnv();
    global.fetch = previousFetch;
    resetMaibTokenCache();
  }
});

test("maib callback confirms direct SimplyBook cart after executed checkout", async () => {
  resetTokenCache();
  resetMaibTokenCache();

  const previousFetch = global.fetch;
  const storePath = createPaymentStorePath();
  const restorePaymentEnv = setPaymentEnv(storePath);
  const previousEnv = {
    SIMPLYBOOK_COMPANY_LOGIN: process.env.SIMPLYBOOK_COMPANY_LOGIN,
    SIMPLYBOOK_API_KEY: process.env.SIMPLYBOOK_API_KEY,
    SIMPLYBOOK_SERVICE_ID: process.env.SIMPLYBOOK_SERVICE_ID,
    SIMPLYBOOK_PROVIDER_ID: process.env.SIMPLYBOOK_PROVIDER_ID,
    BOOKING_TIMEZONE: process.env.BOOKING_TIMEZONE,
  };
  const store = createPaymentStore(storePath);
  const calls = [];

  process.env.SIMPLYBOOK_COMPANY_LOGIN = "wake";
  process.env.SIMPLYBOOK_API_KEY = "key";
  process.env.SIMPLYBOOK_SERVICE_ID = "1";
  process.env.SIMPLYBOOK_PROVIDER_ID = "2";
  process.env.BOOKING_TIMEZONE = "UTC";

  store.save({
    orderId: "simplybook-cart-3",
    source: "simplybook_cart",
    checkoutId: "checkout-1",
    cartId: 3,
    cartHash: "cart-hash-3",
    amount: 1000,
    currency: "MDL",
    paymentProcessor: "Custom Payment",
    status: "checkout_created",
  });

  global.fetch = async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : null;

    calls.push({
      url,
      method: options.method,
      headers: options.headers,
      body,
    });

    if (url.endsWith("/v2/auth/token")) {
      return jsonFetchResponse({
        ok: true,
        result: {
          accessToken: "maib-token",
          expiresIn: 300,
          tokenType: "Bearer",
        },
      });
    }

    if (url.endsWith("/v2/checkouts/checkout-1")) {
      return jsonFetchResponse({
        ok: true,
        result: {
          id: "checkout-1",
          status: "Completed",
          order: {
            id: "simplybook-cart-3",
          },
          payment: {
            PaymentId: "pay-1",
            status: "Executed",
          },
        },
      });
    }

    if (body?.method === "getToken") {
      return {
        ok: true,
        json: async () => ({ result: "token" }),
      };
    }

    if (body?.method === "confirmBookingCart") {
      return {
        ok: true,
        json: async () => ({ result: true }),
      };
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const rawBody = JSON.stringify({
      checkoutId: "checkout-1",
      orderId: "simplybook-cart-3",
    });
    const timestamp = String(Date.now());
    const req = {
      method: "POST",
      headers: {
        "x-signature": `sha256=${signMaibPayload({
          rawBody,
          timestamp,
        })}`,
        "x-signature-timestamp": timestamp,
      },
      rawBody: Buffer.from(rawBody),
    };
    const res = createMockRes();

    await maibCallbackHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), { ok: true, approved: true });
    const checkoutCall = calls.find((call) =>
      call.url.endsWith("/v2/checkouts/checkout-1"),
    );

    assert.equal(checkoutCall.method, "GET");
    assert.equal(checkoutCall.headers["Content-Type"], undefined);
    assert.deepEqual(
      calls.find((call) => call.body?.method === "confirmBookingCart").body
        .params,
      [
        3,
        "Custom Payment",
        createCartSignature({
          cartId: 3,
          cartHash: "cart-hash-3",
          secret: "simplybook-secret",
        }),
      ],
    );
    assert.equal(
      calls.some((call) => String(call.url).includes("app.sbpay.test")),
      false,
    );

    const storedOrder = store.get("simplybook-cart-3");

    assert.equal(storedOrder.status, "approved");
    assert.equal(storedOrder.payId, "pay-1");
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    restorePaymentEnv();
    global.fetch = previousFetch;
    resetTokenCache();
    resetMaibTokenCache();
  }
});

test("maib callback does not approve failed checkout", async () => {
  resetMaibTokenCache();

  const previousFetch = global.fetch;
  const storePath = createPaymentStorePath();
  const restoreEnv = setPaymentEnv(storePath);
  const store = createPaymentStore(storePath);
  const calls = [];

  store.save({
    orderId: "order-1",
    checkoutId: "checkout-1",
    status: "checkout_created",
  });

  global.fetch = async (url, options) => {
    calls.push({
      url,
      method: options.method,
      body: options.body ? JSON.parse(options.body) : null,
    });

    if (url.endsWith("/v2/auth/token")) {
      return jsonFetchResponse({
        ok: true,
        result: {
          accessToken: "maib-token",
          expiresIn: 300,
          tokenType: "Bearer",
        },
      });
    }

    return jsonFetchResponse({
      ok: true,
      result: {
        id: "checkout-1",
        status: "Failed",
        order: {
          id: "order-1",
        },
        payment: {
          PaymentId: "pay-1",
          status: "Failed",
        },
      },
    });
  };

  try {
    const rawBody = JSON.stringify({
      checkoutId: "checkout-1",
      orderId: "order-1",
    });
    const timestamp = String(Date.now());
    const req = {
      method: "POST",
      headers: {
        "x-signature": signMaibPayload({ rawBody, timestamp }),
        "x-signature-timestamp": timestamp,
      },
      rawBody: Buffer.from(rawBody),
    };
    const res = createMockRes();

    await maibCallbackHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), { ok: true, approved: false });
    assert.equal(calls.length, 2);
    assert.equal(store.get("order-1").status, "failed");
  } finally {
    restoreEnv();
    global.fetch = previousFetch;
    resetMaibTokenCache();
  }
});

test("SBPay refund calls maib refund for stored payment id", async () => {
  resetMaibTokenCache();

  const previousFetch = global.fetch;
  const storePath = createPaymentStorePath();
  const restoreEnv = setPaymentEnv(storePath);
  const store = createPaymentStore(storePath);
  const calls = [];

  store.save({
    orderId: "order-1",
    checkoutId: "checkout-1",
    payId: "pay-1",
    amount: 600,
    currency: "MDL",
    status: "approved",
  });

  global.fetch = async (url, options) => {
    calls.push({
      url,
      method: options.method,
      headers: options.headers,
      body: options.body ? JSON.parse(options.body) : null,
    });

    if (url.endsWith("/v2/auth/token")) {
      return jsonFetchResponse({
        ok: true,
        result: {
          accessToken: "maib-token",
          expiresIn: 300,
          tokenType: "Bearer",
        },
      });
    }

    return jsonFetchResponse({
      ok: true,
      result: {
        refundId: "refund-1",
        status: "Created",
      },
    });
  };

  try {
    const req = {
      method: "POST",
      body: signSbpayPayload({
        order_id: "order-1",
        amount: "600",
        currency: "MDL",
        reason: "Client refund",
      }),
    };
    const res = createMockRes();

    await sbpayRefundHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), {
      ok: true,
      refundId: "refund-1",
      status: "Created",
    });
    assert.equal(calls[1].url, "https://maib.test/v2/payments/pay-1/refund");
    assert.equal(calls[1].body.amount, 600);
    assert.equal(calls[1].body.reason, "Client refund");
    assert.equal(store.get("order-1").status, "refunded");
    assert.equal(store.get("order-1").refundId, "refund-1");
  } finally {
    restoreEnv();
    global.fetch = previousFetch;
    resetMaibTokenCache();
  }
});

test("unsupported payment endpoints return explicit errors", () => {
  const rebillRes = createMockRes();
  const deleteRes = createMockRes();

  sbpayRebillHandler({ method: "POST" }, rebillRes);
  sbpayDeletePaymentMethodHandler({ method: "POST" }, deleteRes);

  assert.equal(rebillRes.statusCode, 501);
  assert.equal(deleteRes.statusCode, 501);
  assert.equal(
    JSON.parse(rebillRes.body).error.code,
    "PAYMENT_FEATURE_UNSUPPORTED",
  );
  assert.equal(
    JSON.parse(deleteRes.body).error.code,
    "PAYMENT_FEATURE_UNSUPPORTED",
  );
});
