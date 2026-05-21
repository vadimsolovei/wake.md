const crypto = require("node:crypto");
const { PaymentError } = require("./_common");

const ALLOWED_ALGOS = new Set(["sha256", "sha512"]);
const MAX_TIMESTAMP_DRIFT_MS = 5 * 60 * 1000;

const timingSafeEqualText = (left, right) => {
    const leftBuffer = Buffer.from(String(left));
    const rightBuffer = Buffer.from(String(right));

    if (leftBuffer.length !== rightBuffer.length) return false;

    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const normalizeTimestampMs = (timestamp) => {
    const parsed = Date.parse(String(timestamp));

    return Number.isFinite(parsed) ? parsed : null;
};

const buildSbpayValidationPayload = (data) =>
    Object.entries(data)
        .sort(([left], [right]) => left.localeCompare(right))
        .filter(([key]) => key !== "signature")
        .map(([, value]) => String(value ?? ""))
        .join("|");

const validateCustomPaymentRequest = ({
    data,
    secret,
    now = Date.now(),
}) => {
    if (!data || typeof data !== "object") {
        throw new PaymentError("Payment request body is missing.", 400, "MISSING_BODY");
    }

    const signature = data.signature;
    const algo = String(data.algo || "");
    const timestamp = data.timestamp;
    const orderId = data.order_id;

    if (!signature) {
        throw new PaymentError("Signature is not set.", 400, "MISSING_SIGNATURE");
    }

    if (!algo) {
        throw new PaymentError("Algo is not set.", 400, "MISSING_ALGO");
    }

    if (!timestamp) {
        throw new PaymentError("Timestamp is not set.", 400, "MISSING_TIMESTAMP");
    }

    if (!orderId) {
        throw new PaymentError("Order id is not set.", 400, "MISSING_ORDER_ID");
    }

    if (!ALLOWED_ALGOS.has(algo)) {
        throw new PaymentError("Algo is not valid.", 400, "INVALID_ALGO");
    }

    const timestampMs = normalizeTimestampMs(timestamp);

    if (timestampMs === null || Math.abs(timestampMs - now) > MAX_TIMESTAMP_DRIFT_MS) {
        throw new PaymentError("Timestamp is not valid.", 400, "INVALID_TIMESTAMP");
    }

    const payload = buildSbpayValidationPayload(data);
    const expectedSignature = crypto
        .createHmac(algo, secret)
        .update(payload)
        .digest("hex");

    if (!timingSafeEqualText(signature, expectedSignature)) {
        throw new PaymentError("Signature is not valid.", 400, "INVALID_SIGNATURE");
    }

    return {
        orderId: String(orderId),
        algo,
        timestamp: String(timestamp),
    };
};

const signSbpayBody = ({ data, secret, timestamp = new Date().toISOString() }) => {
    const body = JSON.stringify({
        ...data,
        timestamp,
        algo: "sha256",
    });
    const signature = crypto
        .createHmac("sha256", secret)
        .update(body)
        .digest("hex");

    return { body, signature };
};

const sbpaySignedPost = async ({
    path,
    data,
    config,
    fetchImpl = fetch,
}) => {
    const { body, signature } = signSbpayBody({
        data,
        secret: config.sbpaySecret,
    });
    const response = await fetchImpl(
        `${config.sbpayApiBaseUrl}${path}`,
        {
            method: "POST",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                "X-Auth-Token": config.sbpayToken,
                "X-Merchant": config.sbpayMerchant,
                "X-Signature": signature,
            },
            body,
        },
    );
    const responseText = await response.text();
    let responseData = null;

    if (responseText) {
        try {
            responseData = JSON.parse(responseText);
        } catch (error) {
            throw new PaymentError(
                "SBPay returned an unreadable response.",
                502,
                "SBPAY_RESPONSE_ERROR",
            );
        }
    }

    if (!response.ok) {
        throw new PaymentError(
            responseData?.message || "SBPay request failed.",
            response.status >= 400 && response.status < 500 ? 400 : 502,
            "SBPAY_REQUEST_FAILED",
        );
    }

    return responseData;
};

const approveSbpayOrder = async ({
    orderId,
    reason,
    paymentMethod = "Maib",
    transactionId,
    config,
    fetchImpl = fetch,
}) =>
    sbpaySignedPost({
        path: `/order/${encodeURIComponent(orderId)}/approve`,
        data: {
            reason,
            paymentMethod,
            transactionId: transactionId || null,
        },
        config,
        fetchImpl,
    });

module.exports = {
    approveSbpayOrder,
    buildSbpayValidationPayload,
    signSbpayBody,
    validateCustomPaymentRequest,
};
