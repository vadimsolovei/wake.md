const {
    callSimplyBook,
    getConfig,
    getAvailabilityMonthRange,
    handleError,
    json,
    normalizeSlotMatrixDates,
} = require("../_simplybook");

const AVAILABILITY_PEOPLE_COUNT = 1;
const DATES_CACHE_TTL_MS = 60 * 1000;

const datesCache = new Map();

module.exports = async function handler(req, res) {
    if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        json(res, 405, {
            ok: false,
            error: {
                code: "METHOD_NOT_ALLOWED",
                message: "Method not allowed.",
            },
        });
        return;
    }

    try {
        const config = getConfig();
        const range = getAvailabilityMonthRange({
            year: req.query.year,
            month: req.query.month,
            timezone: config.timezone,
        });

        if (!range) {
            json(res, 200, { dates: [] });
            return;
        }

        const { firstDay, lastDay } = range;
        const cacheKey = [
            config.companyLogin,
            config.serviceId,
            config.providerId,
            config.timezone,
            firstDay,
            lastDay,
        ].join(":");
        const cached = datesCache.get(cacheKey);

        if (cached && cached.until > Date.now()) {
            json(res, 200, { dates: cached.dates });
            return;
        }

        const matrix = await callSimplyBook({
            method: "getStartTimeMatrix",
            params: [
                firstDay,
                lastDay,
                config.serviceId,
                config.providerId,
                AVAILABILITY_PEOPLE_COUNT,
            ],
            config,
        });
        const dates = normalizeSlotMatrixDates(matrix);

        datesCache.set(cacheKey, {
            until: Date.now() + DATES_CACHE_TTL_MS,
            dates,
        });

        json(res, 200, {
            dates,
        });
    } catch (error) {
        handleError(res, error);
    }
};
