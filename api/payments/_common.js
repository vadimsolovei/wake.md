const path = require("node:path");

class PaymentError extends Error {
    constructor(message, status = 500, code = "PAYMENT_ERROR") {
        super(message);
        this.name = "PaymentError";
        this.status = status;
        this.code = code;
    }
}

const json = (res, status, body) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
};

const handlePaymentError = (res, error) => {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    const message =
        status >= 500
            ? "Payment service is temporarily unavailable."
            : error.message;

    json(res, status, {
        ok: false,
        error: {
            code: error?.code || "PAYMENT_ERROR",
            message,
        },
    });
};

const readRawBody = async (req) => {
    if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
    if (typeof req.rawBody === "string") return Buffer.from(req.rawBody);

    const chunks = [];

    if (typeof req[Symbol.asyncIterator] !== "function") {
        return Buffer.alloc(0);
    }

    for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
};

const readFormBody = async (req) => {
    if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
        return req.body;
    }

    const rawBody = (await readRawBody(req)).toString("utf8");

    if (!rawBody) return {};

    const contentType = String(req.headers?.["content-type"] || "").toLowerCase();

    if (contentType.includes("application/json")) {
        try {
            return JSON.parse(rawBody);
        } catch (error) {
            throw new PaymentError("Invalid JSON body.", 400, "INVALID_JSON");
        }
    }

    return Object.fromEntries(new URLSearchParams(rawBody));
};

const readJsonBodyWithRaw = async (req) => {
    const rawBody = await readRawBody(req);

    if (rawBody.length) {
        try {
            return {
                rawBody,
                body: JSON.parse(rawBody.toString("utf8")),
            };
        } catch (error) {
            throw new PaymentError("Invalid JSON body.", 400, "INVALID_JSON");
        }
    }

    if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
        const compactBody = Buffer.from(JSON.stringify(req.body));

        return {
            rawBody: compactBody,
            body: req.body,
        };
    }

    throw new PaymentError("Missing JSON body.", 400, "MISSING_BODY");
};

const trimTrailingSlash = (value) => String(value || "").replace(/\/+$/, "");

const getPaymentConfig = (env = process.env) => {
    const storePath = env.PAYMENT_STORE_PATH || ".data/maib-payments.json";
    const config = {
        publicBaseUrl: trimTrailingSlash(env.PUBLIC_BASE_URL),
        sbpayApiBaseUrl: trimTrailingSlash(
            env.SBPAY_API_BASE_URL || "https://app.sbpay.me/api",
        ),
        sbpayToken: env.SBPAY_TOKEN || "",
        sbpaySecret: env.SBPAY_SECRET || "",
        sbpayMerchant: env.SBPAY_MERCHANT || "",
        maibBaseUrl: trimTrailingSlash(
            env.MAIB_BASE_URL || "https://sandbox.maibmerchants.md",
        ),
        maibClientId: env.MAIB_CLIENT_ID || "",
        maibClientSecret: env.MAIB_CLIENT_SECRET || "",
        maibSignatureKey: env.MAIB_SIGNATURE_KEY || "",
        maibLanguage: env.MAIB_LANGUAGE || "ru",
        paymentStorePath: path.isAbsolute(storePath)
            ? storePath
            : path.resolve(process.cwd(), storePath),
    };
    const missing = [];

    if (!config.publicBaseUrl) missing.push("PUBLIC_BASE_URL");
    if (!config.sbpayToken) missing.push("SBPAY_TOKEN");
    if (!config.sbpaySecret) missing.push("SBPAY_SECRET");
    if (!config.sbpayMerchant) missing.push("SBPAY_MERCHANT");
    if (!config.maibClientId) missing.push("MAIB_CLIENT_ID");
    if (!config.maibClientSecret) missing.push("MAIB_CLIENT_SECRET");
    if (!config.maibSignatureKey) missing.push("MAIB_SIGNATURE_KEY");

    if (missing.length) {
        throw new PaymentError(
            `Missing payment configuration: ${missing.join(", ")}`,
            500,
            "PAYMENT_CONFIG_ERROR",
        );
    }

    return config;
};

const buildPublicUrl = (config, pathname, params = {}) => {
    const url = new URL(pathname, `${config.publicBaseUrl}/`);

    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== "") {
            url.searchParams.set(key, String(value));
        }
    }

    return url.toString();
};

module.exports = {
    PaymentError,
    buildPublicUrl,
    getPaymentConfig,
    handlePaymentError,
    json,
    readFormBody,
    readJsonBodyWithRaw,
};
