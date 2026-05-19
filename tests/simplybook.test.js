const assert = require("node:assert/strict");
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
    assert.throws(() => getMonthRange({ year: "2026", month: "13" }), BookingError);
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
                    result: calls.filter((call) => call.body.method === "getToken")
                        .length === 1
                        ? "token-1"
                        : "token-2",
                }),
            };
        }

        if (calls.filter((call) => call.body.method === "getStartTimeMatrix").length === 1) {
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
    assert.equal(calls.filter((call) => call.body.method === "getToken").length, 2);
    assert.equal(
        calls.at(-1).headers["X-Token"],
        "token-2",
    );
});

test("dates endpoint returns available dates for a requested month", async () => {
    resetTokenCache();

    const previousFetch = global.fetch;
    const previousEnv = {
        SIMPLYBOOK_COMPANY_LOGIN: process.env.SIMPLYBOOK_COMPANY_LOGIN,
        SIMPLYBOOK_API_KEY: process.env.SIMPLYBOOK_API_KEY,
        SIMPLYBOOK_SERVICE_ID: process.env.SIMPLYBOOK_SERVICE_ID,
        SIMPLYBOOK_PROVIDER_ID: process.env.SIMPLYBOOK_PROVIDER_ID,
        BOOKING_TIMEZONE: process.env.BOOKING_TIMEZONE,
    };
    const calls = [];

    process.env.SIMPLYBOOK_COMPANY_LOGIN = "wake";
    process.env.SIMPLYBOOK_API_KEY = "key";
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
            year: "2026",
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
    assert.deepEqual(
        JSON.parse(res.body).dates,
        [availabilityCall.body.params[0]],
    );
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
        SIMPLYBOOK_SERVICE_ID: process.env.SIMPLYBOOK_SERVICE_ID,
        SIMPLYBOOK_PROVIDER_ID: process.env.SIMPLYBOOK_PROVIDER_ID,
        BOOKING_TIMEZONE: process.env.BOOKING_TIMEZONE,
    };
    const calls = [];

    process.env.SIMPLYBOOK_COMPANY_LOGIN = "wake";
    process.env.SIMPLYBOOK_API_KEY = "key";
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
                    "2026-06-10": [
                        "09:00:00",
                        "09:20:00",
                        "10:20:00",
                    ],
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
            phone: "+373 123456",
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
                    phone: "+373 123456",
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
                    phone: "+373 123456",
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
