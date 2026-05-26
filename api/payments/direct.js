const crypto = require("node:crypto");
const { BookingError, callSimplyBook } = require("../_simplybook");
const { PaymentError, buildPublicUrl } = require("./_common");
const { createMaibCheckout } = require("./_maib");
const { createPaymentStore } = require("./_store");

const DIRECT_PAYMENT_SOURCE = "simplybook_cart";

const normalizeAmount = (value) => {
    const amount = Number(value);

    if (!Number.isFinite(amount) || amount <= 0) {
        throw new BookingError(
            "SimplyBook returned an invalid payment amount.",
            502,
            "PAYMENT_AMOUNT_ERROR",
        );
    }

    return Math.round(amount * 100) / 100;
};

const normalizeCurrency = (value) => String(value || "").trim().toUpperCase();

const getCartId = (cart) =>
    cart?.cart_id ?? cart?.cartId ?? cart?.id ?? cart?.cart?.id ?? "";

const getCartHash = (cart) =>
    cart?.cart_hash ?? cart?.cartHash ?? cart?.hash ?? cart?.cart?.hash ?? "";

const normalizeCartItems = (cart, currency, fallbackAmount) => {
    const rawItems = Array.isArray(cart?.cart)
        ? cart.cart
        : Object.values(cart?.cart || {});
    const items = rawItems
        .map((item, index) => {
            const title =
                item?.name ||
                item?.title ||
                item?.service_name ||
                `Wake.md booking ${index + 1}`;
            const amount = normalizeAmount(
                item?.price ?? item?.amount ?? fallbackAmount,
            );
            const quantity = Number(item?.qty ?? item?.quantity ?? 1);

            return {
                externalId: String(item?.id || item?.booking_id || index + 1),
                title: String(title),
                amount,
                currency,
                quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
            };
        })
        .filter((item) => item.amount > 0);

    if (items.length) return items;

    return [
        {
            externalId: String(getCartId(cart)),
            title: "Wake.md booking",
            amount: fallbackAmount,
            currency,
            quantity: 1,
        },
    ];
};

const getPayerInfo = ({ clientData, req }) => {
    const payerInfo = {};
    const ip =
        req?.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ||
        req?.socket?.remoteAddress ||
        "";
    const userAgent = req?.headers?.["user-agent"] || "";

    if (clientData?.name) payerInfo.name = clientData.name;
    if (clientData?.email) payerInfo.email = clientData.email;
    if (clientData?.phone) payerInfo.phone = clientData.phone;
    if (ip) payerInfo.ip = ip;
    if (userAgent) payerInfo.userAgent = userAgent;

    return payerInfo;
};

const createCartSignature = ({ cartId, cartHash, secret }) =>
    crypto
        .createHash("md5")
        .update(`${cartId}${cartHash}${secret}`)
        .digest("hex");

const requireSimplyBookPaymentSecret = (bookingConfig, ErrorClass) => {
    if (bookingConfig.apiSecretKey) return;

    throw new ErrorClass(
        "Missing SimplyBook configuration: SIMPLYBOOK_API_SECRET_KEY",
        500,
        "CONFIG_ERROR",
    );
};

const createDirectMaibPayment = async ({
    cart,
    bookings,
    bookingConfig,
    paymentConfig,
    clientData,
    req,
}) => {
    requireSimplyBookPaymentSecret(bookingConfig, BookingError);

    const cartId = getCartId(cart);
    const cartHash = getCartHash(cart);

    if (!cartId) {
        throw new BookingError(
            "SimplyBook did not return a payment cart id.",
            502,
            "PAYMENT_CART_ERROR",
        );
    }

    if (!cartHash) {
        throw new BookingError(
            "SimplyBook did not return a payment cart hash.",
            502,
            "PAYMENT_CART_ERROR",
        );
    }

    const amount = normalizeAmount(cart.amount);
    const currency = normalizeCurrency(cart.currency);

    if (currency !== "MDL") {
        throw new BookingError(
            "Only MDL payments are supported.",
            400,
            "UNSUPPORTED_CURRENCY",
        );
    }

    const orderId = `simplybook-cart-${cartId}`;
    const description = `Wake.md booking cart ${cartId}`;
    const callbackUrl = buildPublicUrl(
        paymentConfig,
        "/api/payments/maib/callback",
    );
    const successUrl = buildPublicUrl(paymentConfig, "/api/payments/maib/return", {
        order_id: orderId,
        target: "success",
    });
    const failUrl = buildPublicUrl(paymentConfig, "/api/payments/maib/return", {
        order_id: orderId,
        target: "fail",
    });
    const checkout = await createMaibCheckout({
        payload: {
            amount,
            currency,
            orderInfo: {
                id: orderId,
                description,
                date: new Date().toISOString(),
                orderAmount: amount,
                orderCurrency: currency,
                items: normalizeCartItems(cart, currency, amount),
            },
            payerInfo: getPayerInfo({ clientData, req }),
            language: paymentConfig.maibLanguage,
            callbackUrl,
            successUrl,
            failUrl,
        },
        config: paymentConfig,
    });
    const store = createPaymentStore(paymentConfig.paymentStorePath);
    const paymentProcessor = bookingConfig.paymentProcessorName;

    store.save({
        orderId,
        source: DIRECT_PAYMENT_SOURCE,
        checkoutId: checkout.checkoutId,
        payId: null,
        cartId,
        cartHash,
        bookingIds: bookings.map((booking) => booking.id).filter(Boolean),
        bookingCodes: bookings.map((booking) => booking.code).filter(Boolean),
        paymentProcessor,
        amount,
        currency,
        returnUrl: paymentConfig.publicBaseUrl,
        cancelUrl: paymentConfig.publicBaseUrl,
        status: "checkout_created",
    });

    return checkout.checkoutUrl;
};

const isDirectMaibPaymentOrder = (order) =>
    order?.source === DIRECT_PAYMENT_SOURCE && order.cartId && order.cartHash;

const confirmDirectMaibPaymentOrder = async ({ order, bookingConfig }) => {
    requireSimplyBookPaymentSecret(bookingConfig, PaymentError);

    const sign = createCartSignature({
        cartId: order.cartId,
        cartHash: order.cartHash,
        secret: bookingConfig.apiSecretKey,
    });

    return callSimplyBook({
        method: "confirmBookingCart",
        params: [
            order.cartId,
            order.paymentProcessor || bookingConfig.paymentProcessorName,
            sign,
        ],
        config: bookingConfig,
    });
};

module.exports = {
    DIRECT_PAYMENT_SOURCE,
    confirmDirectMaibPaymentOrder,
    createCartSignature,
    createDirectMaibPayment,
    isDirectMaibPaymentOrder,
};
