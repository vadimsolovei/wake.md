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
    confirmInvoiceMaibPaymentOrder,
    isDirectMaibPaymentOrder,
    isInvoiceMaibPaymentOrder,
} = require("./direct");
const { approveSbpayOrder } = require("./_sbpay");

const orderFinalizationLocks = new Map();

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
    String(orderId || "").startsWith("simplybook-cart-") ||
    String(orderId || "").startsWith("simplybook-invoice-");

const getDirectMaibReturnStatus = ({ target, checkoutStatus, order }) => {
    if (!order) return "error";

    if (target === "fail" || target === "failed" || target === "cancel") {
        return "failed";
    }

    if (order.status === "approved") {
        return "success";
    }

    if (isInvoiceMaibPaymentOrder(order)) return "error";

    if (target === "success" || checkoutStatus === "completed") {
        return "success";
    }

    return "error";
};

const withOrderFinalizationLock = (orderId, task) => {
    const key = String(orderId);
    const previous = orderFinalizationLocks.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(task);

    orderFinalizationLocks.set(key, current);

    return current.finally(() => {
        if (orderFinalizationLocks.get(key) === current) {
            orderFinalizationLocks.delete(key);
        }
    });
};

const sanitizeStoredErrorValue = (value, maxLength) =>
    String(value || "")
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .slice(0, maxLength);

const toStoredConfirmationError = (error) => ({
    code: sanitizeStoredErrorValue(
        error?.code || "PAYMENT_INVOICE_CONFIRMATION_ERROR",
        100,
    ),
    message: sanitizeStoredErrorValue(
        error?.message || "SimplyBook invoice confirmation failed.",
        500,
    ),
});

const finalizeCompletedMaibOrder = async ({
    orderId,
    checkoutId,
    checkout,
    store,
    paymentConfig,
}) => {
    let storedOrder = store.get(orderId);
    const payId = getMaibPaymentId(checkout);

    if (storedOrder?.status === "approved") return storedOrder;

    if (isInvoiceMaibPaymentOrder(storedOrder)) {
        storedOrder = store.save({
            ...storedOrder,
            checkoutId,
            payId: payId || storedOrder.payId || null,
            status: "confirmation_pending",
            paymentReceivedAt:
                storedOrder.paymentReceivedAt || new Date().toISOString(),
        });

        try {
            storedOrder = await confirmInvoiceMaibPaymentOrder({
                order: storedOrder,
                bookingConfig: getSimplyBookConfig(),
                store,
            });
        } catch (error) {
            const currentOrder = store.get(orderId) || storedOrder;
            const reviewOrder = store.save({
                ...currentOrder,
                checkoutId,
                payId: payId || currentOrder.payId || null,
                status: "manual_action_required",
                confirmationError: toStoredConfirmationError(error),
            });

            console.error(
                "[PAYMENT_INVOICE_REVIEW_REQUIRED]",
                JSON.stringify({
                    orderId: reviewOrder.orderId,
                    checkoutId: reviewOrder.checkoutId,
                    payId: reviewOrder.payId,
                    invoiceIds: reviewOrder.invoiceIds,
                    confirmedInvoiceIds: reviewOrder.confirmedInvoiceIds || [],
                    bookingIds: reviewOrder.bookingIds || [],
                    error: reviewOrder.confirmationError,
                }),
            );

            throw new PaymentError(
                "SimplyBook invoice confirmation requires manual review.",
                502,
                "PAYMENT_INVOICE_CONFIRMATION_ERROR",
            );
        }
    } else if (isDirectMaibPaymentOrder(storedOrder)) {
        await confirmDirectMaibPaymentOrder({
            order: storedOrder,
            bookingConfig: getSimplyBookConfig(),
        });
    } else {
        requireSbpayConfig(paymentConfig);
        await approveSbpayOrder({
            orderId,
            reason: "Payment processed by maib.",
            transactionId: payId || checkoutId,
            config: paymentConfig,
        });
    }

    return store.save({
        ...(store.get(orderId) || storedOrder || {}),
        orderId,
        checkoutId,
        payId: payId || storedOrder?.payId || null,
        status: "approved",
        confirmationError: null,
        approvedAt: new Date().toISOString(),
    });
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
            if (storedOrder?.status === "approved") {
                json(res, 200, { ok: true, approved: true });
                return;
            }

            store.save({
                ...(storedOrder || {}),
                orderId,
                checkoutId,
                payId: payId || storedOrder?.payId || null,
                status:
                    storedOrder?.status === "manual_action_required"
                        ? storedOrder.status
                        : String(checkout.status || "pending").toLowerCase(),
            });
            json(res, 200, { ok: true, approved: false });
            return;
        }

        await withOrderFinalizationLock(orderId, () =>
            finalizeCompletedMaibOrder({
                orderId,
                checkoutId,
                checkout,
                store,
                paymentConfig: config,
            }),
        );

        json(res, 200, { ok: true, approved: true });
    } catch (error) {
        handlePaymentError(res, error);
    }
};

const maibReturnHandler = async (req, res) => {
    if (!requireMethod(req, res, "GET")) return;

    try {
        const config = getPaymentConfig(process.env, { requireSbpay: false });
        const store = createPaymentStore(config.paymentStorePath);
        const query = req.query || {};
        const orderId = query.orderId || query.order_id || "";
        const target = String(query.target || "").toLowerCase();
        const checkoutStatus = String(query.checkoutStatus || "").toLowerCase();
        let order = orderId ? store.get(orderId) : null;

        if (
            target === "success" &&
            isInvoiceMaibPaymentOrder(order) &&
            order.status !== "approved" &&
            order.checkoutId
        ) {
            try {
                const checkout = await getMaibCheckout({
                    checkoutId: order.checkoutId,
                    config,
                });

                if (isCompletedExecutedCheckout(checkout)) {
                    await withOrderFinalizationLock(orderId, () =>
                        finalizeCompletedMaibOrder({
                            orderId,
                            checkoutId: order.checkoutId,
                            checkout,
                            store,
                            paymentConfig: config,
                        }),
                    );
                }
            } catch (error) {
                console.error(
                    "[PAYMENT_RETURN_RECONCILIATION_ERROR]",
                    error.message,
                );
            }

            order = store.get(orderId);
        }

        const success = isInvoiceMaibPaymentOrder(order)
            ? order?.status === "approved"
            : target === "success" ||
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
    finalizeCompletedMaibOrder,
    maibCallbackHandler,
    maibReturnHandler,
    withOrderFinalizationLock,
};
