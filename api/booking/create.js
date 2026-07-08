const crypto = require("node:crypto");
const {
    BookingError,
    callSimplyBook,
    callSimplyBookAdmin,
    getConfig,
    handleError,
    isValidDate,
    json,
    normalizeServiceDuration,
    normalizeTimeframe,
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
    const paymentMode = String(body.paymentMode || "book").trim();
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

    if (!["book", "pay"].includes(paymentMode)) {
        throw new BookingError(
            "Некорректный способ бронирования.",
            400,
            "INVALID_PAYMENT_MODE",
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
        paymentMode,
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

const createBookingSignature = ({ bookingId, bookingHash, secret }) =>
    crypto
        .createHash("md5")
        .update(`${bookingId}${bookingHash}${secret}`)
        .digest("hex");

const createBatchSignature = ({ batchId, batchHash, secret }) =>
    crypto
        .createHash("md5")
        .update(`${batchId}${batchHash}${secret}`)
        .digest("hex");

const logSimplyBookBatch = (message, details = {}) => {
    console.info("[booking:create] " + message, details);
};

const hasAdminBookingConfig = (config) =>
    Boolean(config.adminUserLogin && config.adminUserPassword);

const timeToMinutes = (time) => {
    const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(time || ""));

    if (!match) return null;

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3] || 0);

    if (
        hours < 0 ||
        hours > 23 ||
        minutes < 0 ||
        minutes > 59 ||
        seconds < 0 ||
        seconds > 59
    ) {
        return null;
    }

    return hours * 60 + minutes;
};

const minutesToTime = (minutes) => {
    const normalizedMinutes = ((minutes % 1440) + 1440) % 1440;
    const hours = Math.floor(normalizedMinutes / 60);
    const mins = normalizedMinutes % 60;

    return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:00`;
};

const sortBookingTimes = (times) =>
    [...times].sort(
        (first, second) => timeToMinutes(first) - timeToMinutes(second),
    );

const addMinutesToBookingDateTime = ({ date, time, minutes }) => {
    const [year, month, day] = date.split("-").map(Number);
    const startMinutes = timeToMinutes(time);
    const start = new Date(
        Date.UTC(year, month - 1, day, 0, startMinutes, 0, 0),
    );
    const end = new Date(start.getTime() + minutes * 60 * 1000);
    const endYear = end.getUTCFullYear();
    const endMonth = String(end.getUTCMonth() + 1).padStart(2, "0");
    const endDay = String(end.getUTCDate()).padStart(2, "0");

    return {
        date: `${endYear}-${endMonth}-${endDay}`,
        time: minutesToTime(end.getUTCHours() * 60 + end.getUTCMinutes()),
    };
};

const getConsecutiveBatchStart = async ({ times, config }) => {
    if (times.length <= 1) return null;

    const sortedTimes = sortBookingTimes(times);
    const values = sortedTimes.map(timeToMinutes);

    if (values.some((value) => value === null)) return null;

    let timeframe = null;

    try {
        timeframe = normalizeTimeframe(
            await callSimplyBook({
                method: "getTimeframe",
                params: [],
                config,
            }),
        );
    } catch (error) {
        logSimplyBookBatch("could not verify timeframe for count batch", {
            message: error.message,
            code: error.code,
            status: error.status,
        });

        return null;
    }

    const isConsecutive = values.every(
        (value, index) => index === 0 || value - values[index - 1] === timeframe,
    );

    if (!isConsecutive) {
        logSimplyBookBatch("selected times are not consecutive", {
            times: sortedTimes,
            timeframe,
        });

        return null;
    }

    return {
        time: sortedTimes[0],
        count: sortedTimes.length,
        timeframe,
    };
};

const getBatchInfo = (result, config) => {
    const batch = result?.batch || {};
    const batchId =
        batch.id ||
        batch.batch_id ||
        batch.batchId ||
        result?.id ||
        result?.batch_id ||
        result?.batchId ||
        null;
    const batchHash =
        batch.hash ||
        batch.batch_hash ||
        batch.batchHash ||
        result?.hash ||
        result?.batch_hash ||
        result?.batchHash ||
        null;
    const batchType =
        batch.type ||
        batch.batch_type ||
        batch.batchType ||
        result?.batch_type ||
        result?.batchType ||
        config.bookingBatchType;

    return {
        id: batchId,
        hash: batchHash,
        type: batchType,
    };
};

const getCreatedBatchInfo = (result, config) => {
    if (typeof result === "number" || typeof result === "string") {
        return {
            id: result || null,
            hash: null,
            type: config.bookingBatchType,
        };
    }

    return getBatchInfo(result, config);
};

const getBookingDedupeKey = (booking) =>
    booking?.id ||
    booking?.code ||
    booking?.booking_id ||
    booking?.bookingId ||
    booking?.start_datetime ||
    booking?.startDateTime ||
    null;

const dedupeBookings = (bookings) => {
    const seen = new Set();
    const deduped = [];

    for (const booking of bookings) {
        const key = getBookingDedupeKey(booking);

        if (key) {
            if (seen.has(key)) continue;
            seen.add(key);
        }

        deduped.push(booking);
    }

    return deduped;
};

const combineBookingResults = (results, createdBatch) => {
    if (results.length === 1) return results[0];

    const batchResult = results.find((bookingResult) => {
        const batchInfo = getBatchInfo(bookingResult, {});

        return batchInfo.id || batchInfo.hash;
    });
    const batchInfo = getBatchInfo(batchResult || {}, {
        bookingBatchType: createdBatch?.type,
    });

    return {
        bookings: dedupeBookings(
            results.flatMap((bookingResult) => bookingResult?.bookings || []),
        ),
        require_confirm: results.some((bookingResult) =>
            Boolean(bookingResult?.require_confirm),
        ),
        batch: batchResult?.batch || null,
        batch_id: batchInfo.id || createdBatch?.id || null,
        batch_hash: batchInfo.hash || createdBatch?.hash || null,
        batch_type: batchInfo.type || createdBatch?.type || null,
    };
};

const normalizeClientSearchValues = (client) => ({
    id: client?.id || client?.client_id || client?.clientId || null,
    email: String(client?.email || "").trim().toLowerCase(),
    phone: String(client?.phone || "").replace(/\D/g, ""),
});

const findClientInList = (clients, clientData) => {
    const values = Array.isArray(clients)
        ? clients
        : clients && typeof clients === "object"
          ? Object.values(clients)
          : [];
    const email = String(clientData.email || "").trim().toLowerCase();
    const phone = String(clientData.phone || "").replace(/\D/g, "");

    return values.find((client) => {
        const normalized = normalizeClientSearchValues(client);

        return (
            normalized.id &&
            ((email && normalized.email === email) ||
                (phone && normalized.phone === phone))
        );
    });
};

const findAdminClient = async ({ clientData, config }) => {
    const searches = [clientData.email, clientData.phone].filter(Boolean);

    for (const search of searches) {
        const clients = await callSimplyBookAdmin({
            method: "getClientList",
            params: [search, 10],
            config,
        });
        const client = findClientInList(clients, clientData);
        const clientId = normalizeClientSearchValues(client).id;

        if (clientId) return clientId;
    }

    return null;
};

const ensureAdminClient = async ({ clientData, config }) => {
    const existingClientId = await findAdminClient({ clientData, config });

    if (existingClientId) {
        logSimplyBookBatch("reusing admin client", {
            clientId: existingClientId,
        });

        await callSimplyBookAdmin({
            method: "editClient",
            params: [existingClientId, clientData],
            config,
        });

        logSimplyBookBatch("updated admin client", {
            clientId: existingClientId,
        });

        return existingClientId;
    }

    const createdClientId = await callSimplyBookAdmin({
        method: "addClient",
        params: [clientData, false],
        config,
    });

    if (!createdClientId) {
        throw new BookingError(
            "SimplyBook admin API did not return a client id.",
            502,
            "UPSTREAM_CLIENT_ERROR",
        );
    }

    logSimplyBookBatch("created admin client", {
        clientId: createdClientId,
    });

    return createdClientId;
};

const getServiceDuration = async ({ config }) =>
    normalizeServiceDuration(
        await callSimplyBook({
            method: "getEventList",
            params: [],
            config,
        }),
        config.serviceId,
    ) || 15;

const createAdminBatchBookings = async ({
    payload,
    additionalFields,
    config,
}) => {
    const clientId = await ensureAdminClient({
        clientData: payload.clientData,
        config,
    });
    const serviceDuration = await getServiceDuration({ config });

    logSimplyBookBatch("admin createBatch request", {});

    const createdBatch = getCreatedBatchInfo(
        await callSimplyBookAdmin({
            method: "createBatch",
            params: [],
            config,
        }),
        config,
    );

    logSimplyBookBatch("admin createBatch response", {
        batchId: createdBatch.id,
        hasBatchHash: Boolean(createdBatch.hash),
        batchType: createdBatch.type,
    });

    if (!createdBatch.id) {
        throw new BookingError(
            "SimplyBook admin API did not return a batch id.",
            502,
            "UPSTREAM_BATCH_ERROR",
        );
    }

    const results = [];

    for (const time of payload.times) {
        const end = addMinutesToBookingDateTime({
            date: payload.date,
            time,
            minutes: serviceDuration,
        });
        const params = [
            config.serviceId,
            config.providerId,
            clientId,
            payload.date,
            time,
            end.date,
            end.time,
            0,
            additionalFields,
            1,
            createdBatch.id,
        ];

        logSimplyBookBatch("admin book request", {
            slotIndex: results.length + 1,
            totalSlots: payload.times.length,
            date: payload.date,
            time,
            clientId,
            batchId: createdBatch.id,
            paramsLength: params.length,
        });

        const bookingResult = await callSimplyBookAdmin({
            method: "book",
            params,
            config,
        });
        const bookingBatch = getBatchInfo(bookingResult, config);

        results.push(bookingResult);

        logSimplyBookBatch("admin book response", {
            slotIndex: results.length,
            totalSlots: payload.times.length,
            bookingCount: Array.isArray(bookingResult?.bookings)
                ? bookingResult.bookings.length
                : 0,
            requireConfirm: Boolean(bookingResult?.require_confirm),
            returnedBatchId: bookingBatch.id,
            hasBatchHash: Boolean(bookingBatch.hash),
            batchType: bookingBatch.type,
        });
    }

    return {
        result: combineBookingResults(results, createdBatch),
        mode: "adminBatch",
    };
};

const createPublicCountBatchBooking = async ({
    payload,
    additionalFields,
    config,
    countBatch,
}) => {
    const params = [
        config.serviceId,
        config.providerId,
        payload.date,
        countBatch.time,
        payload.clientData,
        additionalFields,
        countBatch.count,
    ];

    logSimplyBookBatch("public count batch book request", {
        date: payload.date,
        time: countBatch.time,
        count: countBatch.count,
        timeframe: countBatch.timeframe,
        paramsLength: params.length,
    });

    const result = await callSimplyBook({
        method: "book",
        params,
        config,
    });
    const batch = getBatchInfo(result, config);

    logSimplyBookBatch("public count batch book response", {
        bookingCount: Array.isArray(result?.bookings) ? result.bookings.length : 0,
        requireConfirm: Boolean(result?.require_confirm),
        returnedBatchId: batch.id,
        hasBatchHash: Boolean(batch.hash),
        batchType: batch.type,
    });

    return {
        result,
        mode: "publicCountBatch",
    };
};

const normalizeBookingResult = (result, config) => {
    const batch = getBatchInfo(result, config);
    const bookings = Array.isArray(result?.bookings)
        ? result.bookings.map((booking) => ({
              id: booking.id,
              code: booking.code,
              hash: booking.hash,
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
        batchId: batch.id,
        batchHash: batch.hash,
        batchType: batch.type,
        batchBookingUsed: Boolean(batch.id && bookings.length > 1),
        batchNotificationFallback: Boolean(
            (!batch.id || !batch.hash) && bookings.length > 1,
        ),
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

const confirmRequiredBookings = async ({ responseBody, config }) => {
    const needsConfirmation =
        responseBody.requireConfirm ||
        responseBody.bookings.some((booking) => booking.isConfirmed !== true);

    if (!needsConfirmation) return responseBody;

    const bookingIds = responseBody.bookings
        .map((booking) => booking.id)
        .filter(Boolean);

    if (!bookingIds.length) return responseBody;

    if (!config.apiSecretKey) {
        throw new BookingError(
            "Missing SimplyBook configuration: SIMPLYBOOK_API_SECRET_KEY",
            500,
            "CONFIG_ERROR",
        );
    }

    if (
        responseBody.bookings.length > 1 &&
        responseBody.batchId &&
        responseBody.batchHash
    ) {
        logSimplyBookBatch("confirming batch", {
            batchId: responseBody.batchId,
            batchType: responseBody.batchType,
            bookingCount: responseBody.bookings.length,
        });

        await callSimplyBook({
            method: "confirmBookingBatch",
            params: [
                responseBody.batchId,
                responseBody.batchType,
                createBatchSignature({
                    batchId: responseBody.batchId,
                    batchHash: responseBody.batchHash,
                    secret: config.apiSecretKey,
                }),
            ],
            config,
        });

        return {
            ...responseBody,
            requireConfirm: false,
            bookings: responseBody.bookings.map((booking) => ({
                ...booking,
                isConfirmed: true,
            })),
        };
    }

    if (responseBody.bookings.length > 1) {
        logSimplyBookBatch("batch metadata missing, confirming individually", {
            bookingCount: responseBody.bookings.length,
            hasBatchId: Boolean(responseBody.batchId),
            hasBatchHash: Boolean(responseBody.batchHash),
        });
    }

    for (const booking of responseBody.bookings) {
        if (!booking.id || !booking.hash) {
            throw new BookingError(
                "SimplyBook did not return booking confirmation data.",
                502,
                "UPSTREAM_CONFIRMATION_ERROR",
            );
        }

        await callSimplyBook({
            method: "confirmBooking",
            params: [
                booking.id,
                createBookingSignature({
                    bookingId: booking.id,
                    bookingHash: booking.hash,
                    secret: config.apiSecretKey,
                }),
            ],
            config,
        });
    }

    return {
        ...responseBody,
        requireConfirm: false,
        bookings: responseBody.bookings.map((booking) => ({
            ...booking,
            isConfirmed: true,
        })),
    };
};

const sanitizeResponseBody = (responseBody) => ({
    ...responseBody,
    batchHash: undefined,
    bookings: responseBody.bookings.map(({ hash, ...booking }) => booking),
});

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
        const shouldCreatePayment = payload.paymentMode === "pay";
        const paymentConfig = shouldCreatePayment
            ? getPaymentConfig(process.env, { requireSbpay: false })
            : null;

        if (shouldCreatePayment && !config.apiSecretKey) {
            throw new BookingError(
                "Missing SimplyBook configuration: SIMPLYBOOK_API_SECRET_KEY",
                500,
                "CONFIG_ERROR",
            );
        }

        const additionalFields = buildAdditionalFields(payload, config);
        const results = [];
        let bookingMode = "individual";
        let bookingResult = null;

        if (payload.times.length > 1 && !shouldCreatePayment) {
            const countBatch = await getConsecutiveBatchStart({
                times: payload.times,
                config,
            });

            if (countBatch) {
                const countResult = await createPublicCountBatchBooking({
                    payload,
                    additionalFields,
                    config,
                    countBatch,
                });

                bookingMode = countResult.mode;
                bookingResult = countResult.result;
            } else if (hasAdminBookingConfig(config)) {
                const adminResult = await createAdminBatchBookings({
                    payload,
                    additionalFields,
                    config,
                });

                bookingMode = adminResult.mode;
                bookingResult = adminResult.result;
            } else {
                logSimplyBookBatch(
                    "admin credentials missing and count batch unavailable, booking individually",
                    {
                        selectedSlotCount: payload.times.length,
                        hasAdminCredentials: hasAdminBookingConfig(config),
                    },
                );
            }
        }

        if (!bookingResult) {
            for (const time of payload.times) {
                const params = [
                    config.serviceId,
                    config.providerId,
                    payload.date,
                    time,
                    payload.clientData,
                    additionalFields,
                    1,
                ];

                logSimplyBookBatch("book request", {
                    slotIndex: results.length + 1,
                    totalSlots: payload.times.length,
                    date: payload.date,
                    time,
                    hasBatchId: false,
                    batchId: null,
                    paramsLength: params.length,
                });

                const result = await callSimplyBook({
                    method: "book",
                    params,
                    config,
                });
                const batch = getBatchInfo(result, config);

                results.push(result);

                logSimplyBookBatch("book response", {
                    slotIndex: results.length,
                    totalSlots: payload.times.length,
                    bookingCount: Array.isArray(result?.bookings)
                        ? result.bookings.length
                        : 0,
                    requireConfirm: Boolean(result?.require_confirm),
                    returnedBatchId: batch.id,
                    hasBatchHash: Boolean(batch.hash),
                    batchType: batch.type,
                });
            }

            bookingResult = combineBookingResults(results, {
                id: null,
                hash: null,
                type: config.bookingBatchType,
            });
        }

        let responseBody = normalizeBookingResult(bookingResult, config);

        logSimplyBookBatch("combined response", {
            selectedSlotCount: payload.times.length,
            bookingCount: responseBody.bookings.length,
            bookingMode,
            batchId: responseBody.batchId,
            hasBatchHash: Boolean(responseBody.batchHash),
            batchType: responseBody.batchType,
            batchBookingUsed: responseBody.batchBookingUsed,
            batchNotificationFallback: responseBody.batchNotificationFallback,
            paymentMode: payload.paymentMode,
        });
        const paymentUrl = shouldCreatePayment
            ? await findPaymentUrlForBookings({
                  bookings: responseBody.bookings,
                  peopleCount: payload.peopleCount,
                  bookingConfig: config,
                  paymentConfig,
                  clientData: payload.clientData,
                  req,
              })
            : "";

        if (!shouldCreatePayment) {
            responseBody = await confirmRequiredBookings({
                responseBody,
                config,
            });
        }

        json(res, 200, {
            ...sanitizeResponseBody(responseBody),
            paymentRequired: Boolean(paymentUrl),
            paymentUrl,
        });
    } catch (error) {
        handleError(res, error);
    }
};
