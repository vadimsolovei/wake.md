const crypto = require("node:crypto");
const { PaymentError } = require("./_common");

const MAX_CALLBACK_TIMESTAMP_DRIFT_MS = 5 * 60 * 1000;

let cachedToken = null;
let cachedTokenKey = "";
let cachedTokenExpiresAt = 0;
let cachedTokenPromise = null;

const getTokenKey = (config) =>
    `${config.maibBaseUrl}:${config.maibClientId}:${config.maibClientSecret}`;

const parseMaibResponse = async (response, errorCode) => {
    const text = await response.text();
    let data = null;

    if (text) {
        try {
            data = JSON.parse(text);
        } catch (error) {
            throw new PaymentError(
                "maib returned an unreadable response.",
                502,
                "MAIB_RESPONSE_ERROR",
            );
        }
    }

    if (!response.ok || data?.ok === false) {
        const errors = Array.isArray(data?.errors) ? data.errors : [];
        const message =
            errors[0]?.errorMessage ||
            errors[0]?.message ||
            data?.message ||
            "maib request failed.";

        throw new PaymentError(
            message,
            response.status >= 400 && response.status < 500 ? 400 : 502,
            errorCode,
        );
    }

    return data;
};

const getMaibToken = async ({ config, fetchImpl = fetch, forceRefresh = false }) => {
    const tokenKey = getTokenKey(config);

    if (
        !forceRefresh &&
        cachedToken &&
        cachedTokenKey === tokenKey &&
        cachedTokenExpiresAt > Date.now()
    ) {
        return cachedToken;
    }

    if (!forceRefresh && cachedTokenPromise && cachedTokenKey === tokenKey) {
        return cachedTokenPromise;
    }

    cachedTokenKey = tokenKey;
    cachedTokenPromise = fetchImpl(`${config.maibBaseUrl}/v2/auth/token`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        body: JSON.stringify({
            clientId: config.maibClientId,
            clientSecret: config.maibClientSecret,
        }),
    })
        .then((response) => parseMaibResponse(response, "MAIB_AUTH_FAILED"))
        .then((data) => {
            const result = data?.result || {};
            const accessToken = result.accessToken;
            const tokenType = result.tokenType || "Bearer";
            const expiresIn = Number(result.expiresIn);

            if (!accessToken) {
                throw new PaymentError(
                    "maib authentication did not return an access token.",
                    502,
                    "MAIB_AUTH_RESPONSE_ERROR",
                );
            }

            cachedToken = `${tokenType} ${accessToken}`;
            cachedTokenExpiresAt =
                Date.now() + Math.max((expiresIn || 300) - 30, 1) * 1000;

            return cachedToken;
        })
        .finally(() => {
            cachedTokenPromise = null;
        });

    return cachedTokenPromise;
};

const maibRequest = async ({
    method,
    path,
    body,
    config,
    fetchImpl = fetch,
}) => {
    const token = await getMaibToken({ config, fetchImpl });
    const response = await fetchImpl(`${config.maibBaseUrl}${path}`, {
        method,
        headers: {
            Authorization: token,
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });

    return parseMaibResponse(response, "MAIB_REQUEST_FAILED");
};

const createMaibCheckout = async ({ payload, config, fetchImpl = fetch }) => {
    const data = await maibRequest({
        method: "POST",
        path: "/v2/checkouts",
        body: payload,
        config,
        fetchImpl,
    });
    const result = data?.result || {};

    if (!result.checkoutId || !result.checkoutUrl) {
        throw new PaymentError(
            "maib did not return checkout details.",
            502,
            "MAIB_CHECKOUT_RESPONSE_ERROR",
        );
    }

    return result;
};

const getMaibCheckout = async ({ checkoutId, config, fetchImpl = fetch }) => {
    const data = await maibRequest({
        method: "GET",
        path: `/v2/checkouts/${encodeURIComponent(checkoutId)}`,
        config,
        fetchImpl,
    });

    return data?.result || {};
};

const refundMaibPayment = async ({
    payId,
    amount,
    reason,
    config,
    fetchImpl = fetch,
}) => {
    const data = await maibRequest({
        method: "POST",
        path: `/v2/payments/${encodeURIComponent(payId)}/refund`,
        body: {
            amount,
            reason,
        },
        config,
        fetchImpl,
    });

    return data?.result || {};
};

const normalizeSignatureHeader = (signature) =>
    String(signature || "").replace(/^sha256=/i, "");

const callbackTimestampToMs = (timestamp) => {
    if (!/^\d+$/.test(String(timestamp || ""))) return null;

    const value = Number(timestamp);

    if (!Number.isSafeInteger(value) || value <= 0) return null;

    return value < 1000000000000 ? value * 1000 : value;
};

const timingSafeEqualText = (left, right) => {
    const leftBuffer = Buffer.from(String(left));
    const rightBuffer = Buffer.from(String(right));

    if (leftBuffer.length !== rightBuffer.length) return false;

    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const verifyMaibCallbackSignature = ({
    rawBody,
    signature,
    timestamp,
    secret,
    now = Date.now(),
}) => {
    const signatureValue = normalizeSignatureHeader(signature);
    const timestampMs = callbackTimestampToMs(timestamp);

    if (!signatureValue) {
        throw new PaymentError("Missing maib signature.", 400, "MISSING_SIGNATURE");
    }

    if (timestampMs === null || Math.abs(timestampMs - now) > MAX_CALLBACK_TIMESTAMP_DRIFT_MS) {
        throw new PaymentError(
            "maib callback timestamp is not valid.",
            400,
            "INVALID_TIMESTAMP",
        );
    }

    const signedPayload = Buffer.concat([
        Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody)),
        Buffer.from(`.${timestamp}`),
    ]);
    const expectedHex = crypto
        .createHmac("sha256", secret)
        .update(signedPayload)
        .digest("hex");
    const expectedBase64 = crypto
        .createHmac("sha256", secret)
        .update(signedPayload)
        .digest("base64");

    if (
        !timingSafeEqualText(signatureValue, expectedHex) &&
        !timingSafeEqualText(signatureValue, expectedBase64)
    ) {
        throw new PaymentError(
            "maib signature is not valid.",
            400,
            "INVALID_SIGNATURE",
        );
    }
};

const getMaibPaymentId = (checkout) => {
    const payment = checkout?.payment || {};

    return (
        payment.PaymentId ||
        payment.paymentId ||
        payment.payId ||
        payment.id ||
        null
    );
};

const isCompletedExecutedCheckout = (checkout) => {
    const checkoutStatus = String(checkout?.status || "").toLowerCase();
    const paymentStatus = String(checkout?.payment?.status || "").toLowerCase();

    return checkoutStatus === "completed" && paymentStatus === "executed";
};

const resetMaibTokenCache = () => {
    cachedToken = null;
    cachedTokenKey = "";
    cachedTokenExpiresAt = 0;
    cachedTokenPromise = null;
};

module.exports = {
    createMaibCheckout,
    getMaibCheckout,
    getMaibPaymentId,
    isCompletedExecutedCheckout,
    refundMaibPayment,
    resetMaibTokenCache,
    verifyMaibCallbackSignature,
};
