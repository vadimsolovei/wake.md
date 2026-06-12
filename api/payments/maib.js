const {
    PaymentError,
    getPaymentConfig,
    handlePaymentError,
    json,
    readJsonBodyWithRaw,
    requireSbpayConfig,
} = require("./_common");
const { getConfig: getSimplyBookConfig } = require("../_simplybook");
const {
    getMaibCheckout,
    getMaibPaymentId,
    isCompletedExecutedCheckout,
    verifyMaibCallbackSignature,
} = require("./_maib");
const { createPaymentStore } = require("./_store");
const {
    confirmDirectMaibPaymentOrder,
    isDirectMaibPaymentOrder,
} = require("./direct");
const { approveSbpayOrder } = require("./_sbpay");

const requireMethod = (req, res, method) => {
    if (req.method === method) return true;

    res.setHeader("Allow", method);
    json(res, 405, {
        ok: false,
        error: {
            code: "METHOD_NOT_ALLOWED",
            message: "Method not allowed.",
        },
    });

    return false;
};

const getHeader = (req, name) => {
    const headers = req.headers || {};
    const value = headers[name] || headers[name.toLowerCase()];

    return Array.isArray(value) ? value[0] : value;
};

const getOrderIdFromCallback = ({ body, checkout, existingOrder }) =>
    body.orderId ||
    body.order_id ||
    checkout?.order?.id ||
    checkout?.payment?.orderId ||
    existingOrder?.orderId ||
    "";

const appendBookingPaymentStatus = (baseUrl, status) => {
    const url = new URL(baseUrl);

    url.searchParams.set("booking_payment", status);

    return url.toString();
};

const isDirectMaibReturnOrder = ({ order, orderId }) =>
    isDirectMaibPaymentOrder(order) ||
    String(orderId || "").startsWith("simplybook-cart-");

const getDirectMaibReturnStatus = ({ target, checkoutStatus, order }) => {
    if (!order) return "error";

    if (target === "fail" || target === "failed" || target === "cancel") {
        return "failed";
    }

    if (
        target === "success" ||
        checkoutStatus === "completed" ||
        order.status === "approved"
    ) {
        return "success";
    }

    return "error";
};

const maibCallbackHandler = async (req, res) => {
    if (!requireMethod(req, res, "POST")) return;

    try {
        const config = getPaymentConfig(process.env, { requireSbpay: false });
        const { rawBody, body } = await readJsonBodyWithRaw(req);

        verifyMaibCallbackSignature({
            rawBody,
            signature: getHeader(req, "x-signature"),
            timestamp: getHeader(req, "x-signature-timestamp"),
            secret: config.maibSignatureKey,
        });

        const checkoutId = body.checkoutId || body.checkout_id || body.id;

        if (!checkoutId) {
            throw new PaymentError(
                "maib checkout id is missing.",
                400,
                "MISSING_CHECKOUT_ID",
            );
        }

        const store = createPaymentStore(config.paymentStorePath);
        const existingOrder = store.findByCheckoutId(checkoutId);
        const checkout = await getMaibCheckout({
            checkoutId,
            config,
        });
        const orderId = getOrderIdFromCallback({
            body,
            checkout,
            existingOrder,
        });

        if (!orderId) {
            throw new PaymentError(
                "Payment order id is missing.",
                400,
                "MISSING_ORDER_ID",
            );
        }

        const storedOrder = existingOrder || store.get(orderId);
        const payId = getMaibPaymentId(checkout);

        if (!isCompletedExecutedCheckout(checkout)) {
            store.save({
                ...(storedOrder || {}),
                orderId,
                checkoutId,
                payId: payId || storedOrder?.payId || null,
                status: String(checkout.status || "pending").toLowerCase(),
            });
            json(res, 200, { ok: true, approved: false });
            return;
        }

        if (isDirectMaibPaymentOrder(storedOrder)) {
            if (storedOrder.status !== "approved") {
                await confirmDirectMaibPaymentOrder({
                    order: storedOrder,
                    bookingConfig: getSimplyBookConfig(),
                });
            }
        } else if (storedOrder?.status !== "approved") {
            requireSbpayConfig(config);
            await approveSbpayOrder({
                orderId,
                reason: "Payment processed by maib.",
                transactionId: payId || checkoutId,
                config,
            });
        }

        store.save({
            ...(storedOrder || {}),
            orderId,
            checkoutId,
            payId: payId || storedOrder?.payId || null,
            status: "approved",
            approvedAt: new Date().toISOString(),
        });

        json(res, 200, { ok: true, approved: true });
    } catch (error) {
        handlePaymentError(res, error);
    }
};

const maibReturnHandler = (req, res) => {
    if (!requireMethod(req, res, "GET")) return;

    try {
        const config = getPaymentConfig(process.env, { requireSbpay: false });
        const store = createPaymentStore(config.paymentStorePath);
        const query = req.query || {};
        const orderId = query.orderId || query.order_id || "";
        const target = String(query.target || "").toLowerCase();
        const checkoutStatus = String(query.checkoutStatus || "").toLowerCase();
        const order = orderId ? store.get(orderId) : null;
        const success =
            target === "success" ||
            checkoutStatus === "completed" ||
            order?.status === "approved";
        const location = isDirectMaibReturnOrder({ order, orderId })
            ? appendBookingPaymentStatus(
                  config.publicBaseUrl,
                  getDirectMaibReturnStatus({ target, checkoutStatus, order }),
              )
            : (success ? order?.returnUrl : order?.cancelUrl) ||
              config.publicBaseUrl;

        res.statusCode = 302;
        res.setHeader("Location", location);
        res.end("");
    } catch (error) {
        handlePaymentError(res, error);
    }
};

module.exports = {
    maibCallbackHandler,
    maibReturnHandler,
};
