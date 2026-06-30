const {
    BookingError,
    callSimplyBook,
    getConfig,
    getDateParts,
    handleError,
    isValidDate,
    json,
    normalizeServiceDuration,
    normalizeTimeframe,
    normalizeSlotMatrixTimes,
} = require("../_simplybook");

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
        const date = String(req.query.date || "");

        if (!isValidDate(date)) {
            throw new BookingError(
                "Выберите корректную дату катания.",
                400,
                "INVALID_DATE",
            );
        }

        const config = getConfig();
        const { year, month } = getDateParts(date);
        const [matrix, workCalendar, reservedIntervals, events, timeframeRaw] = await Promise.all([
            callSimplyBook({
                method: "getStartTimeMatrix",
                params: [
                    date,
                    date,
                    config.serviceId,
                    config.providerId,
                ],
                config,
            }),
            callSimplyBook({
                method: "getWorkCalendar",
                params: [year, month, config.providerId],
                config,
            }),
            callSimplyBook({
                method: "getReservedTimeIntervals",
                params: [
                    date,
                    date,
                    config.serviceId,
                    config.providerId,
                ],
                config,
            }),
            callSimplyBook({
                method: "getEventList",
                params: [],
                config,
            }),
            callSimplyBook({
                method: "getTimeframe",
                params: [],
                config,
            }),
        ]);
        const timeframe = normalizeTimeframe(timeframeRaw);

        json(res, 200, {
            times: normalizeSlotMatrixTimes(matrix, date, {
                workCalendar,
                reservedIntervals,
                serviceDuration: normalizeServiceDuration(
                    events,
                    config.serviceId,
                ),
                timeframe,
            }),
        });
    } catch (error) {
        handleError(res, error);
    }
};
