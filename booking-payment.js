const BOOKING_SUBMIT_ACTIONS_TOKEN = "__BOOKING_SUBMIT_ACTIONS__";

const BOOKING_BUTTON = `
<button class="btn btn--primary booking-submit" type="submit" data-booking-submit data-booking-payment-mode="book">
    <span class="booking-submit__spinner" aria-hidden="true"></span>
    <span data-booking-submit-label>Забронировать</span>
</button>`;

const createPaymentButton = ({ testOnly = false } = {}) => `
<button class="btn btn--primary booking-submit${testOnly ? " booking-submit--payment-test" : ""}" type="submit" data-booking-submit data-booking-payment-mode="pay">
    <span class="booking-submit__spinner" aria-hidden="true"></span>
    <span data-booking-submit-label>Оплатить</span>
</button>`;

const PAYMENT_BUTTON = createPaymentButton();
const PAYMENT_TEST_BUTTON = createPaymentButton({ testOnly: true });

const getBookingPaymentRequired = (env = process.env) => {
    const value = String(env.BOOKING_PAYMENT_REQUIRED || "")
        .trim()
        .toLowerCase();

    if (value === "true") return true;
    if (value === "false") return false;

    throw new Error(
        "BOOKING_PAYMENT_REQUIRED must be explicitly set to true or false.",
    );
};

const resolveBookingPaymentMode = (requestedMode, paymentRequired) => {
    if (paymentRequired) return "pay";

    const mode = String(requestedMode || "book").trim();

    return mode;
};

const renderBookingSubmitActions = (html, paymentRequired) => {
    if (!html.includes(BOOKING_SUBMIT_ACTIONS_TOKEN)) {
        throw new Error("Booking submit actions placeholder is missing.");
    }

    const actions = paymentRequired
        ? PAYMENT_BUTTON
        : `${BOOKING_BUTTON}${PAYMENT_TEST_BUTTON}`;

    return html.replace(BOOKING_SUBMIT_ACTIONS_TOKEN, actions);
};

const renderBookingSubmitActionsIfNeeded = (html, paymentRequired) =>
    html.includes(BOOKING_SUBMIT_ACTIONS_TOKEN)
        ? renderBookingSubmitActions(html, paymentRequired)
        : html;

module.exports = {
    BOOKING_SUBMIT_ACTIONS_TOKEN,
    getBookingPaymentRequired,
    renderBookingSubmitActions,
    renderBookingSubmitActionsIfNeeded,
    resolveBookingPaymentMode,
};
