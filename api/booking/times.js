const {
    BookingError,
    callSimplyBook,
    getConfig,
    handleError,
    isValidDate,
    json,
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
        const matrix = await callSimplyBook({
            method: "getStartTimeMatrix",
            params: [
                date,
                date,
                config.serviceId,
                config.providerId,
            ],
            config,
        });

        json(res, 200, {
            times: normalizeSlotMatrixTimes(matrix, date),
        });
    } catch (error) {
        handleError(res, error);
    }
};
