const assert = require("node:assert/strict");
const test = require("node:test");
const {
    BookingError,
    callSimplyBook,
    getMonthRange,
    normalizePeopleCount,
    normalizeSlotMatrixDates,
    normalizeSlotMatrixTimes,
    normalizeTime,
    resetTokenCache,
    toSimplyBookTime,
} = require("../api/_simplybook");
const datesHandler = require("../api/booking/dates");

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

test("dates endpoint returns 400 for invalid request data before env validation", async () => {
    const req = {
        method: "GET",
        query: {
            year: "2026",
            month: "5",
            peopleCount: "99",
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

    await datesHandler(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error.code, "INVALID_PEOPLE_COUNT");
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
