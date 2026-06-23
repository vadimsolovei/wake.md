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
const { getPaymentConfig } = require("../payments/_common");
const { createDirectMaibPayment } = require("../payments/direct");
const { getPhoneValidationResult } = require("../phone/_phone");

const NAME_MAX_LENGTH = 80;
const EMAIL_MAX_LENGTH = 254;
const COMMENT_MAX_LENGTH = 500;
const HTML_MARKUP_PATTERN = /[<>]/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const COMMENT_CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const EMAIL_UNSAFE_CHARACTER_PATTERN = /[<>"'\s]/;

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
    const rawEmail = String(body.email || "");
    const email = rawEmail.trim();
    const phone = String(body.phone || "").trim();
    const comment = String(body.comment || "").trim();
    const date = String(body.date || "").trim();
    const rawTimes = Array.isArray(body.times) ? body.times : [body.time];
    if (!rawTimes.length) {
        throw new BookingError(
            "Выберите корректное время катания.",
            400,
            "INVALID_TIME",
        );
    }
    const times = Array.from(
        new Set(rawTimes.map((time) => toSimplyBookTime(time))),
    );
    const peopleCount = normalizePeopleCount(body.peopleCount);

    if (times.length < peopleCount) {
        throw new BookingError(
            `Выберите минимум ${formatSlotCount(peopleCount)} для ${peopleCount} чел.`,
            400,
            "INSUFFICIENT_TIME_SLOTS",
        );
    }

    if (!name) {
        throw new BookingError("Введите имя.", 400, "INVALID_NAME");
    }

    if (name.length > NAME_MAX_LENGTH) {
        throw new BookingError(
            "Имя должно быть не длиннее 80 символов.",
            400,
            "INVALID_NAME",
        );
    }

    if (HTML_MARKUP_PATTERN.test(name)) {
        throw new BookingError(
            "Имя не должно содержать символы < или >.",
            400,
            "INVALID_NAME",
        );
    }

    if (CONTROL_CHARACTER_PATTERN.test(name)) {
        throw new BookingError(
            "Имя содержит недопустимые служебные символы.",
            400,
            "INVALID_NAME",
        );
    }

    if (!email) {
        throw new BookingError("Введите email.", 400, "INVALID_EMAIL");
    }

    if (
        rawEmail !== email ||
        email.length > EMAIL_MAX_LENGTH ||
        EMAIL_UNSAFE_CHARACTER_PATTERN.test(email) ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
        throw new BookingError("Введите корректный email.", 400, "INVALID_EMAIL");
    }

    if (comment.length > COMMENT_MAX_LENGTH) {
        throw new BookingError(
            "Комментарий должен быть не длиннее 500 символов.",
            400,
            "INVALID_COMMENT",
        );
    }

    if (HTML_MARKUP_PATTERN.test(comment)) {
        throw new BookingError(
            "Комментарий не должен содержать символы < или >.",
            400,
            "INVALID_COMMENT",
        );
    }

    if (COMMENT_CONTROL_CHARACTER_PATTERN.test(comment)) {
        throw new BookingError(
            "Комментарий содержит недопустимые служебные символы.",
            400,
            "INVALID_COMMENT",
        );
    }

    if (!phone) {
        throw new BookingError(
            "Введите номер телефона.",
            400,
            "INVALID_PHONE",
        );
    }

    const phoneValidation = getPhoneValidationResult(phone);

    if (!phoneValidation.valid) {
        throw new BookingError(
            phoneValidation.message || "Введите корректный номер телефона.",
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
            phone: phoneValidation.e164,
        },
        date,
        times,
        peopleCount,
        comment,
    };
};

const formatSlotCount = (count) => {
    const lastDigit = count % 10;
    let slotLabel = "слотов";

    if (lastDigit === 1) {
        slotLabel = "слот";
    } else if ([2, 3, 4].includes(lastDigit)) {
        slotLabel = "слота";
    }

    return `${count} ${slotLabel}`;
};

const buildAdditionalFields = ({ peopleCount, comment }, config) => {
    const additionalFields = {};

    if (config.peopleFieldName) {
        additionalFields[config.peopleFieldName] = peopleCount;
    }

    if (config.commentFieldName && comment) {
        additionalFields[config.commentFieldName] = comment;
    }

    return additionalFields;
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

const findPaymentUrlForBookings = async ({
    bookings,
    peopleCount,
    bookingConfig,
    paymentConfig,
    clientData,
    req,
}) => {
    const bookingIds = bookings.map((booking) => booking.id).filter(Boolean);

    if (!bookingIds.length) return "";

    const cart = await callSimplyBook({
        method: "getBookingCart",
        params: [bookingIds],
        config: bookingConfig,
    });

    return createDirectMaibPayment({
        cart,
        bookings,
        peopleCount,
        bookingConfig,
        paymentConfig,
        clientData,
        req,
    });
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
        // Temporary bypass for payment phase
        const BYPASS_PAYMENT = true;

        const paymentRequired = BYPASS_PAYMENT
            ? false
            : await callSimplyBook({
                  method: "isPaymentRequired",
                  params: [config.serviceId],
                  config,
              });

        const paymentConfig =
            paymentRequired && !BYPASS_PAYMENT
                ? getPaymentConfig(process.env, { requireSbpay: false })
                : null;

        if (paymentRequired && !config.apiSecretKey && !BYPASS_PAYMENT) {
            throw new BookingError(
                "Missing SimplyBook configuration: SIMPLYBOOK_API_SECRET_KEY",
                500,
                "CONFIG_ERROR",
            );
        }

        const additionalFields = buildAdditionalFields(payload, config);
        const results = [];

        for (const time of payload.times) {
            results.push(
                await callSimplyBook({
                    method: "book",
                    params: [
                        config.serviceId,
                        config.providerId,
                        payload.date,
                        time,
                        payload.clientData,
                        additionalFields,
                        1,
                    ],
                    config,
                }),
            );
        }

        const result =
            results.length === 1
                ? results[0]
                : {
                      bookings: results.flatMap(
                          (bookingResult) => bookingResult?.bookings || [],
                      ),
                      require_confirm: results.some((bookingResult) =>
                          Boolean(bookingResult?.require_confirm),
                      ),
                  };

        const responseBody = normalizeBookingResult(result);
        const paymentUrl =
            paymentRequired && !BYPASS_PAYMENT
                ? await findPaymentUrlForBookings({
                      bookings: responseBody.bookings,
                      peopleCount: payload.peopleCount,
                      bookingConfig: config,
                      paymentConfig,
                      clientData: payload.clientData,
                      req,
                  })
                : "";

        json(res, 200, {
            ...responseBody,
            paymentRequired: Boolean(paymentUrl),
            paymentUrl,
        });
    } catch (error) {
        handleError(res, error);
    }
};
