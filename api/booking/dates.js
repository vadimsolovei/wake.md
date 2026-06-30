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
        let year = req.query.year;
        let month = req.query.month;

        if (year === undefined || month === undefined) {
            try {
                const firstWorkingDate = await callSimplyBook({
                    method: "getFirstWorkingDay",
                    params: [config.providerId],
                    config,
                });

                if (firstWorkingDate && typeof firstWorkingDate === "string") {
                    const parts = firstWorkingDate.split("-");
                    if (parts.length === 3) {
                        year = parts[0];
                        month = parts[1];
                    }
                }
            } catch (err) {
                // Fallback to current month if SimplyBook query fails
            }
        }

        let resolvedYear = year;
        let resolvedMonth = month;
        if (resolvedYear === undefined || resolvedMonth === undefined) {
            const timeZone = config.timezone || "Europe/Chisinau";
            const parts = new Intl.DateTimeFormat("en", {
                timeZone,
                year: "numeric",
                month: "2-digit",
            }).formatToParts(new Date());
            const values = Object.fromEntries(
                parts
                    .filter((part) => part.type !== "literal")
                    .map((part) => [part.type, part.value]),
            );
            resolvedYear = Number(values.year);
            resolvedMonth = Number(values.month);
        } else {
            resolvedYear = Number(resolvedYear);
            resolvedMonth = Number(resolvedMonth);
        }

        const range = getAvailabilityMonthRange({
            year: resolvedYear,
            month: resolvedMonth,
            timezone: config.timezone,
        });

        if (!range) {
            json(res, 200, {
                dates: [],
                year: resolvedYear,
                month: resolvedMonth,
            });
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
            json(res, 200, {
                dates: cached.dates,
                year: resolvedYear,
                month: resolvedMonth,
            });
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
            year: resolvedYear,
            month: resolvedMonth,
        });
    } catch (error) {
        handleError(res, error);
    }
};
