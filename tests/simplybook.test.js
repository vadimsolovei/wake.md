const assert = require("node:assert/strict");
const test = require("node:test");
const {
    BookingError,
    callSimplyBook,
    getAvailabilityMonthRange,
    getMonthRange,
    normalizePeopleCount,
    normalizeSlotMatrixDates,
    normalizeSlotMatrixTimes,
    normalizeTime,
    resetTokenCache,
    toSimplyBookTime,
} = require("../api/_simplybook");
const datesHandler = require("../api/booking/dates");
const timesHandler = require("../api/booking/times");

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

        return {
            ok: true,
            json: async () => ({
                result: {
                    "2026-06-10": ["09:00:00", "10:30:00"],
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
        { time: "10:30", available: true },
    ]);
    assert.deepEqual(availabilityCall.body.params, [
        "2026-06-10",
        "2026-06-10",
        1,
        2,
    ]);
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
