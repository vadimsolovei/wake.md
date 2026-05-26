const LOGIN_URL = "https://user-api.simplybook.me/login";
const API_URL = "https://user-api.simplybook.me";

let cachedToken = "";
let cachedTokenConfigKey = "";
let cachedTokenPromise = null;
let cachedTokenPromiseConfigKey = "";

class BookingError extends Error {
    constructor(message, status = 500, code = "BOOKING_ERROR") {
        super(message);
        this.name = "BookingError";
        this.status = status;
        this.code = code;
    }
}

const json = (res, status, body) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
};

const getConfig = (env = process.env) => {
    const config = {
        companyLogin: env.SIMPLYBOOK_COMPANY_LOGIN,
        apiKey: env.SIMPLYBOOK_API_KEY,
        apiSecretKey: env.SIMPLYBOOK_API_SECRET_KEY || "",
        paymentProcessorName:
            env.SIMPLYBOOK_PAYMENT_PROCESSOR_NAME || "Custom Payment",
        serviceId: Number(env.SIMPLYBOOK_SERVICE_ID),
        providerId: Number(env.SIMPLYBOOK_PROVIDER_ID),
        peopleFieldName: env.SIMPLYBOOK_PEOPLE_FIELD_NAME || "",
        timezone: env.BOOKING_TIMEZONE || "Europe/Chisinau",
    };

    const missing = [];

    if (!config.companyLogin) missing.push("SIMPLYBOOK_COMPANY_LOGIN");
    if (!config.apiKey) missing.push("SIMPLYBOOK_API_KEY");
    if (!Number.isInteger(config.serviceId) || config.serviceId <= 0) {
        missing.push("SIMPLYBOOK_SERVICE_ID");
    }
    if (!Number.isInteger(config.providerId) || config.providerId <= 0) {
        missing.push("SIMPLYBOOK_PROVIDER_ID");
    }
    if (missing.length) {
        throw new BookingError(
            `Missing SimplyBook configuration: ${missing.join(", ")}`,
            500,
            "CONFIG_ERROR",
        );
    }

    return config;
};

const rpcRequest = async ({
    url,
    method,
    params = [],
    headers = {},
    fetchImpl = fetch,
}) => {
    const response = await fetchImpl(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...headers,
        },
        body: JSON.stringify({
            jsonrpc: "2.0",
            method,
            params,
            id: Date.now(),
        }),
    });

    let data = null;

    try {
        data = await response.json();
    } catch (error) {
        throw new BookingError(
            "SimplyBook returned an unreadable response.",
            502,
            "UPSTREAM_RESPONSE_ERROR",
        );
    }

    if (!response.ok || data?.error) {
        const message =
            data?.error?.message ||
            data?.message ||
            "SimplyBook request failed.";
        const code = data?.error?.code || response.status;
        const lowerMessage = String(message).toLowerCase();
        let status = 502;

        if (
            lowerMessage.includes("not available") ||
            lowerMessage.includes("already") ||
            lowerMessage.includes("busy") ||
            lowerMessage.includes("slot")
        ) {
            status = 409;
        } else if (
            lowerMessage.includes("invalid") ||
            lowerMessage.includes("required") ||
            lowerMessage.includes("missed") ||
            lowerMessage.includes("missing")
        ) {
            status = 400;
        }

        throw new BookingError(message, status, String(code));
    }

    return data.result;
};

const getToken = async ({ config, fetchImpl = fetch, forceRefresh = false }) => {
    const configKey = `${config.companyLogin}:${config.apiKey}`;

    if (!forceRefresh && cachedToken && cachedTokenConfigKey === configKey) {
        return cachedToken;
    }

    if (
        !forceRefresh &&
        cachedTokenPromise &&
        cachedTokenPromiseConfigKey === configKey
    ) {
        return cachedTokenPromise;
    }

    cachedTokenPromiseConfigKey = configKey;
    cachedTokenPromise = rpcRequest({
        url: LOGIN_URL,
        method: "getToken",
        params: [config.companyLogin, config.apiKey],
        fetchImpl,
    })
        .then((token) => {
            if (!token || typeof token !== "string") {
                throw new BookingError(
                    "SimplyBook authentication did not return a token.",
                    502,
                    "AUTH_RESPONSE_ERROR",
                );
            }

            cachedToken = token;
            cachedTokenConfigKey = configKey;

            return cachedToken;
        })
        .finally(() => {
            cachedTokenPromise = null;
            cachedTokenPromiseConfigKey = "";
        });

    return cachedTokenPromise;
};

const callSimplyBook = async ({
    method,
    params = [],
    config = getConfig(),
    fetchImpl = fetch,
}) => {
    const doRequest = async (forceRefresh = false) => {
        const token = await getToken({ config, fetchImpl, forceRefresh });

        return rpcRequest({
            url: API_URL,
            method,
            params,
            headers: {
                "X-Company-Login": config.companyLogin,
                "X-Token": token,
            },
            fetchImpl,
        });
    };

    try {
        return await doRequest(false);
    } catch (error) {
        const code = String(error?.code || "").toLowerCase();
        const message = String(error?.message || "").toLowerCase();
        const isAuthError =
            code.includes("401") ||
            code.includes("403") ||
            message.includes("token") ||
            message.includes("auth");

        if (!isAuthError) throw error;

        cachedToken = "";
        cachedTokenConfigKey = "";
        cachedTokenPromise = null;
        cachedTokenPromiseConfigKey = "";

        return doRequest(true);
    }
};

const isIsoDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value);

const isValidDate = (value) => {
    if (!isIsoDate(value)) return false;

    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));

    return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
    );
};

const normalizePeopleCount = (value) => {
    const peopleCount = Number(value);

    if (!Number.isInteger(peopleCount) || peopleCount < 1 || peopleCount > 8) {
        throw new BookingError(
            "Количество человек должно быть от 1 до 8.",
            400,
            "INVALID_PEOPLE_COUNT",
        );
    }

    return peopleCount;
};

const normalizeTime = (value) => {
    if (typeof value !== "string") return "";

    const match = value.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);

    if (!match) return "";

    return `${match[1]}:${match[2]}`;
};

const timeToMinutes = (time) => {
    const normalized = normalizeTime(time);

    if (!normalized) return null;

    const [hours, minutes] = normalized.split(":").map(Number);

    if (hours > 23 || minutes > 59) return null;

    return hours * 60 + minutes;
};

const minutesToTime = (minutes) => {
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;

    return `${String(hours).padStart(2, "0")}:${String(remainder).padStart(
        2,
        "0",
    )}`;
};

const buildSlotTimes = ({ startTime, endTime, intervalMinutes }) => {
    const start = timeToMinutes(startTime);
    const end = timeToMinutes(endTime);

    if (
        start === null ||
        end === null ||
        end < start ||
        !Number.isInteger(intervalMinutes) ||
        intervalMinutes < 1
    ) {
        return [];
    }

    const times = [];

    for (let minutes = start; minutes < end; minutes += intervalMinutes) {
        times.push(minutesToTime(minutes));
    }

    return times;
};

const greatestCommonDivisor = (first, second) => {
    let a = Math.abs(first);
    let b = Math.abs(second);

    while (b) {
        const next = a % b;
        a = b;
        b = next;
    }

    return a;
};

const inferSlotIntervalMinutes = (times) => {
    const minutes = Array.from(
        new Set(times.map(timeToMinutes).filter((value) => value !== null)),
    ).sort((first, second) => first - second);

    const intervals = minutes
        .slice(1)
        .map((value, index) => value - minutes[index])
        .filter((value) => value > 0);

    if (!intervals.length) return null;

    return intervals.reduce(greatestCommonDivisor);
};

const buildSlotTimesFromPattern = ({
    patternTimes,
    startTime,
    endTime,
    fallbackIntervalMinutes,
}) => {
    const start = timeToMinutes(startTime);
    const end = timeToMinutes(endTime);
    const patternStart = patternTimes
        .map(timeToMinutes)
        .filter((value) => value !== null)
        .sort((first, second) => first - second)[0];
    const intervalMinutes =
        inferSlotIntervalMinutes(patternTimes) || fallbackIntervalMinutes;

    if (
        start === null ||
        end === null ||
        patternStart === undefined ||
        !Number.isInteger(intervalMinutes) ||
        intervalMinutes < 1
    ) {
        return buildSlotTimes({
            startTime,
            endTime,
            intervalMinutes,
        });
    }

    let firstSlot = patternStart;

    while (firstSlot - intervalMinutes >= start) {
        firstSlot -= intervalMinutes;
    }

    while (firstSlot < start) {
        firstSlot += intervalMinutes;
    }

    const times = [];

    for (let minutes = firstSlot; minutes < end; minutes += intervalMinutes) {
        times.push(minutesToTime(minutes));
    }

    return times;
};

const normalizeTimeframe = (value) => {
    const timeframe = Number(value);

    if (!Number.isInteger(timeframe) || timeframe < 1 || timeframe > 180) {
        throw new BookingError(
            "SimplyBook returned an invalid timeframe.",
            502,
            "UPSTREAM_TIMEFRAME_ERROR",
        );
    }

    return timeframe;
};

const normalizeServiceDuration = (events, serviceId) => {
    const values = Array.isArray(events)
        ? events
        : events && typeof events === "object"
          ? Object.values(events)
          : [];
    const service = values.find((event) => Number(event?.id) === serviceId);
    const duration = Number(service?.duration);

    if (!Number.isInteger(duration) || duration < 1 || duration > 1440) {
        return null;
    }

    return duration;
};

const toSimplyBookTime = (value) => {
    const time = normalizeTime(value);

    if (!time) {
        throw new BookingError(
            "Выберите корректное время катания.",
            400,
            "INVALID_TIME",
        );
    }

    return `${time}:00`;
};

const getMonthRange = ({ year, month }) => {
    const numericYear = Number(year);
    const numericMonth = Number(month);

    if (
        !Number.isInteger(numericYear) ||
        numericYear < 2000 ||
        numericYear > 2100 ||
        !Number.isInteger(numericMonth) ||
        numericMonth < 1 ||
        numericMonth > 12
    ) {
        throw new BookingError(
            "Некорректный месяц для проверки доступности.",
            400,
            "INVALID_MONTH",
        );
    }

    const first = new Date(Date.UTC(numericYear, numericMonth - 1, 1));
    const last = new Date(Date.UTC(numericYear, numericMonth, 0));
    const format = (date) => date.toISOString().slice(0, 10);

    return {
        firstDay: format(first),
        lastDay: format(last),
    };
};

const formatDateInTimezone = (date, timeZone) => {
    const parts = new Intl.DateTimeFormat("en", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date);
    const values = Object.fromEntries(
        parts
            .filter((part) => part.type !== "literal")
            .map((part) => [part.type, part.value]),
    );

    return `${values.year}-${values.month}-${values.day}`;
};

const maxIsoDate = (firstDate, secondDate) =>
    firstDate > secondDate ? firstDate : secondDate;

const getAvailabilityMonthRange = ({
    year,
    month,
    timezone = "Europe/Chisinau",
    now = new Date(),
}) => {
    const today = formatDateInTimezone(now, timezone);
    const [todayYear, todayMonth] = today.split("-").map(Number);
    const numericYear = year === undefined ? todayYear : Number(year);
    const numericMonth = month === undefined ? todayMonth : Number(month);

    const range = getMonthRange({
        year: numericYear,
        month: numericMonth,
    });

    if (range.lastDay < today) return null;

    return {
        firstDay: maxIsoDate(range.firstDay, today),
        lastDay: range.lastDay,
    };
};

const normalizeSlotMatrixDates = (matrix) => {
    if (!matrix || typeof matrix !== "object") return [];

    return Object.keys(matrix)
        .filter((date) => Array.isArray(matrix[date]) && matrix[date].length)
        .sort();
};

const getDateParts = (date) => {
    const [year, month] = date.split("-").map(Number);

    return { year, month };
};

const normalizeWorkCalendarTimes = (workCalendar, date, intervalMinutes) => {
    const day = workCalendar?.[date];

    if (!day || Number(day.is_day_off) === 1) return [];

    return buildSlotTimes({
        startTime: day.from,
        endTime: day.to,
        intervalMinutes,
    });
};

const normalizePatternWorkCalendarTimes = ({
    workCalendar,
    date,
    patternTimes,
    fallbackIntervalMinutes,
}) => {
    const day = workCalendar?.[date];

    if (!day || Number(day.is_day_off) === 1) return [];

    return buildSlotTimesFromPattern({
        patternTimes,
        startTime: day.from,
        endTime: day.to,
        fallbackIntervalMinutes,
    });
};

const normalizeIntervalTime = (value, date) => {
    if (typeof value !== "string") return "";

    if (value.includes(date)) {
        const match = value.match(/\d{4}-\d{2}-\d{2}[ T](\d{2}:\d{2})(?::\d{2})?/);

        return match ? match[1] : "";
    }

    return normalizeTime(value);
};

const pickIntervalTime = (interval, date, keys) => {
    for (const key of keys) {
        const time = normalizeIntervalTime(interval?.[key], date);

        if (time) return time;
    }

    return "";
};

const normalizeReservedIntervalTimes = (
    reservedIntervals,
    date,
    intervalMinutes,
) => {
    const values = Array.isArray(reservedIntervals)
        ? reservedIntervals
        : reservedIntervals?.[date];

    if (!Array.isArray(values)) return [];

    return values.flatMap((interval) => {
        const startTime = pickIntervalTime(interval, date, [
            "from",
            "start",
            "start_time",
            "startTime",
            "start_datetime",
            "startDateTime",
            "time_from",
        ]);
        const endTime = pickIntervalTime(interval, date, [
            "to",
            "end",
            "end_time",
            "endTime",
            "end_datetime",
            "endDateTime",
            "time_to",
        ]);

        return buildSlotTimes({
            startTime,
            endTime,
            intervalMinutes,
        });
    });
};

const getReservedIntervalValues = (reservedIntervals, date) => {
    const values = Array.isArray(reservedIntervals)
        ? reservedIntervals
        : reservedIntervals?.[date];

    return Array.isArray(values) ? values : [];
};

const normalizeReservedIntervalStartTimes = (reservedIntervals, date) =>
    getReservedIntervalValues(reservedIntervals, date)
        .map((interval) =>
            pickIntervalTime(interval, date, [
                "from",
                "start",
                "start_time",
                "startTime",
                "start_datetime",
                "startDateTime",
                "time_from",
            ]),
        )
        .filter(Boolean);

const normalizeSlotMatrixTimes = (matrix, date, options = {}) => {
    const values = Array.isArray(matrix?.[date]) ? matrix[date] : [];

    const normalizedAvailableTimes = values.map(normalizeTime).filter(Boolean);
    const reservedStartTimes = options.reservedIntervals
        ? normalizeReservedIntervalStartTimes(options.reservedIntervals, date)
        : [];
    const patternTimes = [
        ...normalizedAvailableTimes,
        ...reservedStartTimes,
    ];
    const availableTimes = new Set(normalizedAvailableTimes);
    const intervalMinutes =
        inferSlotIntervalMinutes(patternTimes) ||
        options.serviceDuration ||
        (options.timeframe === undefined
            ? options.intervalMinutes
            : normalizeTimeframe(options.timeframe));
    const workCalendarTimes =
        options.workCalendar && intervalMinutes
            ? normalizePatternWorkCalendarTimes({
                  workCalendar: options.workCalendar,
                  date,
                  patternTimes,
                  fallbackIntervalMinutes: intervalMinutes,
              })
            : [];
    const reservedTimes =
        options.reservedIntervals && intervalMinutes
            ? normalizeReservedIntervalTimes(
                  options.reservedIntervals,
                  date,
                  intervalMinutes,
              )
            : [];
    const configuredTimes =
        options.includeUnavailable === true
            ? buildSlotTimes({
                  startTime: options.startTime,
                  endTime: options.endTime,
                  intervalMinutes,
              })
            : [];
    const displayTimes =
        workCalendarTimes.length || configuredTimes.length
            ? [...workCalendarTimes, ...configuredTimes]
            : [...reservedTimes, ...availableTimes];
    const allTimes = Array.from(new Set(displayTimes))
        .map((time) => ({
            time,
            minutes: timeToMinutes(time),
        }))
        .filter(({ minutes }) => minutes !== null)
        .sort((first, second) => first.minutes - second.minutes);

    return allTimes.map(({ time }) => ({
        time,
        available: availableTimes.has(time),
    }));
};

const handleError = (res, error) => {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    const safeMessage =
        status >= 500
            ? "Сервис бронирования временно недоступен. Попробуйте позже."
            : error.message;

    json(res, status, {
        ok: false,
        error: {
            code: error?.code || "BOOKING_ERROR",
            message: safeMessage,
        },
    });
};

const resetTokenCache = () => {
    cachedToken = "";
    cachedTokenConfigKey = "";
    cachedTokenPromise = null;
    cachedTokenPromiseConfigKey = "";
};

module.exports = {
    BookingError,
    buildSlotTimes,
    buildSlotTimesFromPattern,
    callSimplyBook,
    getConfig,
    getAvailabilityMonthRange,
    getDateParts,
    getMonthRange,
    handleError,
    isValidDate,
    json,
    normalizeTimeframe,
    inferSlotIntervalMinutes,
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
};
