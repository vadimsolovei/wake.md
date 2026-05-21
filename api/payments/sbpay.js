const {
    PaymentError,
    buildPublicUrl,
    getPaymentConfig,
    handlePaymentError,
    json,
    readFormBody,
} = require("./_common");
const { createMaibCheckout, refundMaibPayment } = require("./_maib");
const { createPaymentStore } = require("./_store");
const { validateCustomPaymentRequest } = require("./_sbpay");

const normalizeAmount = (value) => {
    const amount = Number(value);

    if (!Number.isFinite(amount) || amount <= 0) {
        throw new PaymentError("Payment amount is not valid.", 400, "INVALID_AMOUNT");
    }

    return Math.round(amount * 100) / 100;
};

const normalizeCurrency = (value) => String(value || "").trim().toUpperCase();

const getBodyValue = (body, keys) => {
    for (const key of keys) {
        const value = body[key];

        if (value !== undefined && value !== null && String(value).trim()) {
            return String(value).trim();
        }
    }

    return "";
};

const normalizeUrl = (value) => {
    if (!value) return "";

    try {
        const url = new URL(value);

        return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
    } catch (error) {
        return "";
    }
};

const extractPayerInfo = (body, req) => {
    const payerInfo = {};
    const name = getBodyValue(body, [
        "customer_name",
        "client_name",
        "name",
        "full_name",
    ]);
    const email = getBodyValue(body, ["customer_email", "client_email", "email"]);
    const phone = getBodyValue(body, ["customer_phone", "client_phone", "phone"]);
    const ip =
        req.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ||
        req.socket?.remoteAddress ||
        "";
    const userAgent = req.headers?.["user-agent"] || "";

    if (name) payerInfo.name = name;
    if (email) payerInfo.email = email;
    if (phone) payerInfo.phone = phone;
    if (ip) payerInfo.ip = ip;
    if (userAgent) payerInfo.userAgent = userAgent;

    return payerInfo;
};

const buildCheckoutPayload = ({ body, config, req, orderId, amount, currency }) => {
    const description =
        getBodyValue(body, ["description", "item_name", "title"]) ||
        `SimplyBook order ${orderId}`;
    const callbackUrl = buildPublicUrl(config, "/api/payments/maib/callback");
    const successUrl = buildPublicUrl(config, "/api/payments/maib/return", {
        order_id: orderId,
        target: "success",
    });
    const failUrl = buildPublicUrl(config, "/api/payments/maib/return", {
        order_id: orderId,
        target: "fail",
    });

    return {
        amount,
        currency,
        orderInfo: {
            id: orderId,
            description,
            date: new Date().toISOString(),
            orderAmount: amount,
            orderCurrency: currency,
            items: [
                {
                    externalId: orderId,
                    title: description,
                    amount,
                    currency,
                    quantity: 1,
                },
            ],
        },
        payerInfo: extractPayerInfo(body, req),
        language: config.maibLanguage,
        callbackUrl,
        successUrl,
        failUrl,
    };
};

const requirePost = (req, res) => {
    if (req.method === "POST") return true;

    res.setHeader("Allow", "POST");
    json(res, 405, {
        ok: false,
        error: {
            code: "METHOD_NOT_ALLOWED",
            message: "Method not allowed.",
        },
    });

    return false;
};

const sbpayFormHandler = async (req, res) => {
    if (!requirePost(req, res)) return;

    try {
        const config = getPaymentConfig();
        const body = await readFormBody(req);
        const { orderId } = validateCustomPaymentRequest({
            data: body,
            secret: config.sbpaySecret,
        });
        const amount = normalizeAmount(body.amount);
        const currency = normalizeCurrency(body.currency);

        if (currency !== "MDL") {
            throw new PaymentError(
                "Only MDL payments are supported.",
                400,
                "UNSUPPORTED_CURRENCY",
            );
        }

        const store = createPaymentStore(config.paymentStorePath);
        const returnUrl = normalizeUrl(body.return_url);
        const cancelUrl = normalizeUrl(body.cancel_url);
        const checkout = await createMaibCheckout({
            payload: buildCheckoutPayload({
                body,
                config,
                req,
                orderId,
                amount,
                currency,
            }),
            config,
        });

        store.save({
            orderId,
            checkoutId: checkout.checkoutId,
            payId: null,
            amount,
            currency,
            returnUrl,
            cancelUrl,
            status: "checkout_created",
        });

        res.statusCode = 303;
        res.setHeader("Location", checkout.checkoutUrl);
        res.end("");
    } catch (error) {
        handlePaymentError(res, error);
    }
};

const sbpayRefundHandler = async (req, res) => {
    if (!requirePost(req, res)) return;

    try {
        const config = getPaymentConfig();
        const body = await readFormBody(req);
        const { orderId } = validateCustomPaymentRequest({
            data: body,
            secret: config.sbpaySecret,
        });
        const store = createPaymentStore(config.paymentStorePath);
        const order = store.get(orderId);

        if (!order) {
            throw new PaymentError("Payment order was not found.", 404, "ORDER_NOT_FOUND");
        }

        if (!order.payId) {
            throw new PaymentError(
                "maib payment id is not available for this order.",
                409,
                "PAYMENT_ID_MISSING",
            );
        }

        const amount =
            body.amount === undefined || body.amount === ""
                ? normalizeAmount(order.amount)
                : normalizeAmount(body.amount);
        const reason =
            getBodyValue(body, ["reason", "refund_reason"]) ||
            `Refund for SBPay order ${orderId}`;
        const refund = await refundMaibPayment({
            payId: order.payId,
            amount,
            reason,
            config,
        });

        store.save({
            ...order,
            status: "refunded",
            refundId: refund.refundId || null,
            refundStatus: refund.status || null,
        });

        json(res, 200, {
            ok: true,
            refundId: refund.refundId || null,
            status: refund.status || "Created",
        });
    } catch (error) {
        handlePaymentError(res, error);
    }
};

const unsupportedPaymentHandler = (featureName) => (req, res) => {
    if (!requirePost(req, res)) return;

    json(res, 501, {
        ok: false,
        error: {
            code: "PAYMENT_FEATURE_UNSUPPORTED",
            message: `${featureName} is not supported for maib custom payments.`,
        },
    });
};

module.exports = {
    sbpayDeletePaymentMethodHandler: unsupportedPaymentHandler(
        "Delete payment method",
    ),
    sbpayFormHandler,
    sbpayRebillHandler: unsupportedPaymentHandler("Rebilling"),
    sbpayRefundHandler,
};
