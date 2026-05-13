const {
    BookingError,
    callSimplyBook,
    getConfig,
    handleError,
    isValidDate,
    json,
    normalizePeopleCount,
    toSimplyBookTime,
} = require("../_simplybook");

const readBody = async (req) => {
    if (req.body && typeof req.body === "object") return req.body;

    const chunks = [];

    for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
    }

    const rawBody = Buffer.concat(chunks).toString("utf8");

    if (!rawBody) return {};

    try {
        return JSON.parse(rawBody);
    } catch (error) {
        throw new BookingError(
            "Некорректные данные бронирования.",
            400,
            "INVALID_JSON",
        );
    }
};

const validatePayload = (body) => {
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim();
    const phone = String(body.phone || "").trim();
    const date = String(body.date || "").trim();
    const time = toSimplyBookTime(body.time);
    const peopleCount = normalizePeopleCount(body.peopleCount);

    if (!name) {
        throw new BookingError("Введите имя.", 400, "INVALID_NAME");
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new BookingError("Введите корректный email.", 400, "INVALID_EMAIL");
    }

    if (phone.replace(/\D/g, "").length < 6) {
        throw new BookingError(
            "Введите корректный номер телефона.",
            400,
            "INVALID_PHONE",
        );
    }

    if (!isValidDate(date)) {
        throw new BookingError(
            "Выберите корректную дату катания.",
            400,
            "INVALID_DATE",
        );
    }

    if (body.acceptedTerms !== true) {
        throw new BookingError(
            "Подтвердите согласие с условиями бронирования.",
            400,
            "TERMS_REQUIRED",
        );
    }

    return {
        clientData: {
            name,
            email,
            phone,
        },
        date,
        time,
        peopleCount,
    };
};

const normalizeBookingResult = (result) => {
    const bookings = Array.isArray(result?.bookings)
        ? result.bookings.map((booking) => ({
              id: booking.id,
              code: booking.code,
              startDateTime: booking.start_datetime || booking.startDateTime,
              endDateTime: booking.end_datetime || booking.endDateTime,
              isConfirmed:
                  booking.is_confirmed === undefined
                      ? booking.isConfirmed
                      : booking.is_confirmed,
          }))
        : [];

    return {
        ok: true,
        bookings,
        batchId: result?.batch?.id || null,
        requireConfirm: Boolean(result?.require_confirm),
    };
};

module.exports = async function handler(req, res) {
    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
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
        const payload = validatePayload(await readBody(req));
        const config = getConfig();
        const result = await callSimplyBook({
            method: "book",
            params: [
                config.serviceId,
                config.providerId,
                payload.date,
                payload.time,
                payload.clientData,
                {},
                payload.peopleCount,
            ],
            config,
        });

        json(res, 200, normalizeBookingResult(result));
    } catch (error) {
        handleError(res, error);
    }
};
