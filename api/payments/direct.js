const crypto = require("node:crypto");
const { BookingError, callSimplyBook } = require("../_simplybook");
const { PaymentError, buildPublicUrl } = require("./_common");
const { createMaibCheckout } = require("./_maib");
const { createPaymentStore } = require("./_store");

const DIRECT_PAYMENT_SOURCE = "simplybook_cart";
const FIRST_SET_PRICE = 600;
const NEXT_SET_PRICE = 400;
const WAKE_MD_PAYMENT_CURRENCY = "MDL";
const WAKE_MD_PRICING_SOURCE = "wakemd_formula";

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

const normalizePositiveInteger = (value) => {
    const number = Number(value);

    return Number.isInteger(number) && number > 0 ? number : 0;
};

const calculateWakeMdBookingPrice = ({ peopleCount, setCount }) => {
    const normalizedPeopleCount = normalizePositiveInteger(peopleCount);
    const normalizedSetCount = normalizePositiveInteger(setCount);

    if (!normalizedPeopleCount || !normalizedSetCount) {
        throw new BookingError(
            "Wake.md booking price could not be calculated.",
            500,
            "PAYMENT_PRICE_ERROR",
        );
    }

    if (normalizedSetCount < normalizedPeopleCount) {
        throw new BookingError(
            "Booking price requires at least one set per person.",
            400,
            "INSUFFICIENT_TIME_SLOTS",
        );
    }

    const firstSetCount = Math.min(normalizedPeopleCount, normalizedSetCount);
    const nextSetCount = Math.max(normalizedSetCount - normalizedPeopleCount, 0);
    const amount =
        firstSetCount * FIRST_SET_PRICE + nextSetCount * NEXT_SET_PRICE;

    return {
        pricingSource: WAKE_MD_PRICING_SOURCE,
        amount,
        currency: WAKE_MD_PAYMENT_CURRENCY,
        peopleCount: normalizedPeopleCount,
        setCount: normalizedSetCount,
        firstSetCount,
        nextSetCount,
        firstSetPrice: FIRST_SET_PRICE,
        nextSetPrice: NEXT_SET_PRICE,
    };
};

const getCartId = (cart) =>
    cart?.cart_id ?? cart?.cartId ?? cart?.id ?? cart?.cart?.id ?? "";

const getCartHash = (cart) =>
    cart?.cart_hash ?? cart?.cartHash ?? cart?.hash ?? cart?.cart?.hash ?? "";

const buildWakeMdPricingItems = (price) => {
    const items = [
        {
            externalId: "first-sets",
            title: "Wake.md first sets",
            amount: FIRST_SET_PRICE,
            currency: price.currency,
            quantity: price.firstSetCount,
        },
    ];

    if (price.nextSetCount > 0) {
        items.push({
            externalId: "repeat-sets",
            title: "Wake.md repeat sets",
            amount: NEXT_SET_PRICE,
            currency: price.currency,
            quantity: price.nextSetCount,
        });
    }

    return items;
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
    peopleCount,
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

    const simplybookAmount = normalizeAmount(cart.amount);
    const currency = normalizeCurrency(cart.currency);

    if (currency !== WAKE_MD_PAYMENT_CURRENCY) {
        throw new BookingError(
            "Only MDL payments are supported.",
            400,
            "UNSUPPORTED_CURRENCY",
        );
    }

    const bookingIds = bookings.map((booking) => booking.id).filter(Boolean);
    const bookingCodes = bookings.map((booking) => booking.code).filter(Boolean);
    const price = calculateWakeMdBookingPrice({
        peopleCount,
        setCount: bookingIds.length,
    });
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
            amount: price.amount,
            currency,
            orderInfo: {
                id: orderId,
                description,
                date: new Date().toISOString(),
                orderAmount: price.amount,
                orderCurrency: currency,
                items: buildWakeMdPricingItems(price),
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
        bookingIds,
        bookingCodes,
        paymentProcessor,
        amount: price.amount,
        simplybookAmount,
        currency,
        pricingSource: price.pricingSource,
        peopleCount: price.peopleCount,
        setCount: price.setCount,
        firstSetCount: price.firstSetCount,
        nextSetCount: price.nextSetCount,
        firstSetPrice: price.firstSetPrice,
        nextSetPrice: price.nextSetPrice,
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
    calculateWakeMdBookingPrice,
    confirmDirectMaibPaymentOrder,
    createCartSignature,
    createDirectMaibPayment,
    isDirectMaibPaymentOrder,
};
