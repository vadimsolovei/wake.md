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
        serviceId: Number(env.SIMPLYBOOK_SERVICE_ID),
        providerId: Number(env.SIMPLYBOOK_PROVIDER_ID),
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

const normalizeSlotMatrixTimes = (matrix, date) => {
    const values = matrix?.[date];

    if (!Array.isArray(values)) return [];

    return values
        .map(normalizeTime)
        .filter(Boolean)
        .map((time) => ({ time, available: true }));
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
    callSimplyBook,
    getConfig,
    getAvailabilityMonthRange,
    getMonthRange,
    handleError,
    isValidDate,
    json,
    normalizePeopleCount,
    normalizeSlotMatrixDates,
    normalizeSlotMatrixTimes,
    normalizeTime,
    resetTokenCache,
    toSimplyBookTime,
};
