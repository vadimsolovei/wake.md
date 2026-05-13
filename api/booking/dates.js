const {
    callSimplyBook,
    getConfig,
    getMonthRange,
    handleError,
    json,
    normalizePeopleCount,
    normalizeSlotMatrixDates,
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
        const peopleCount = normalizePeopleCount(req.query.peopleCount);
        const { firstDay, lastDay } = getMonthRange({
            year: req.query.year,
            month: req.query.month,
        });
        const config = getConfig();
        const matrix = await callSimplyBook({
            method: "getStartTimeMatrix",
            params: [
                firstDay,
                lastDay,
                config.serviceId,
                config.providerId,
                peopleCount,
            ],
            config,
        });

        json(res, 200, {
            dates: normalizeSlotMatrixDates(matrix),
        });
    } catch (error) {
        handleError(res, error);
    }
};
